import { TokenCreateSchema, TokenDeleteSchema, TokenLinkCharacterSchema, TokenPatchSchema, type Token } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { canEditCharacter, requireCharacter, toCharacter } from "../services/characters.js";
import { canEditToken, restrictPatchForRole } from "../services/permissions.js";
import { toToken } from "../services/serialize.js";
import { guarded, HandlerError } from "./ack.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

/** Carrega o token e confirma que a cena dele é desta sala. */
async function requireToken(tokenId: string, roomId: string) {
  const row = await prisma.token.findUnique({ where: { id: tokenId }, include: { scene: true } });
  if (!row || row.scene.roomId !== roomId) throw new HandlerError("Token não encontrado");
  return row;
}

/**
 * Broadcast respeitando visibilidade: GM recebe sempre; jogadores recebem
 * o token só se visível, senão recebem token:deleted (caso tenham ele em cache).
 */
export function broadcastToken(io: TypedServer, roomId: string, token: Token, event: "token:created" | "token:updated") {
  io.to(rooms.gm(roomId)).emit(event, token);
  if (token.visible) io.to(rooms.players(roomId)).emit(event, token);
  else if (event === "token:updated") io.to(rooms.players(roomId)).emit("token:deleted", { tokenId: token.id });
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
      const token = toToken(await prisma.token.create({ data }));
      broadcastToken(io, ctx.roomId, token, "token:created");
      return token;
    }, { gmOnly: true }),
  );

  socket.on(
    "token:update",
    guarded(socket, TokenPatchSchema, async (patch, ctx) => {
      const row = await requireToken(patch.id, ctx.roomId);
      if (!canEditToken(ctx, row)) throw new HandlerError("Você não controla este token");

      const { id, sceneId: _ignoreScene, ...fields } = restrictPatchForRole(ctx, patch);
      if (fields.ownerId) {
        const owner = await prisma.participant.findUnique({ where: { id: fields.ownerId } });
        if (!owner || owner.roomId !== ctx.roomId) throw new HandlerError("Dono inválido");
      }
      const token = toToken(await prisma.token.update({ where: { id }, data: fields }));
      broadcastToken(io, ctx.roomId, token, "token:updated");
      return token;
    }),
  );

  socket.on(
    "token:delete",
    guarded(socket, TokenDeleteSchema, async ({ tokenId }, ctx) => {
      const row = await requireToken(tokenId, ctx.roomId);
      if (!canEditToken(ctx, row)) throw new HandlerError("Você não controla este token");
      await prisma.token.delete({ where: { id: tokenId } });
      io.to(rooms.all(ctx.roomId)).emit("token:deleted", { tokenId });
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
      broadcastToken(io, ctx.roomId, token, "token:updated");
      return token;
    }),
  );
}
