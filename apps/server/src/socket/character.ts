import {
  CharacterCreateSchema,
  CharacterDataSchema,
  CharacterDeleteSchema,
  CharacterPlaceTokenSchema,
  CharacterRollSchema,
  CharacterUpdateSchema,
  CharacterUseItemSchema,
  ItemUseError,
  RollBuildError,
  addToParty,
  buildCharacterRoll,
  buildItemUse,
  computeCharacter,
  createDefaultCharacterData,
  removeFromParty,
  resolveTokenDefaults,
  validateCharacterItems,
  type SystemDefinition,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import {
  broadcastCharacter,
  canEditCharacter,
  characterDataOf,
  findLinkedTokenId,
  requireCharacter,
  requireSystem,
  toCharacter,
  toJson,
} from "../services/characters.js";
import { emitChatMessage } from "../services/chatVisibility.js";
import { sceneGeometry } from "../services/grid.js";
import { describePlaceToken, pushEntry } from "../services/history.js";
import { freeSpotNear } from "../services/placement.js";
import { partyOf, pruneFromParty, saveAndBroadcastParty } from "../services/party.js";
import { createRollMessage, type RollTargetInput } from "../services/rolls.js";
import { toChatMessage, toScene, toToken } from "../services/serialize.js";
import { filterTargetTokensByScene, getTargets } from "../services/targets.js";
import { isActiveScene } from "../services/visibility.js";
import { guarded, HandlerError } from "./ack.js";
import { emitHistoryUpdated } from "./history.js";
import { buildMultiSpawnHistoryEntry } from "./spawnHistory.js";
import { broadcastToken } from "./token.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

/**
 * Alvos marcados pelo autor (docs/plano-alvos.md) prontos pra `createRollMessage`: ações de ATAQUE
 * e de DANO constroem `roll.targets[]` (§9.13 — congelados na hora da rolagem, pro "Aplicar"
 * pré-selecionar certo mesmo que quem for aplicar depois não seja quem rolou); só teste/
 * atributo/iniciativa/fórmula solta não chamam isto. Ids inválidos (token apagado, de outra sala)
 * OU de um mapa que não é o que o autor está VENDO agora (`sceneId` gravado da última vez que ele
 * chamou `target:set` — não o mapa do personagem nem o da ação) são descartados em silêncio
 * (docs/revisao-alvos.md §5.2: sem isso, um alvo esquecido marcado noutro mapa continuava entrando
 * na conta de um ataque feito depois de o GM já ter navegado pra outro lugar).
 */
async function loadRollTargets(roomId: string, def: SystemDefinition, targetTokenIds: string[], authorParticipantId: string): Promise<RollTargetInput[]> {
  if (targetTokenIds.length === 0) return [];
  const allRows = await prisma.token.findMany({ where: { id: { in: targetTokenIds }, deletedAt: null, scene: { roomId } } });
  const viewingSceneId = getTargets(roomId, authorParticipantId)?.sceneId;
  const rows = filterTargetTokensByScene(targetTokenIds, allRows, viewingSceneId);
  const charIds = [...new Set(rows.map((r) => r.characterId).filter((id): id is string => id !== null))];
  const chars = charIds.length > 0 ? await prisma.character.findMany({ where: { id: { in: charIds } } }) : [];
  const charById = new Map(chars.map((c) => [c.id, toCharacter(c)]));
  return rows.map((row) => {
    const targetCharacter = row.characterId ? charById.get(row.characterId) : undefined;
    return { tokenId: row.id, name: row.name, computed: targetCharacter ? computeCharacter(def, targetCharacter) : null };
  });
}

async function requireOwnerInRoom(ownerId: string | null, roomId: string): Promise<void> {
  if (!ownerId) return;
  const owner = await prisma.participant.findUnique({ where: { id: ownerId } });
  if (!owner || owner.roomId !== roomId) throw new HandlerError("Dono inválido");
}

export function registerCharacterHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "character:create",
    guarded(socket, CharacterCreateSchema, async (input, ctx) => {
      // Jogador só cria ficha para si mesmo, e sempre de personagem-jogador.
      const ownerId = ctx.role === "gm" ? input.ownerId : ctx.participantId;
      const kind = ctx.role === "gm" ? input.kind : "pc";
      await requireOwnerInRoom(ownerId, ctx.roomId);

      const def = await requireSystem(ctx.roomId);
      const row = await prisma.character.create({
        data: { roomId: ctx.roomId, ownerId, name: input.name, kind, data: toJson(createDefaultCharacterData(def)) },
      });
      const character = toCharacter(row);
      broadcastCharacter(io, ctx.roomId, character, "character:created");
      // Visão de grupo (SPEC §9.15): todo PC novo já entra no grupo sozinho, no fim da faixa.
      if (kind === "pc") {
        const currentParty = await prisma.room.findUnique({ where: { id: ctx.roomId }, select: { party: true } });
        if (currentParty) await saveAndBroadcastParty(io, ctx.roomId, addToParty(partyOf(currentParty), character.id));
      }
      return character;
    }),
  );

  socket.on(
    "character:update",
    guarded(socket, CharacterUpdateSchema, async ({ id, patch }, ctx) => {
      const row = await requireCharacter(id, ctx.roomId);
      const current = toCharacter(row);
      if (!canEditCharacter(ctx, current)) throw new HandlerError("Você não controla esta ficha");

      const { name, ownerId, kind, ...dataPatch } = patch;
      // Dono e tipo são só do GM; do jogador, ignoramos em silêncio (como no token).
      const nextOwnerId = ctx.role === "gm" && ownerId !== undefined ? ownerId : current.ownerId;
      const nextKind = ctx.role === "gm" && kind !== undefined ? kind : current.kind;
      await requireOwnerInRoom(nextOwnerId, ctx.roomId);

      // Patch raso sobre os dados atuais; o Zod garante que o resultado é uma ficha válida.
      const merged = CharacterDataSchema.parse({ ...characterDataOf(current), ...dataPatch });
      // Regras que dependem do sistema (tipo de item existente, no máximo 1 raça...).
      const itemsError = validateCharacterItems(await requireSystem(ctx.roomId), merged);
      if (itemsError) throw new HandlerError(itemsError);
      const updated = toCharacter(
        await prisma.character.update({
          where: { id },
          data: { name: name ?? current.name, ownerId: nextOwnerId, kind: nextKind, data: toJson(merged) },
        }),
      );
      broadcastCharacter(io, ctx.roomId, updated, "character:updated", current.kind);
      // Visão de grupo (SPEC §9.15): deixou de ser PC → sai do grupo (não é mais "o grupo" pra
      // ninguém, GM inclusive — mesma regra de partyFor). Vira NPC de novo não volta sozinho: o GM
      // usa "+ Adicionar ao grupo" se quiser, igual a qualquer PC que nunca entrou.
      if (current.kind === "pc" && nextKind !== "pc") await pruneFromParty(io, ctx.roomId, id);
      return updated;
    }),
  );

  socket.on(
    "character:delete",
    guarded(socket, CharacterDeleteSchema, async ({ characterId }, ctx) => {
      const row = await requireCharacter(characterId, ctx.roomId);
      if (!canEditCharacter(ctx, toCharacter(row))) throw new HandlerError("Você não controla esta ficha");

      // O banco desvincula os tokens (onDelete: SetNull, dispara pra QUALQUER token que referencie
      // esta ficha — inclusive soft-deleted, docs/plano-desfazer.md §2); só avisamos os clientes dos
      // que estão de pé (deletedAt: null). Um token na lixeira fica com characterId nulo em silêncio
      // (o SetNull do banco já rodou de qualquer forma) — se for restaurado depois, o desfazer já vê
      // a ficha desvinculada, sem token:updated nenhum reintroduzindo ele no mapa antes da hora.
      const linked = await prisma.token.findMany({ where: { characterId, deletedAt: null }, include: { scene: true } });
      await prisma.character.delete({ where: { id: characterId } });
      io.to(rooms.all(ctx.roomId)).emit("character:deleted", { characterId });
      for (const t of linked) broadcastToken(io, ctx.roomId, toToken({ ...t, characterId: null }), "token:updated", sceneGeometry(toScene(t.scene)));
      // Visão de grupo (SPEC §9.15): ficha apagada some do grupo também.
      await pruneFromParty(io, ctx.roomId, characterId);
    }),
  );

  /**
   * "Colocar no mapa" (docs/SPEC.md §9.30): a ficha é a prateleira do personagem, o token é só a
   * presença dela neste mapa — então aqui NÃO se cria ficha nenhuma, só um token já vinculado com a
   * aparência guardada em `tokenDefaults`. Não é `token:create` + `token:link-character` porque
   * `token:create` é gmOnly: o jogador precisa poder colocar o PRÓPRIO personagem no mapa.
   */
  socket.on(
    "character:place-token",
    guarded(socket, CharacterPlaceTokenSchema, async ({ characterId, sceneId, x, y }, ctx) => {
      const character = toCharacter(await requireCharacter(characterId, ctx.roomId));
      if (!canEditCharacter(ctx, character)) throw new HandlerError("Você não controla esta ficha");
      const sceneRow = await prisma.scene.findUnique({ where: { id: sceneId } });
      if (!sceneRow || sceneRow.roomId !== ctx.roomId || sceneRow.deletedAt !== null) throw new HandlerError("Mapa não encontrado");
      // Mesma defesa em profundidade de token:update (docs/plano-mapas.md §11): jogador só mexe no
      // mapa ATIVO da sala; o GM coloca em qualquer mapa que esteja vendo.
      if (ctx.role !== "gm" && !(await isActiveScene(ctx.roomId, sceneId))) throw new HandlerError("Este mapa não está aberto na mesa");

      const scene = toScene(sceneRow);
      const appearance = resolveTokenDefaults(character.tokenDefaults);
      const point = await freeSpotNear(scene, { x, y }, appearance.cells);
      const zIndex = await prisma.token.count({ where: { sceneId, deletedAt: null } });
      const token = toToken(
        await prisma.token.create({
          data: {
            sceneId,
            // O nome do token é mais curto que o da ficha (64 vs. 80, TokenSchema).
            name: character.name.slice(0, 64),
            imageUrl: appearance.imageUrl,
            x: point.x,
            y: point.y,
            cells: appearance.cells,
            zIndex: zIndex + 1,
            // NPC nasce oculto (só o GM vê), como o padrão de soltar criatura do compêndio: colocar
            // um NPC no mapa pra preparar a cena não pode entregar a surpresa. PC nasce visível.
            visible: character.kind === "pc",
            ownerId: character.ownerId,
            color: appearance.color,
            characterId: character.id,
          },
        }),
      );
      broadcastToken(io, ctx.roomId, token, "token:created", sceneGeometry(scene));

      if (ctx.role === "gm") {
        const def = await requireSystem(ctx.roomId);
        // `character: null` = desfazer apaga só o token; a ficha continua na prateleira.
        pushEntry(ctx.roomId, buildMultiSpawnHistoryEntry(io, ctx.roomId, sceneId, def, describePlaceToken(token.name), [{ character: null, token }]));
        emitHistoryUpdated(io, ctx.roomId);
      }
      return token;
    }),
  );

  socket.on(
    "character:roll",
    guarded(socket, CharacterRollSchema, async ({ characterId, roll, visibility, targetTokenIds }, ctx) => {
      const me = await prisma.participant.findUnique({ where: { id: ctx.participantId } });
      if (!me) throw new HandlerError("Participante não encontrado");
      const character = toCharacter(await requireCharacter(characterId, ctx.roomId));
      if (!canEditCharacter(ctx, character)) throw new HandlerError("Você não controla esta ficha");

      const def = await requireSystem(ctx.roomId);
      let built;
      try {
        built = buildCharacterRoll(def, character, roll);
      } catch (err) {
        if (err instanceof RollBuildError) throw new HandlerError(err.message);
        throw err;
      }

      const tokenId = await findLinkedTokenId(character.id, ctx.roomId);
      // Alvos (docs/plano-alvos.md, §9.13): ataque OU ação de dano (avulsa, ou junto do ataque)
      // congelam roll.targets — só um teste/atributo/iniciativa/fórmula solta não tem "alvo" nenhum.
      const hasTargets = built.isAttack || (built.damage && built.damage.length > 0);
      const targets = hasTargets ? await loadRollTargets(ctx.roomId, def, targetTokenIds, ctx.participantId) : [];
      const { message } = await createRollMessage(io, ctx.roomId, me, {
        formula: built.formula,
        label: `${character.name}: ${built.label}`,
        visibility,
        characterId: character.id,
        critThreshold: built.critThreshold,
        critMult: built.critMult,
        damage: built.damage,
        allowNoDice: true,
        tokenId,
        targets,
        isAttack: built.isAttack,
        def,
      });
      return message;
    }),
  );

  socket.on(
    "character:use-item",
    guarded(socket, CharacterUseItemSchema, async ({ characterId, itemId, enhancements }, ctx) => {
      const me = await prisma.participant.findUnique({ where: { id: ctx.participantId } });
      if (!me) throw new HandlerError("Participante não encontrado");
      const character = toCharacter(await requireCharacter(characterId, ctx.roomId));
      if (!canEditCharacter(ctx, character)) throw new HandlerError("Você não controla esta ficha");

      const def = await requireSystem(ctx.roomId);
      let use;
      try {
        // A escolha de aprimoramentos é validada contra o item e cobrada no custo total (regras no shared).
        use = buildItemUse(def, character, itemId, enhancements);
      } catch (err) {
        // Recurso insuficiente / item passivo / aprimoramento inválido: o ack leva a mensagem e nada é publicado.
        if (err instanceof ItemUseError) throw new HandlerError(err.message);
        throw err;
      }

      // 1. Desconta o custo (se houver) e avisa a sala: a ficha muda antes do card aparecer.
      if (use.spend) {
        const data = CharacterDataSchema.parse({ ...characterDataOf(character), resources: use.spend.resources });
        const updated = toCharacter(await prisma.character.update({ where: { id: characterId }, data: { data: toJson(data) } }));
        broadcastCharacter(io, ctx.roomId, updated, "character:updated");
      }

      // 2. Publica o card. Sempre "all" (SPEC: cards de item são sempre públicos), mas ligado
      // ao token da ficha na cena ativa — quem não vê esse token não recebe o card.
      const tokenId = await findLinkedTokenId(character.id, ctx.roomId);
      const msg = toChatMessage(
        await prisma.chatMessage.create({
          data: { roomId: ctx.roomId, participantId: me.id, nickname: me.nickname, kind: "item", item: use.card, tokenId: tokenId ?? null },
        }),
      );
      await emitChatMessage(io, ctx.roomId, msg);
      return msg;
    }),
  );
}
