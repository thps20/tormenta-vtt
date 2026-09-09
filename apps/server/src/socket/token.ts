import { Prisma } from "@prisma/client";
import {
  CharacterDataSchema,
  TokenApplyDamageSchema,
  TokenCreateSchema,
  TokenDeleteSchema,
  TokenHpSchema,
  TokenLinkCharacterSchema,
  TokenPatchSchema,
  applyResourceDelta,
  computeCharacter,
  type AppliedDamage,
  type FogConfig,
  type Token,
  type TokenHp,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import {
  broadcastCharacter,
  canEditCharacter,
  characterDataOf,
  requireCharacter,
  requireSystem,
  toCharacter,
  toJson,
} from "../services/characters.js";
import { checkApplyDamageTarget } from "../services/applyDamage.js";
import { emitCombat, loadCombatRow, maybeReemitCombatForToken, prepareTokenRemovalFromCombat } from "../services/combat.js";
import { emitChatMessage, messageVisibleTo } from "../services/chatVisibility.js";
import { canEditToken, restrictPatchForRole } from "../services/permissions.js";
import { toChatMessage, toScene, toToken } from "../services/serialize.js";
import { emitTokenToPlayers } from "../services/visibility.js";
import { guarded, HandlerError } from "./ack.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

/**
 * Carrega o token e confirma que a cena dele é desta sala. Um token soft-deleted
 * (docs/plano-desfazer.md §2) conta como "não encontrado" pra todo handler normal — só o
 * desfazer (services/history.ts) busca por baixo desse filtro, pra poder restaurá-lo.
 */
async function requireToken(tokenId: string, roomId: string) {
  const row = await prisma.token.findUnique({ where: { id: tokenId }, include: { scene: true } });
  if (!row || row.scene.roomId !== roomId || row.deletedAt !== null) throw new HandlerError("Token não encontrado");
  return row;
}

/** Json? do Prisma não aceita `null` cru (precisa de Prisma.JsonNull pra gravar SQL NULL). */
function hpJson(hp: TokenHp | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return hp === null ? Prisma.JsonNull : hp;
}

/**
 * Broadcast respeitando visibilidade: GM recebe sempre; jogadores só recebem o
 * token se puderem vê-lo (`visible` + névoa da cena), senão recebem token:deleted
 * (caso tenham ele em cache). Ver services/visibility.ts.
 */
export function broadcastToken(io: TypedServer, roomId: string, token: Token, event: "token:created" | "token:updated", fog: FogConfig) {
  io.to(rooms.gm(roomId)).emit(event, token);
  emitTokenToPlayers(io, roomId, token, event, fog);
}

export function registerTokenHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "token:create",
    guarded(socket, TokenCreateSchema, async (data, ctx) => {
      const scene = await prisma.scene.findUnique({ where: { id: data.sceneId } });
      if (!scene || scene.roomId !== ctx.roomId) throw new HandlerError("Cena não encontrada");
      if (data.ownerId) {
        const owner = await prisma.participant.findUnique({ where: { id: data.ownerId } });
        if (!owner || owner.roomId !== ctx.roomId) throw new HandlerError("Dono inválido");
      }
      const token = toToken(await prisma.token.create({ data: { ...data, hp: hpJson(data.hp) } }));
      broadcastToken(io, ctx.roomId, token, "token:created", toScene(scene).fog);
      return token;
    }, { gmOnly: true }),
  );

  socket.on(
    "token:update",
    guarded(socket, TokenPatchSchema, async (patch, ctx) => {
      const row = await requireToken(patch.id, ctx.roomId);
      if (!canEditToken(ctx, row)) throw new HandlerError("Você não controla este token");

      const { id, sceneId: _ignoreScene, hp, ...fields } = restrictPatchForRole(ctx, patch);
      if (fields.ownerId) {
        const owner = await prisma.participant.findUnique({ where: { id: fields.ownerId } });
        if (!owner || owner.roomId !== ctx.roomId) throw new HandlerError("Dono inválido");
      }
      if (fields.conditions) {
        const def = await requireSystem(ctx.roomId);
        const known = new Set(def.conditions.map((c) => c.key));
        if (fields.conditions.some((c) => !known.has(c.key))) throw new HandlerError("Condição inexistente no sistema da sala");
      }
      const token = toToken(await prisma.token.update({ where: { id }, data: { ...fields, ...(hp !== undefined ? { hp: hpJson(hp) } : {}) } }));
      const fog = toScene(row.scene).fog;
      // A cena já veio junto com o token (requireToken): sem consulta extra a cada movimento.
      broadcastToken(io, ctx.roomId, token, "token:updated", fog);
      // Nome/cor/visível mudaram, ou a posição cruzou a névoa: se este token é um combatente,
      // a lista de combate (e quem pode vê-la) pode ter mudado junto.
      await maybeReemitCombatForToken(io, ctx.roomId, toToken(row), token, fog);
      return token;
    }),
  );

  socket.on(
    "token:delete",
    guarded(socket, TokenDeleteSchema, async ({ tokenId }, ctx) => {
      const row = await requireToken(tokenId, ctx.roomId);
      if (!canEditToken(ctx, row)) throw new HandlerError("Você não controla este token");

      // Se o token é combatente de um combate, ajusta o cursor de turno ANTES de marcar
      // deletedAt: loadCombatRow (chamado por prepareTokenRemovalFromCombat via o `combat` daqui)
      // só filtra combatentes com token.deletedAt null, então depois disso ele já teria sumido.
      const combat = await loadCombatRow(row.sceneId);
      if (combat) {
        const def = await requireSystem(ctx.roomId);
        await prepareTokenRemovalFromCombat(def, combat, tokenId);
      }

      // Soft delete (docs/plano-desfazer.md §2): a linha continua no banco (PV, condições,
      // characterId, Combatant intactos) para o desfazer restaurar tudo sem precisar de snapshot.
      await prisma.token.update({ where: { id: tokenId }, data: { deletedAt: new Date() } });
      io.to(rooms.all(ctx.roomId)).emit("token:deleted", { tokenId });
      if (combat) await emitCombat(io, ctx.roomId, { role: ctx.role, participantId: ctx.participantId });
    }),
  );

  socket.on(
    "token:link-character",
    guarded(socket, TokenLinkCharacterSchema, async ({ tokenId, characterId }, ctx) => {
      const row = await requireToken(tokenId, ctx.roomId);
      if (!canEditToken(ctx, row)) throw new HandlerError("Você não controla este token");
      if (characterId) {
        // Jogador só vincula uma ficha que também é dele.
        const character = toCharacter(await requireCharacter(characterId, ctx.roomId));
        if (!canEditCharacter(ctx, character)) throw new HandlerError("Você não controla esta ficha");
      }
      const token = toToken(await prisma.token.update({ where: { id: tokenId }, data: { characterId } }));
      broadcastToken(io, ctx.roomId, token, "token:updated", toScene(row.scene).fog);
      return token;
    }),
  );

  socket.on(
    "token:apply-damage",
    guarded(socket, TokenApplyDamageSchema, async ({ messageId, targets }, ctx) => {
      const row = await prisma.chatMessage.findUnique({ where: { id: messageId } });
      if (!row || row.roomId !== ctx.roomId) throw new HandlerError("Mensagem não encontrada");
      const msg = toChatMessage(row);
      // Mesma regra de quem vê a mensagem (não dá pra aplicar num card que nem devia enxergar).
      if (!messageVisibleTo(msg, { role: ctx.role, participantId: ctx.participantId })) throw new HandlerError("Mensagem não encontrada");
      if (msg.kind !== "roll" || !msg.roll?.damage?.length) throw new HandlerError("Essa rolagem não tem dano/cura pra aplicar");
      const roll = msg.roll;

      // 1. Valida TUDO antes de aplicar qualquer alvo (tudo-ou-nada): permissão (dono ou GM)
      // e se o alvo tem PV pra mexer (ficha com recurso `tokenBar`, ou hp do token solto).
      const def = await requireSystem(ctx.roomId);
      const tokenRows = await Promise.all(targets.map((t) => requireToken(t.tokenId, ctx.roomId)));
      for (const tokenRow of tokenRows) {
        const error = checkApplyDamageTarget(ctx, tokenRow, def);
        if (error) throw new HandlerError(error);
      }

      // 2. Aplica: recurso `tokenBar` da ficha vinculada (dano gasta temp antes do current),
      // ou hp do próprio token quando solto. Lê fresco a cada alvo (dois alvos podem apontar
      // pra mesma ficha, ou o mesmo token repetido no lote).
      const applied: AppliedDamage[] = [];
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i]!;
        const tokenRow = tokenRows[i]!;

        if (tokenRow.characterId) {
          const resourceKey = def.tokenBar!;
          const character = toCharacter(await requireCharacter(tokenRow.characterId, ctx.roomId));
          const computed = computeCharacter(def, character);
          const bounds = computed.resources[resourceKey] ?? { max: 0, min: 0, detail: null };
          const res = character.resources[resourceKey] ?? { current: 0, temp: 0, maxOverride: null };
          const next = applyResourceDelta(res, target.amount, bounds);
          const data = CharacterDataSchema.parse({
            ...characterDataOf(character),
            resources: { ...character.resources, [resourceKey]: { ...res, ...next } },
          });
          const updated = toCharacter(await prisma.character.update({ where: { id: character.id }, data: { data: toJson(data) } }));
          broadcastCharacter(io, ctx.roomId, updated, "character:updated");
        } else {
          const fresh = await requireToken(tokenRow.id, ctx.roomId);
          const hp = TokenHpSchema.parse(fresh.hp);
          const next = applyResourceDelta({ current: hp.current, temp: 0 }, target.amount, { min: 0, max: hp.max });
          const updatedToken = toToken(
            await prisma.token.update({ where: { id: tokenRow.id }, data: { hp: hpJson({ current: next.current, max: hp.max }) } }),
          );
          broadcastToken(io, ctx.roomId, updatedToken, "token:updated", toScene(tokenRow.scene).fog);
        }

        applied.push({ tokenId: tokenRow.id, tokenName: tokenRow.name, amount: target.amount, multiplier: target.multiplier });
      }

      // 3. Acrescenta ao registro do card (nunca sobrescreve) e reemite pra quem já via a mensagem.
      const updatedRoll = { ...roll, applied: [...roll.applied, ...applied] };
      const updatedMsg = toChatMessage(await prisma.chatMessage.update({ where: { id: messageId }, data: { roll: updatedRoll } }));
      await emitChatMessage(io, ctx.roomId, updatedMsg);
      return updatedMsg;
    }),
  );
}
