import {
  EmptySchema,
  InitiativeAddSchema,
  InitiativeRemoveSchema,
  InitiativeUpdateSchema,
  type InitiativeState,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { getCursor, loadInitiativeState, sortEntries } from "../services/initiativeState.js";
import { toInitiativeEntry } from "../services/serialize.js";
import { guarded, HandlerError } from "./ack.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

/** Envia o estado completo: GM vê tudo, jogadores só o visível. */
async function broadcast(io: TypedServer, roomId: string): Promise<InitiativeState> {
  const [forGm, forPlayers] = await Promise.all([loadInitiativeState(roomId, true), loadInitiativeState(roomId, false)]);
  io.to(rooms.gm(roomId)).emit("initiative:updated", forGm);
  io.to(rooms.players(roomId)).emit("initiative:updated", forPlayers);
  return forGm;
}

async function sortedIds(roomId: string): Promise<string[]> {
  const rows = await prisma.initiativeEntry.findMany({ where: { roomId } });
  return sortEntries(rows.map(toInitiativeEntry)).map((e) => e.id);
}

/** Id de quem está agindo agora (ou null). */
async function currentEntryId(roomId: string): Promise<string | null> {
  const cursor = getCursor(roomId);
  if (cursor.currentIndex === null) return null;
  return (await sortedIds(roomId))[cursor.currentIndex] ?? null;
}

/** Depois de mudar a lista, faz o cursor continuar apontando para a mesma entrada. */
async function repointCursor(roomId: string, entryId: string | null): Promise<void> {
  const cursor = getCursor(roomId);
  const ids = await sortedIds(roomId);
  if (ids.length === 0) {
    cursor.currentIndex = null;
    return;
  }
  if (cursor.currentIndex === null) return;
  const idx = entryId ? ids.indexOf(entryId) : -1;
  // Se a entrada atual foi removida, mantém a posição (quem vinha depois passa a agir).
  cursor.currentIndex = idx >= 0 ? idx : Math.min(cursor.currentIndex, ids.length - 1);
}

export function registerInitiativeHandlers(io: TypedServer, socket: TypedSocket): void {
  const gmOnly = { gmOnly: true };

  socket.on(
    "initiative:add",
    guarded(socket, InitiativeAddSchema, async (data, ctx) => {
      if (data.tokenId) {
        const token = await prisma.token.findUnique({ where: { id: data.tokenId }, include: { scene: true } });
        if (!token || token.scene.roomId !== ctx.roomId) throw new HandlerError("Token não encontrado");
      }
      const current = await currentEntryId(ctx.roomId);
      await prisma.initiativeEntry.create({ data: { ...data, roomId: ctx.roomId } });
      await repointCursor(ctx.roomId, current);
      return broadcast(io, ctx.roomId);
    }, gmOnly),
  );

  socket.on(
    "initiative:update",
    guarded(socket, InitiativeUpdateSchema, async ({ id, ...fields }, ctx) => {
      const row = await prisma.initiativeEntry.findUnique({ where: { id } });
      if (!row || row.roomId !== ctx.roomId) throw new HandlerError("Entrada não encontrada");
      const current = await currentEntryId(ctx.roomId);
      await prisma.initiativeEntry.update({ where: { id }, data: fields });
      await repointCursor(ctx.roomId, current);
      return broadcast(io, ctx.roomId);
    }, gmOnly),
  );

  socket.on(
    "initiative:remove",
    guarded(socket, InitiativeRemoveSchema, async ({ entryId }, ctx) => {
      const row = await prisma.initiativeEntry.findUnique({ where: { id: entryId } });
      if (!row || row.roomId !== ctx.roomId) throw new HandlerError("Entrada não encontrada");
      const current = await currentEntryId(ctx.roomId);
      await prisma.initiativeEntry.delete({ where: { id: entryId } });
      await repointCursor(ctx.roomId, current === entryId ? null : current);
      return broadcast(io, ctx.roomId);
    }, gmOnly),
  );

  socket.on(
    "initiative:next",
    guarded(socket, EmptySchema, async (_p, ctx) => {
      const n = (await sortedIds(ctx.roomId)).length;
      const cursor = getCursor(ctx.roomId);
      if (n === 0) throw new HandlerError("Nenhum combatente na iniciativa");
      if (cursor.currentIndex === null) {
        // Inicia o combate.
        cursor.currentIndex = 0;
        cursor.round = Math.max(1, cursor.round);
      } else if (cursor.currentIndex + 1 >= n) {
        cursor.currentIndex = 0;
        cursor.round += 1;
      } else {
        cursor.currentIndex += 1;
      }
      return broadcast(io, ctx.roomId);
    }, gmOnly),
  );

  socket.on(
    "initiative:prev",
    guarded(socket, EmptySchema, async (_p, ctx) => {
      const n = (await sortedIds(ctx.roomId)).length;
      const cursor = getCursor(ctx.roomId);
      if (n === 0 || cursor.currentIndex === null) throw new HandlerError("Combate não iniciado");
      if (cursor.currentIndex === 0) {
        cursor.currentIndex = n - 1;
        cursor.round = Math.max(1, cursor.round - 1);
      } else {
        cursor.currentIndex -= 1;
      }
      return broadcast(io, ctx.roomId);
    }, gmOnly),
  );

  socket.on(
    "initiative:reset",
    guarded(socket, EmptySchema, async (_p, ctx) => {
      await prisma.initiativeEntry.deleteMany({ where: { roomId: ctx.roomId } });
      const cursor = getCursor(ctx.roomId);
      cursor.currentIndex = null;
      cursor.round = 0;
      return broadcast(io, ctx.roomId);
    }, gmOnly),
  );
}
