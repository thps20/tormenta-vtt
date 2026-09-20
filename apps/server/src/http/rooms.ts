import type { FastifyInstance, FastifyReply } from "fastify";
import { Prisma } from "@prisma/client";
import {
  AdoptRoomBodySchema,
  CreateRoomBodySchema,
  EndRoomBodySchema,
  MyRoomsQuerySchema,
  RenameRoomBodySchema,
  ReopenRoomBodySchema,
  type RoomPublic,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { generateGmSecret, generateInviteCode } from "../services/ids.js";
import { adoptRoom, endRoom, listOwnedRooms, renameRoom, reopenRoom, RoomAccessError } from "../services/rooms.js";
import { toRoomPublic } from "../services/serialize.js";

export interface CreateRoomResponse {
  room: RoomPublic;
  gmSecret: string;
  sessionToken: string;
}

/** Traduz `RoomAccessError` no status HTTP certo — a mensagem já vem pronta pra mostrar na UI. */
function sendAccessError(reply: FastifyReply, err: RoomAccessError) {
  const status = err.message === "Sala não encontrada" ? 404 : 403;
  return reply.code(status).send({ error: err.message });
}

/**
 * Rotas de sala fora do socket (docs/SPEC.md §3.1): criar, e o CRUD de "Minhas mesas" no Lobby
 * (listar/renomear/encerrar/reabrir/adotar), tudo gated por `ownerKey` — a identidade local do
 * Mestre guardada no `localStorage` do navegador. O servidor nunca gera esse valor, só compara.
 */
export async function registerRoomRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/rooms", async (req, reply) => {
    const parsed = CreateRoomBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados inválidos", issues: parsed.error.issues });
    }
    const { name, nickname, ownerKey } = parsed.data;

    // Tenta algumas vezes caso o inviteCode colida (raro).
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          const room = await tx.room.create({
            data: { name, inviteCode: generateInviteCode(), gmSecret: generateGmSecret(), ownerKey },
          });
          const scene = await tx.scene.create({ data: { roomId: room.id, name: "Mapa 1" } });
          const updatedRoom = await tx.room.update({
            where: { id: room.id },
            data: { activeSceneId: scene.id },
          });
          const gm = await tx.participant.create({
            data: { roomId: room.id, nickname, role: "gm" },
          });
          return { room: updatedRoom, gm };
        });

        const body: CreateRoomResponse = {
          room: toRoomPublic(result.room),
          gmSecret: result.room.gmSecret,
          sessionToken: result.gm.sessionToken,
        };
        return reply.code(201).send(body);
      } catch (err) {
        // P2002 = violação de unique (inviteCode repetido): tenta de novo.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
        throw err;
      }
    }
    return reply.code(500).send({ error: "Não foi possível gerar um código de sala" });
  });

  app.get("/api/rooms/mine", async (req, reply) => {
    const parsed = MyRoomsQuerySchema.safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos", issues: parsed.error.issues });
    const rooms = await listOwnedRooms(parsed.data.ownerKey, parsed.data.status);
    return reply.send({ rooms });
  });

  app.patch<{ Params: { id: string } }>("/api/rooms/:id", async (req, reply) => {
    const parsed = RenameRoomBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos", issues: parsed.error.issues });
    try {
      const room = await renameRoom(req.params.id, parsed.data.ownerKey, parsed.data.name);
      return reply.send({ room });
    } catch (err) {
      if (err instanceof RoomAccessError) return sendAccessError(reply, err);
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>("/api/rooms/:id/end", async (req, reply) => {
    const parsed = EndRoomBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos", issues: parsed.error.issues });
    try {
      const room = await endRoom(req.params.id, parsed.data.ownerKey, parsed.data.confirmName);
      return reply.send({ room });
    } catch (err) {
      if (err instanceof RoomAccessError) return sendAccessError(reply, err);
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>("/api/rooms/:id/reopen", async (req, reply) => {
    const parsed = ReopenRoomBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos", issues: parsed.error.issues });
    try {
      const room = await reopenRoom(req.params.id, parsed.data.ownerKey);
      return reply.send({ room });
    } catch (err) {
      if (err instanceof RoomAccessError) return sendAccessError(reply, err);
      throw err;
    }
  });

  app.post("/api/rooms/adopt", async (req, reply) => {
    const parsed = AdoptRoomBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Dados inválidos", issues: parsed.error.issues });
    try {
      const room = await adoptRoom(parsed.data.inviteCode, parsed.data.gmSecret, parsed.data.ownerKey);
      return reply.send({ room });
    } catch (err) {
      if (err instanceof RoomAccessError) return sendAccessError(reply, err);
      throw err;
    }
  });
}
