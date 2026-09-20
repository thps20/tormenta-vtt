/**
 * "Minhas mesas" no Lobby (docs/SPEC.md §3.1): identidade local do Mestre (`ownerKey`, gerado e
 * guardado no navegador — o servidor só compara), listar/renomear/encerrar/reabrir a sala e adotar
 * uma sala antiga (sem dono) por código + segredo de GM.
 */
import type { Room as DbRoom } from "@prisma/client";
import type { MyRoom } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";

/** Erro de acesso (dono errado, sala não encontrada, confirmação não bate). A rota HTTP decide o
 *  status: "não encontrada" -> 404, os demais -> 403/400 (ver http/rooms.ts). */
export class RoomAccessError extends Error {}

/**
 * Converte um lote de salas para `MyRoom`, com só duas queries extras no total (nunca uma por
 * sala): `_count` já veio do `include` de quem chamou; falta só a última atividade, resolvida com
 * um `groupBy` só.
 */
async function toMyRooms(
  rooms: (DbRoom & { _count: { participants: number; scenes: number } })[],
): Promise<MyRoom[]> {
  if (rooms.length === 0) return [];
  const lastActivity = await prisma.chatMessage.groupBy({
    by: ["roomId"],
    where: { roomId: { in: rooms.map((r) => r.id) } },
    _max: { createdAt: true },
  });
  const lastActivityByRoom = new Map(lastActivity.map((l) => [l.roomId, l._max.createdAt]));

  return rooms
    .map((room) => ({
      id: room.id,
      name: room.name,
      inviteCode: room.inviteCode,
      gmSecret: room.gmSecret,
      createdAt: room.createdAt.toISOString(),
      lastActivityAt: (lastActivityByRoom.get(room.id) ?? room.createdAt).toISOString(),
      participantCount: room._count.participants,
      mapCount: room._count.scenes,
      deletedAt: room.deletedAt?.toISOString() ?? null,
    }))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

async function toMyRoom(room: DbRoom): Promise<MyRoom> {
  const withCounts = await prisma.room.findUniqueOrThrow({
    where: { id: room.id },
    include: { _count: { select: { participants: true, scenes: { where: { deletedAt: null } } } } },
  });
  return (await toMyRooms([withCounts]))[0]!;
}

/** GET /api/rooms/mine: salas cujo `ownerKey` é o deste navegador, ativas ou encerradas. */
export async function listOwnedRooms(ownerKey: string, status: "active" | "ended"): Promise<MyRoom[]> {
  const rooms = await prisma.room.findMany({
    where: { ownerKey, deletedAt: status === "ended" ? { not: null } : null },
    include: { _count: { select: { participants: true, scenes: { where: { deletedAt: null } } } } },
  });
  return toMyRooms(rooms);
}

async function requireOwnedRoom(id: string, ownerKey: string): Promise<DbRoom> {
  const room = await prisma.room.findUnique({ where: { id } });
  if (!room) throw new RoomAccessError("Sala não encontrada");
  if (!room.ownerKey || room.ownerKey !== ownerKey) throw new RoomAccessError("Você não é o dono desta mesa");
  return room;
}

/** PATCH /api/rooms/:id — renomear. */
export async function renameRoom(id: string, ownerKey: string, name: string): Promise<MyRoom> {
  await requireOwnedRoom(id, ownerKey);
  const room = await prisma.room.update({ where: { id }, data: { name } });
  return toMyRoom(room);
}

/**
 * POST /api/rooms/:id/end — encerrar (soft delete). `confirmName` precisa bater com o nome atual da
 * sala: a UI já pede pra digitar o nome antes de habilitar o botão, isto é só uma segunda trava
 * contra um clique automatizado sem passar pela confirmação.
 */
export async function endRoom(id: string, ownerKey: string, confirmName: string): Promise<MyRoom> {
  const room = await requireOwnedRoom(id, ownerKey);
  if (room.name !== confirmName) throw new RoomAccessError("O nome digitado não confere");
  const updated = await prisma.room.update({ where: { id }, data: { deletedAt: new Date() } });
  return toMyRoom(updated);
}

/** POST /api/rooms/:id/reopen — tira do soft delete (aba "Encerradas" do Lobby). */
export async function reopenRoom(id: string, ownerKey: string): Promise<MyRoom> {
  await requireOwnedRoom(id, ownerKey);
  const updated = await prisma.room.update({ where: { id }, data: { deletedAt: null } });
  return toMyRoom(updated);
}

/**
 * POST /api/rooms/adopt — "Adicionar mesa que já tenho": prova o `gmSecret` (mesma checagem de
 * `room:join` como GM) e grava o `ownerKey` atual na sala, sobrescrevendo o que já estava lá — é
 * assim que uma sala muda de "navegador dono" de propósito (recuperar noutro navegador, por ex.).
 */
export async function adoptRoom(inviteCode: string, gmSecret: string, ownerKey: string): Promise<MyRoom> {
  const room = await prisma.room.findUnique({ where: { inviteCode: inviteCode.toUpperCase() } });
  if (!room) throw new RoomAccessError("Sala não encontrada");
  if (room.gmSecret !== gmSecret) throw new RoomAccessError("Segredo do GM inválido");
  const updated = await prisma.room.update({ where: { id: room.id }, data: { ownerKey } });
  return toMyRoom(updated);
}
