import type { Participant as DbParticipant } from "@prisma/client";
import {
  CombatAddSchema,
  CombatDelaySchema,
  CombatEndSchema,
  CombatRemoveSchema,
  CombatReorderSchema,
  CombatResumeSchema,
  CombatRollSchema,
  CombatSceneSchema,
  CombatSetAutoRollNpcInitiativeSchema,
  CombatSetInitiativeSchema,
  CombatSetMovementLimitSchema,
  CombatSetMovementSchema,
  CombatSetSurprisedSchema,
  CombatStartSchema,
  advanceTurn,
  resumePlacement,
  sortCombatants,
  startTurns,
  stateAfterRemoval,
  type Combat,
  type RollVisibility,
  type SystemDefinition,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import {
  buildCombatantInitiativeRoll,
  canControlCombatant,
  expireConditionsOnRoundChange,
  initialBonusFor,
  linkedCharacter,
  persistNormalizedOrder,
  requireCombat,
  requirePlayerOnActiveScene,
  stripTimedConditionsOnCombatEnd,
  emitCombat as sendCombat,
  type CombatantRow,
  type CombatRow,
  type Viewer,
} from "../services/combat.js";
import { requireSystem } from "../services/characters.js";
import { isAutoRollNpcInitiativeEnabled, setAutoRollNpcInitiativeEnabled } from "../services/autoRollNpcInitiative.js";
import { resolveBudget, startTurnMovement, startTurnMovementIfChanged } from "../services/movement.js";
import { isMovementLimitEnabled, setMovementLimitEnabled } from "../services/movementLimit.js";
import { createInitiativeBatchRoll, createRollMessage } from "../services/rolls.js";
import { guarded, HandlerError } from "./ack.js";
import { requireScene } from "./scene.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

/** Participante do banco, GM que chamou combat:start/add/roll — precisa pra `createRollMessage`/`createInitiativeBatchRoll` (autor do card). */
async function requireParticipant(participantId: string): Promise<DbParticipant> {
  const me = await prisma.participant.findUnique({ where: { id: participantId } });
  if (!me) throw new HandlerError("Participante não encontrado");
  return me;
}

/**
 * Rola iniciativa de `targets` no servidor: um card em lote (`InitiativeBatch`) se houver mais de
 * um combatente, um card normal de rolagem se só um — mesma escolha de `combat:roll` (§3.5). Grava
 * `Combatant.initiative`/`lastRollVisibility` de cada um. Extraído pra ser reaproveitado pela
 * rolagem automática de NPCs (`combat:start`/`combat:add` com a opção da sala ligada) além do
 * próprio `combat:roll`; não-op com lista vazia.
 */
async function rollCombatantsInitiative(
  io: TypedServer,
  roomId: string,
  me: DbParticipant,
  def: SystemDefinition,
  round: number,
  targets: CombatantRow[],
  visibility: RollVisibility,
): Promise<void> {
  if (targets.length === 0) return;
  if (targets.length > 1) {
    const built = await Promise.all(targets.map((row) => buildCombatantInitiativeRoll(def, row)));
    const { results } = await createInitiativeBatchRoll(io, roomId, me, {
      round,
      visibility,
      entries: targets.map((row, i) => ({ combatantId: row.id, tokenId: row.tokenId, name: row.token.name, formula: built[i]!.formula })),
    });
    // lastRollVisibility: "gm" (rolagem às cegas) esconde o valor até do próprio dono na lista
    // (toCombat) — mesma regra do chat: quem rolou não vê o próprio resultado.
    await Promise.all(
      targets.map((row) =>
        prisma.combatant.update({ where: { id: row.id }, data: { initiative: results.get(row.id)!, lastRollVisibility: visibility } }),
      ),
    );
  } else {
    for (const row of targets) {
      const built = await buildCombatantInitiativeRoll(def, row);
      const { total } = await createRollMessage(io, roomId, me, {
        formula: built.formula,
        label: built.label,
        visibility,
        characterId: built.characterId,
        tokenId: row.tokenId,
        allowNoDice: true,
      });
      await prisma.combatant.update({ where: { id: row.id }, data: { initiative: total, lastRollVisibility: visibility } });
    }
  }
}

function viewerOf(ctx: { role: "gm" | "player"; participantId: string }): Viewer {
  return { role: ctx.role, participantId: ctx.participantId };
}

/** Combatente + a ficha vinculada ao token ATUAL (não a `characterId` congelada). */
async function withCharacter(row: CombatantRow) {
  return { row, character: await linkedCharacter(row.token) };
}

async function requireCombatant(combat: CombatRow, combatantId: string): Promise<CombatantRow> {
  const row = combat.combatants.find((c) => c.id === combatantId);
  if (!row) throw new HandlerError("Combatente não encontrado");
  return row;
}

/**
 * Combate por mapa (docs/plano-mapas.md §7): todo payload leva `sceneId` — não existe mais "a cena
 * ativa da sala" pra combate, então o cliente sempre diz qual mapa quer dizer (o que está vendo).
 * Jogador só age no mapa ATIVO da sala (`requirePlayerOnActiveScene`); o GM em qualquer mapa.
 */
export function registerCombatHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "combat:start",
    guarded(
      socket,
      CombatStartSchema,
      async ({ sceneId, tokenIds: rawTokenIds, visibility }, ctx) => {
        await requireScene(sceneId, ctx.roomId);
        // Dedup: `IN` no banco não repete linha pra id repetido, então comparar por tamanho cru rejeitaria à toa.
        const tokenIds = [...new Set(rawTokenIds)];
        const tokens = await prisma.token.findMany({ where: { id: { in: tokenIds }, sceneId, deletedAt: null } });
        if (tokens.length !== tokenIds.length) throw new HandlerError("Token não encontrado neste mapa");

        const def = await requireSystem(ctx.roomId);
        // Substitui um combate anterior do mapa, se houver (cascade apaga os combatentes dele).
        await prisma.combat.deleteMany({ where: { sceneId } });
        const combat = await prisma.combat.create({ data: { roomId: ctx.roomId, sceneId, round: 0, status: "rolling" } });

        for (let i = 0; i < tokenIds.length; i++) {
          const token = tokens.find((t) => t.id === tokenIds[i])!;
          const bonus = await initialBonusFor(def, token);
          await prisma.combatant.create({
            data: { combatId: combat.id, tokenId: token.id, characterId: token.characterId, bonus, order: i, addedRound: 0 },
          });
        }

        // "Rolar iniciativa dos NPCs ao iniciar o combate" (SPEC §3.5, opção da sala — padrão
        // ligada): rola sozinho, num card em lote, os combatentes sem dono; jogadores continuam
        // rolando a própria pelo botão de sempre. `visibility` = modo de rolagem de quem chamou
        // (o GM — ausente = "all"), mesmo campo que combat:roll usa.
        if (isAutoRollNpcInitiativeEnabled(ctx.roomId)) {
          const fresh = await requireCombat(sceneId, ctx.roomId);
          const npcs = fresh.combatants.filter((c) => c.token.ownerId === null && c.initiative === null);
          if (npcs.length > 0) {
            const me = await requireParticipant(ctx.participantId);
            await rollCombatantsInitiative(io, ctx.roomId, me, def, fresh.round, npcs, visibility ?? "all");
          }
        }

        return sendCombat(io, ctx.roomId, sceneId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "combat:add",
    guarded(
      socket,
      CombatAddSchema,
      async ({ sceneId, tokenIds, visibility }, ctx) => {
        const combat = await requireCombat(sceneId, ctx.roomId);
        const already = new Set(combat.combatants.map((c) => c.tokenId));
        // Dedup por Set: mesmo motivo do combat:start (IN no banco não repete linha).
        const newIds = [...new Set(tokenIds.filter((id) => !already.has(id)))];
        if (newIds.length === 0) return sendCombat(io, ctx.roomId, sceneId, viewerOf(ctx));

        const tokens = await prisma.token.findMany({ where: { id: { in: newIds }, sceneId: combat.sceneId, deletedAt: null } });
        if (tokens.length !== newIds.length) throw new HandlerError("Token não encontrado neste mapa");

        const def = await requireSystem(ctx.roomId);
        let order = Math.max(-1, ...combat.combatants.map((c) => c.order)) + 1;
        for (const token of tokens) {
          const bonus = await initialBonusFor(def, token);
          await prisma.combatant.create({
            data: { combatId: combat.id, tokenId: token.id, characterId: token.characterId, bonus, order: order++, addedRound: combat.round },
          });
        }

        // Mesma rolagem automática de NPCs de combat:start (SPEC §3.5) — só entre os reforços recém-criados.
        if (isAutoRollNpcInitiativeEnabled(ctx.roomId)) {
          const fresh = await requireCombat(sceneId, ctx.roomId);
          const npcs = fresh.combatants.filter((c) => newIds.includes(c.tokenId) && c.token.ownerId === null);
          if (npcs.length > 0) {
            const me = await requireParticipant(ctx.participantId);
            await rollCombatantsInitiative(io, ctx.roomId, me, def, fresh.round, npcs, visibility ?? "all");
          }
        }

        return sendCombat(io, ctx.roomId, sceneId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "combat:remove",
    guarded(
      socket,
      CombatRemoveSchema,
      async ({ sceneId, combatantIds }, ctx) => {
        const combat = await requireCombat(sceneId, ctx.roomId);
        const removed = new Set(combatantIds);
        const def = await requireSystem(ctx.roomId);
        const nextState = stateAfterRemoval(def, combat.combatants, { activeCombatantId: combat.activeCombatantId, round: combat.round }, removed);

        await prisma.combatant.deleteMany({ where: { id: { in: combatantIds }, combatId: combat.id } });
        await prisma.combat.update({ where: { id: combat.id }, data: { activeCombatantId: nextState.activeCombatantId, round: nextState.round } });
        await persistNormalizedOrder(combat.combatants.filter((c) => !removed.has(c.id)));
        await startTurnMovementIfChanged(def, combat.activeCombatantId, nextState.activeCombatantId);
        return sendCombat(io, ctx.roomId, sceneId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "combat:roll",
    guarded(socket, CombatRollSchema, async ({ sceneId, scope, combatantId, visibility }, ctx) => {
      await requirePlayerOnActiveScene(ctx.roomId, sceneId, ctx.role);
      const combat = await requireCombat(sceneId, ctx.roomId);
      const def = await requireSystem(ctx.roomId);
      const me = await requireParticipant(ctx.participantId);

      if ((scope === "npcs" || scope === "missing") && ctx.role !== "gm") throw new HandlerError("Apenas o GM pode fazer isso");

      let targets: CombatantRow[];
      switch (scope) {
        case "one": {
          if (!combatantId) throw new HandlerError("combatantId obrigatório para scope 'one'");
          const row = await requireCombatant(combat, combatantId);
          const { character } = await withCharacter(row);
          if (!canControlCombatant(viewerOf(ctx), row.token, character)) throw new HandlerError("Você não controla este combatente");
          targets = [row];
          break;
        }
        case "self": {
          const checked = await Promise.all(combat.combatants.filter((c) => c.initiative === null).map((row) => withCharacter(row)));
          targets = checked.filter(({ row, character }) => canControlCombatant(viewerOf(ctx), row.token, character)).map(({ row }) => row);
          break;
        }
        case "npcs":
          targets = combat.combatants.filter((c) => c.initiative === null && c.token.ownerId === null);
          break;
        case "missing":
          targets = combat.combatants.filter((c) => c.initiative === null);
          break;
      }

      // Mais de um combatente de uma vez: um card só (initiative-batch), não um por combatente
      // (§3.5). Um combatente só (o caso comum de scope self/one) continua como card individual.
      await rollCombatantsInitiative(io, ctx.roomId, me, def, combat.round, targets, visibility ?? "all");

      return sendCombat(io, ctx.roomId, sceneId, viewerOf(ctx));
    }),
  );

  socket.on(
    "combat:set-initiative",
    guarded(
      socket,
      CombatSetInitiativeSchema,
      async ({ sceneId, combatantId, initiative, bonus }, ctx) => {
        const combat = await requireCombat(sceneId, ctx.roomId);
        await requireCombatant(combat, combatantId);
        // Valor digitado à mão não é "rolagem às cegas": fica visível ao dono na lista.
        await prisma.combatant.update({
          where: { id: combatantId },
          data: { initiative, lastRollVisibility: null, ...(bonus !== undefined ? { bonus } : {}) },
        });
        return sendCombat(io, ctx.roomId, sceneId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "combat:set-surprised",
    guarded(
      socket,
      CombatSetSurprisedSchema,
      async ({ sceneId, combatantId, surprised }, ctx) => {
        const combat = await requireCombat(sceneId, ctx.roomId);
        await requireCombatant(combat, combatantId);
        await prisma.combatant.update({ where: { id: combatantId }, data: { surprised } });
        return sendCombat(io, ctx.roomId, sceneId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "combat:next",
    guarded(
      socket,
      CombatSceneSchema,
      async ({ sceneId }, ctx) => {
        const combat = await requireCombat(sceneId, ctx.roomId);
        if (combat.status === "ended") throw new HandlerError("Combate encerrado");
        const def = await requireSystem(ctx.roomId);
        const sorted = sortCombatants(def, combat.combatants);
        const state =
          combat.status === "rolling"
            ? startTurns(def, sorted)
            : advanceTurn(def, sorted, { activeCombatantId: combat.activeCombatantId, round: combat.round }, 1);
        const nextRound = Math.max(1, state.round);
        await prisma.combat.update({
          where: { id: combat.id },
          data: { status: "active", activeCombatantId: state.activeCombatantId, round: nextRound },
        });
        // Rodada mudou: expira condições com expiresRound <= nextRound (combat:prev não restaura
        // nada — decisão deliberada, ver docs/plano-duracao-condicoes.md).
        if (nextRound > combat.round) {
          await expireConditionsOnRoundChange(io, ctx.roomId, combat.sceneId, def, ctx.participantId, nextRound);
        }
        // Novo combatente da vez: orçamento de deslocamento zera e ancora na posição atual dele.
        await startTurnMovementIfChanged(def, combat.activeCombatantId, state.activeCombatantId);
        return sendCombat(io, ctx.roomId, sceneId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "combat:prev",
    guarded(
      socket,
      CombatSceneSchema,
      // Decisão deliberada: não restaura condição nenhuma (mesmo se a rodada volta pra antes de
      // uma que expirou em combat:next). "Prev" corrige um clique errado do GM, não rejoga o
      // combate — ver docs/plano-duracao-condicoes.md.
      async ({ sceneId }, ctx) => {
        const combat = await requireCombat(sceneId, ctx.roomId);
        if (combat.status !== "active") throw new HandlerError("Combate não está em andamento");
        const def = await requireSystem(ctx.roomId);
        const sorted = sortCombatants(def, combat.combatants);
        const state = advanceTurn(def, sorted, { activeCombatantId: combat.activeCombatantId, round: combat.round }, -1);
        await prisma.combat.update({ where: { id: combat.id }, data: { activeCombatantId: state.activeCombatantId, round: state.round } });
        await startTurnMovementIfChanged(def, combat.activeCombatantId, state.activeCombatantId);
        return sendCombat(io, ctx.roomId, sceneId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "combat:reorder",
    guarded(
      socket,
      CombatReorderSchema,
      async ({ sceneId, combatantIds }, ctx) => {
        const combat = await requireCombat(sceneId, ctx.roomId);
        const known = new Set(combat.combatants.map((c) => c.id));
        // new Set(combatantIds) pega repetição (senão um id duas vezes + outro faltando passaria: mesmo
        // tamanho, todos conhecidos, mas cobrindo só combatantIds.length - 1 combatentes de verdade).
        const unique = new Set(combatantIds);
        if (unique.size !== known.size || !combatantIds.every((id) => known.has(id))) {
          throw new HandlerError("A nova ordem precisa conter todos os combatentes, sem repetir");
        }
        await Promise.all(combatantIds.map((id, order) => prisma.combatant.update({ where: { id }, data: { order } })));
        return sendCombat(io, ctx.roomId, sceneId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "combat:delay",
    guarded(socket, CombatDelaySchema, async ({ sceneId, combatantId }, ctx) => {
      await requirePlayerOnActiveScene(ctx.roomId, sceneId, ctx.role);
      const combat = await requireCombat(sceneId, ctx.roomId);
      if (combat.status !== "active") throw new HandlerError("Combate não está em andamento");
      if (combat.activeCombatantId !== combatantId) throw new HandlerError("Só é possível adiar no seu turno");
      const row = await requireCombatant(combat, combatantId);
      const character = await linkedCharacter(row.token);
      if (!canControlCombatant(viewerOf(ctx), row.token, character)) throw new HandlerError("Você não controla este combatente");

      const def = await requireSystem(ctx.roomId);
      await prisma.combatant.update({ where: { id: combatantId }, data: { delayed: true } });
      const updated = combat.combatants.map((c) => (c.id === combatantId ? { ...c, delayed: true } : c));
      const sorted = sortCombatants(def, updated);
      const state = advanceTurn(def, sorted, { activeCombatantId: combatantId, round: combat.round }, 1);
      await prisma.combat.update({ where: { id: combat.id }, data: { activeCombatantId: state.activeCombatantId, round: state.round } });
      await startTurnMovementIfChanged(def, combatantId, state.activeCombatantId);
      return sendCombat(io, ctx.roomId, sceneId, viewerOf(ctx));
    }),
  );

  socket.on(
    "combat:resume",
    guarded(socket, CombatResumeSchema, async ({ sceneId, combatantId }, ctx) => {
      await requirePlayerOnActiveScene(ctx.roomId, sceneId, ctx.role);
      const combat = await requireCombat(sceneId, ctx.roomId);
      const row = await requireCombatant(combat, combatantId);
      if (!row.delayed) throw new HandlerError("Este combatente não está adiado");
      if (!combat.activeCombatantId) throw new HandlerError("Não há ninguém agindo agora");
      const character = await linkedCharacter(row.token);
      if (!canControlCombatant(viewerOf(ctx), row.token, character)) throw new HandlerError("Você não controla este combatente");
      const def = await requireSystem(ctx.roomId);

      const reordered = resumePlacement(combat.combatants, combat.activeCombatantId, combatantId);
      await Promise.all(
        reordered.map((c) =>
          prisma.combatant.update({
            where: { id: c.id },
            // O valor copiado do combatente ativo não é uma rolagem do dono deste combatente (pode
            // até ser de outro jogador, ou de um NPC secreto do GM): fica marcado como "às cegas"
            // pra não vazar pra ele na lista, mesmo que a rolagem original fosse pública.
            data: { order: c.order, ...(c.id === combatantId ? { initiative: c.initiative, bonus: c.bonus, delayed: false, lastRollVisibility: "gm" } : {}) },
          }),
        ),
      );
      await prisma.combat.update({ where: { id: combat.id }, data: { activeCombatantId: combatantId } });
      // "Entra agora" começa a agir imediatamente: orçamento de deslocamento dele zera aqui, não
      // espera o próximo combat:next (é o próprio turno dele, interrompendo quem tava na vez).
      await startTurnMovement(def, combatantId);
      return sendCombat(io, ctx.roomId, sceneId, viewerOf(ctx));
    }),
  );

  socket.on(
    "combat:end",
    guarded(
      socket,
      CombatEndSchema,
      async ({ sceneId, clear }, ctx) => {
        const combat = await requireCombat(sceneId, ctx.roomId);
        if (clear) {
          // Combate acabou: condição com duração não vira permanente, some (permanente fica).
          const def = await requireSystem(ctx.roomId);
          await stripTimedConditionsOnCombatEnd(io, ctx.roomId, combat.sceneId, def, ctx.participantId);
          await prisma.combat.delete({ where: { id: combat.id } });
        } else {
          await prisma.combat.update({ where: { id: combat.id }, data: { status: "ended", activeCombatantId: null } });
        }
        await sendCombat(io, ctx.roomId, sceneId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );

  // Orçamento de deslocamento por turno (docs/plano-movimento.md §4.3).
  socket.on(
    "combat:set-movement",
    guarded(
      socket,
      CombatSetMovementSchema,
      async ({ sceneId, combatantId, budget, used }, ctx) => {
        const combat = await requireCombat(sceneId, ctx.roomId);
        const row = await requireCombatant(combat, combatantId);
        const def = await requireSystem(ctx.roomId);

        const data: { movementBudget?: number; movementUsed?: number; movementDiagonals?: number; movementAnchorX?: number; movementAnchorY?: number; movementPath?: { x: number; y: number }[] } = {};
        // budget === null: "voltar a seguir a ficha" — recalcula do zero (override → ficha → default).
        if (budget !== undefined) data.movementBudget = budget === null ? await resolveBudget(def, row.token) : budget;
        // Zerar o gasto (botão do painel) também reinicia a âncora/caminho: não sobra diagonal
        // "pendurada" nem um caminho desenhado que já não bate com o gasto zerado.
        if (used !== undefined) {
          data.movementUsed = used;
          data.movementDiagonals = 0;
          data.movementAnchorX = row.token.x;
          data.movementAnchorY = row.token.y;
          data.movementPath = [{ x: row.token.x, y: row.token.y }];
        }
        if (Object.keys(data).length > 0) await prisma.combatant.update({ where: { id: combatantId }, data });
        return sendCombat(io, ctx.roomId, sceneId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "combat:set-movement-limit",
    guarded(
      socket,
      CombatSetMovementLimitSchema,
      async ({ enabled }, ctx) => {
        setMovementLimitEnabled(ctx.roomId, enabled);
        io.to(rooms.all(ctx.roomId)).emit("combat:movementLimitChanged", { enabled });
        return { enabled };
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "combat:set-auto-roll-npc-initiative",
    guarded(
      socket,
      CombatSetAutoRollNpcInitiativeSchema,
      async ({ enabled }, ctx) => {
        setAutoRollNpcInitiativeEnabled(ctx.roomId, enabled);
        io.to(rooms.all(ctx.roomId)).emit("combat:autoRollNpcInitiativeChanged", { enabled });
        return { enabled };
      },
      { gmOnly: true },
    ),
  );
}
