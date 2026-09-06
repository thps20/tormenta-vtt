import {
  CharacterCreateSchema,
  CharacterDataSchema,
  CharacterDeleteSchema,
  CharacterRollSchema,
  CharacterUpdateSchema,
  CharacterUseItemSchema,
  ItemUseError,
  RollBuildError,
  buildCharacterRoll,
  buildItemUse,
  createDefaultCharacterData,
  getSystemDefinition,
  type SystemDefinition,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import {
  broadcastCharacter,
  canEditCharacter,
  characterDataOf,
  requireCharacter,
  toCharacter,
  toJson,
} from "../services/characters.js";
import { createRollMessage } from "../services/rolls.js";
import { toChatMessage, toScene, toToken } from "../services/serialize.js";
import { guarded, HandlerError } from "./ack.js";
import { broadcastToken } from "./token.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

async function requireSystem(roomId: string): Promise<SystemDefinition> {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) throw new HandlerError("Sala não encontrada");
  return getSystemDefinition(room.systemId);
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
      const updated = toCharacter(
        await prisma.character.update({
          where: { id },
          data: { name: name ?? current.name, ownerId: nextOwnerId, kind: nextKind, data: toJson(merged) },
        }),
      );
      broadcastCharacter(io, ctx.roomId, updated, "character:updated", current.kind);
      return updated;
    }),
  );

  socket.on(
    "character:delete",
    guarded(socket, CharacterDeleteSchema, async ({ characterId }, ctx) => {
      const row = await requireCharacter(characterId, ctx.roomId);
      if (!canEditCharacter(ctx, toCharacter(row))) throw new HandlerError("Você não controla esta ficha");

      // O banco desvincula os tokens (onDelete: SetNull); avisamos os clientes para atualizarem o cache.
      const linked = await prisma.token.findMany({ where: { characterId }, include: { scene: true } });
      await prisma.character.delete({ where: { id: characterId } });
      io.to(rooms.all(ctx.roomId)).emit("character:deleted", { characterId });
      for (const t of linked) broadcastToken(io, ctx.roomId, toToken({ ...t, characterId: null }), "token:updated", toScene(t.scene).fog);
    }),
  );

  socket.on(
    "character:roll",
    guarded(socket, CharacterRollSchema, async ({ characterId, roll, secret }, ctx) => {
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

      return createRollMessage(io, ctx.roomId, me, {
        formula: built.formula,
        label: `${character.name}: ${built.label}`,
        secret,
        characterId: character.id,
        critThreshold: built.critThreshold,
        allowNoDice: true,
      });
    }),
  );

  socket.on(
    "character:use-item",
    guarded(socket, CharacterUseItemSchema, async ({ characterId, itemId }, ctx) => {
      const me = await prisma.participant.findUnique({ where: { id: ctx.participantId } });
      if (!me) throw new HandlerError("Participante não encontrado");
      const character = toCharacter(await requireCharacter(characterId, ctx.roomId));
      if (!canEditCharacter(ctx, character)) throw new HandlerError("Você não controla esta ficha");

      const def = await requireSystem(ctx.roomId);
      let use;
      try {
        use = buildItemUse(def, character, itemId);
      } catch (err) {
        // Recurso insuficiente / item passivo: o ack leva a mensagem e nada é publicado.
        if (err instanceof ItemUseError) throw new HandlerError(err.message);
        throw err;
      }

      // 1. Desconta o custo (se houver) e avisa a sala: a ficha muda antes do card aparecer.
      if (use.spend) {
        const data = CharacterDataSchema.parse({ ...characterDataOf(character), resources: use.spend.resources });
        const updated = toCharacter(await prisma.character.update({ where: { id: characterId }, data: { data: toJson(data) } }));
        broadcastCharacter(io, ctx.roomId, updated, "character:updated");
      }

      // 2. Publica o card. Público como uma rolagem normal (NPC do GM incluso).
      const msg = toChatMessage(
        await prisma.chatMessage.create({
          data: { roomId: ctx.roomId, participantId: me.id, nickname: me.nickname, kind: "item", item: use.card },
        }),
      );
      io.to(rooms.all(ctx.roomId)).emit("chat:message", msg);
      return msg;
    }),
  );
}
