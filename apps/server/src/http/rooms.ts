import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { CreateRoomBodySchema, type RoomPublic } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { generateGmSecret, generateInviteCode } from "../services/ids.js";
import { toRoomPublic } from "../services/serialize.js";

export interface CreateRoomResponse {
  room: RoomPublic;
  gmSecret: string;
  sessionToken: string;
}

/**
 * POST /api/rooms { name, nickname } -> { room, gmSecret, sessionToken }
 * Cria a sala, o participante GM e a "Cena 1" (já ativa), tudo numa transação:
 * ou cria tudo, ou nada.
 */
export async function registerRoomRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/rooms", async (req, reply) => {
    const parsed = CreateRoomBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Dados inválidos", issues: parsed.error.issues });
    }
    const { name, nickname } = parsed.data;

    // Tenta algumas vezes caso o inviteCode colida (raro).
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = await prisma.$transaction(async (tx) => {
          const room = await tx.room.create({
            data: { name, inviteCode: generateInviteCode(), gmSecret: generateGmSecret() },
          });
          const scene = await tx.scene.create({ data: { roomId: room.id, name: "Cena 1" } });
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
}
