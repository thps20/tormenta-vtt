import {
  CombatAddSchema,
  CombatDelaySchema,
  CombatEndSchema,
  CombatRemoveSchema,
  CombatReorderSchema,
  CombatResumeSchema,
  CombatRollSchema,
  CombatSetInitiativeSchema,
  CombatSetSurprisedSchema,
  CombatStartSchema,
  EmptySchema,
  advanceTurn,
  resumePlacement,
  sortCombatants,
  startTurns,
  stateAfterRemoval,
  type Combat,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import {
  buildCombatantInitiativeRoll,
  canControlCombatant,
  expireConditionsOnRoundChange,
  initialBonusFor,
  linkedCharacter,
  persistNormalizedOrder,
  requireActiveCombat,
  requireActiveScene,
  stripTimedConditionsOnCombatEnd,
  emitCombat as sendCombat,
  type CombatantRow,
  type CombatRow,
  type Viewer,
} from "../services/combat.js";
import { requireSystem } from "../services/characters.js";
import { createInitiativeBatchRoll, createRollMessage } from "../services/rolls.js";
import { guarded, HandlerError } from "./ack.js";
import { type TypedServer, type TypedSocket } from "./types.js";

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

export function registerCombatHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "combat:start",
    guarded(
      socket,
      CombatStartSchema,
      async ({ sceneId, tokenIds: rawTokenIds }, ctx) => {
        await requireActiveScene(ctx.roomId, sceneId);
        // Dedup: `IN` no banco não repete linha pra id repetido, então comparar por tamanho cru rejeitaria à toa.
        const tokenIds = [...new Set(rawTokenIds)];
        const tokens = await prisma.token.findMany({ where: { id: { in: tokenIds }, sceneId, deletedAt: null } });
        if (tokens.length !== tokenIds.length) throw new HandlerError("Token não encontrado nesta cena");

        const def = await requireSystem(ctx.roomId);
        // Substitui um combate anterior da cena, se houver (cascade apaga os combatentes dele).
        await prisma.combat.deleteMany({ where: { sceneId } });
        const combat = await prisma.combat.create({ data: { roomId: ctx.roomId, sceneId, round: 0, status: "rolling" } });

        for (let i = 0; i < tokenIds.length; i++) {
          const token = tokens.find((t) => t.id === tokenIds[i])!;
          const bonus = await initialBonusFor(def, token);
          await prisma.combatant.create({
            data: { combatId: combat.id, tokenId: token.id, characterId: token.characterId, bonus, order: i, addedRound: 0 },
          });
        }

        return sendCombat(io, ctx.roomId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "combat:add",
    guarded(
      socket,
      CombatAddSchema,
      async ({ tokenIds }, ctx) => {
        const combat = await requireActiveCombat(ctx.roomId);
        const already = new Set(combat.combatants.map((c) => c.tokenId));
        // Dedup por Set: mesmo motivo do combat:start (IN no banco não repete linha).
        const newIds = [...new Set(tokenIds.filter((id) => !already.has(id)))];
        if (newIds.length === 0) return sendCombat(io, ctx.roomId, viewerOf(ctx));

        const tokens = await prisma.token.findMany({ where: { id: { in: newIds }, sceneId: combat.sceneId, deletedAt: null } });
        if (tokens.length !== newIds.length) throw new HandlerError("Token não encontrado nesta cena");

        const def = await requireSystem(ctx.roomId);
        let order = Math.max(-1, ...combat.combatants.map((c) => c.order)) + 1;
        for (const token of tokens) {
          const bonus = await initialBonusFor(def, token);
          await prisma.combatant.create({
            data: { combatId: combat.id, tokenId: token.id, characterId: token.characterId, bonus, order: order++, addedRound: combat.round },
          });
        }
        return sendCombat(io, ctx.roomId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "combat:remove",
    guarded(
      socket,
      CombatRemoveSchema,
      async ({ combatantIds }, ctx) => {
        const combat = await requireActiveCombat(ctx.roomId);
        const removed = new Set(combatantIds);
        const def = await requireSystem(ctx.roomId);
        const nextState = stateAfterRemoval(def, combat.combatants, { activeCombatantId: combat.activeCombatantId, round: combat.round }, removed);

        await prisma.combatant.deleteMany({ where: { id: { in: combatantIds }, combatId: combat.id } });
        await prisma.combat.update({ where: { id: combat.id }, data: { activeCombatantId: nextState.activeCombatantId, round: nextState.round } });
        await persistNormalizedOrder(combat.combatants.filter((c) => !removed.has(c.id)));
        return sendCombat(io, ctx.roomId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "combat:roll",
    guarded(socket, CombatRollSchema, async ({ scope, combatantId, visibility }, ctx) => {
      const combat = await requireActiveCombat(ctx.roomId);
      const def = await requireSystem(ctx.roomId);
      const me = await prisma.participant.findUnique({ where: { id: ctx.participantId } });
      if (!me) throw new HandlerError("Participante não encontrado");

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

      const rollVisibility = visibility ?? "all";

      // Mais de um combatente de uma vez: um card só (initiative-batch), não um por combatente
      // (§3.5). Um combatente só (o caso comum de scope self/one) continua como card individual.
      if (targets.length > 1) {
        const built = await Promise.all(targets.map((row) => buildCombatantInitiativeRoll(def, row)));
        const { results } = await createInitiativeBatchRoll(io, ctx.roomId, me, {
          round: combat.round,
          visibility: rollVisibility,
          entries: targets.map((row, i) => ({ combatantId: row.id, tokenId: row.tokenId, name: row.token.name, formula: built[i]!.formula })),
        });
        // lastRollVisibility: "gm" (rolagem às cegas) esconde o valor até do próprio dono na lista
        // (toCombat) — mesma regra do chat: quem rolou não vê o próprio resultado.
        await Promise.all(
          targets.map((row) =>
            prisma.combatant.update({ where: { id: row.id }, data: { initiative: results.get(row.id)!, lastRollVisibility: rollVisibility } }),
          ),
        );
      } else {
        for (const row of targets) {
          const built = await buildCombatantInitiativeRoll(def, row);
          const { total } = await createRollMessage(io, ctx.roomId, me, {
            formula: built.formula,
            label: built.label,
            visibility: rollVisibility,
            characterId: built.characterId,
            tokenId: row.tokenId,
            allowNoDice: true,
          });
          await prisma.combatant.update({ where: { id: row.id }, data: { initiative: total, lastRollVisibility: rollVisibility } });
        }
      }

      return sendCombat(io, ctx.roomId, viewerOf(ctx));
    }),
  );

  socket.on(
    "combat:set-initiative",
    guarded(
      socket,
      CombatSetInitiativeSchema,
      async ({ combatantId, initiative, bonus }, ctx) => {
        const combat = await requireActiveCombat(ctx.roomId);
        await requireCombatant(combat, combatantId);
        // Valor digitado à mão não é "rolagem às cegas": fica visível ao dono na lista.
        await prisma.combatant.update({
          where: { id: combatantId },
          data: { initiative, lastRollVisibility: null, ...(bonus !== undefined ? { bonus } : {}) },
        });
        return sendCombat(io, ctx.roomId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "combat:set-surprised",
    guarded(
      socket,
      CombatSetSurprisedSchema,
      async ({ combatantId, surprised }, ctx) => {
        const combat = await requireActiveCombat(ctx.roomId);
        await requireCombatant(combat, combatantId);
        await prisma.combatant.update({ where: { id: combatantId }, data: { surprised } });
        return sendCombat(io, ctx.roomId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "combat:next",
    guarded(
      socket,
      EmptySchema,
      async (_p, ctx) => {
        const combat = await requireActiveCombat(ctx.roomId);
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
        return sendCombat(io, ctx.roomId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "combat:prev",
    guarded(
      socket,
      EmptySchema,
      // Decisão deliberada: não restaura condição nenhuma (mesmo se a rodada volta pra antes de
      // uma que expirou em combat:next). "Prev" corrige um clique errado do GM, não rejoga o
      // combate — ver docs/plano-duracao-condicoes.md.
      async (_p, ctx) => {
        const combat = await requireActiveCombat(ctx.roomId);
        if (combat.status !== "active") throw new HandlerError("Combate não está em andamento");
        const def = await requireSystem(ctx.roomId);
        const sorted = sortCombatants(def, combat.combatants);
        const state = advanceTurn(def, sorted, { activeCombatantId: combat.activeCombatantId, round: combat.round }, -1);
        await prisma.combat.update({ where: { id: combat.id }, data: { activeCombatantId: state.activeCombatantId, round: state.round } });
        return sendCombat(io, ctx.roomId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "combat:reorder",
    guarded(
      socket,
      CombatReorderSchema,
      async ({ combatantIds }, ctx) => {
        const combat = await requireActiveCombat(ctx.roomId);
        const known = new Set(combat.combatants.map((c) => c.id));
        // new Set(combatantIds) pega repetição (senão um id duas vezes + outro faltando passaria: mesmo
        // tamanho, todos conhecidos, mas cobrindo só combatantIds.length - 1 combatentes de verdade).
        const unique = new Set(combatantIds);
        if (unique.size !== known.size || !combatantIds.every((id) => known.has(id))) {
          throw new HandlerError("A nova ordem precisa conter todos os combatentes, sem repetir");
        }
        await Promise.all(combatantIds.map((id, order) => prisma.combatant.update({ where: { id }, data: { order } })));
        return sendCombat(io, ctx.roomId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "combat:delay",
    guarded(socket, CombatDelaySchema, async ({ combatantId }, ctx) => {
      const combat = await requireActiveCombat(ctx.roomId);
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
      return sendCombat(io, ctx.roomId, viewerOf(ctx));
    }),
  );

  socket.on(
    "combat:resume",
    guarded(socket, CombatResumeSchema, async ({ combatantId }, ctx) => {
      const combat = await requireActiveCombat(ctx.roomId);
      const row = await requireCombatant(combat, combatantId);
      if (!row.delayed) throw new HandlerError("Este combatente não está adiado");
      if (!combat.activeCombatantId) throw new HandlerError("Não há ninguém agindo agora");
      const character = await linkedCharacter(row.token);
      if (!canControlCombatant(viewerOf(ctx), row.token, character)) throw new HandlerError("Você não controla este combatente");

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
      return sendCombat(io, ctx.roomId, viewerOf(ctx));
    }),
  );

  socket.on(
    "combat:end",
    guarded(
      socket,
      CombatEndSchema,
      async ({ clear }, ctx) => {
        const combat = await requireActiveCombat(ctx.roomId);
        if (clear) {
          // Combate acabou: condição com duração não vira permanente, some (permanente fica).
          const def = await requireSystem(ctx.roomId);
          await stripTimedConditionsOnCombatEnd(io, ctx.roomId, combat.sceneId, def, ctx.participantId);
          await prisma.combat.delete({ where: { id: combat.id } });
        } else {
          await prisma.combat.update({ where: { id: combat.id }, data: { status: "ended", activeCombatantId: null } });
        }
        await sendCombat(io, ctx.roomId, viewerOf(ctx));
      },
      { gmOnly: true },
    ),
  );
}
