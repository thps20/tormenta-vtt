import { RoomJoinSchema, type Ack, type RoomSnapshot } from "@tormenta-vtt/shared";
import type { Participant as DbParticipant } from "@prisma/client";
import { prisma } from "../db.js";
import { buildCastState } from "../services/display.js";
import { addSocket, isConnected, removeSocket } from "../services/presence.js";
import { toParticipant } from "../services/serialize.js";
import { buildSnapshot } from "../services/snapshot.js";
import { HandlerError } from "./ack.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

export function registerRoomHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on("room:join", async (payload, ack: Ack<RoomSnapshot>) => {
    const reply: Ack<RoomSnapshot> = typeof ack === "function" ? ack : () => undefined;
    try {
      const parsed = RoomJoinSchema.safeParse(payload);
      if (!parsed.success) throw new HandlerError("Dados inválidos");
      const { inviteCode, nickname, gmSecret, sessionToken } = parsed.data;

      const room = await prisma.room.findUnique({ where: { inviteCode: inviteCode.toUpperCase() } });
      if (!room) throw new HandlerError("Sala não encontrada");
      // Encerrada (docs/SPEC.md §3.1, soft delete): o link de convite passa a responder isto em vez
      // de deixar entrar. Não derruba quem já estava conectado — só bloqueia join/reconexão novos.
      if (room.deletedAt) throw new HandlerError("Esta mesa foi encerrada");

      const me = await resolveParticipant(room.id, room.gmSecret, { nickname, gmSecret, sessionToken });

      // Se este socket já estava em outra sala (ex.: navegou entre salas), sai dela antes. Um
      // socket de tela de exibição nunca chega aqui (middleware de somente leitura em
      // socket/index.ts recusa `room:join` pra ele antes disso), mas o guard é defesa em
      // profundidade — `leaveCurrentRoom` assume um Participant de verdade.
      if (socket.data.roomId && !socket.data.isDisplay) leaveCurrentRoom(io, socket);

      socket.data.roomId = room.id;
      socket.data.participantId = me.id;
      socket.data.role = me.role;
      socket.data.nickname = me.nickname;
      socket.data.isDisplay = false;

      await socket.join([
        rooms.all(room.id),
        me.role === "gm" ? rooms.gm(room.id) : rooms.players(room.id),
        rooms.participant(me.id),
      ]);
      addSocket(room.id, me.id, socket.id);

      const snapshot = await buildSnapshot(room, me);
      // Cast (docs/plano-cast.md) só vai ao GM — nunca em RoomSnapshot pra jogador nem pra tela.
      if (me.role === "gm") snapshot.cast = buildCastState(io, room);
      // Todos (inclusive o autor) recebem o participante; o cliente faz upsert.
      io.to(rooms.all(room.id)).emit("room:participantJoined", toParticipant(me, true));
      reply({ ok: true, data: snapshot });
    } catch (err) {
      if (err instanceof HandlerError) reply({ ok: false, error: err.message });
      else {
        console.error(err);
        reply({ ok: false, error: "Erro interno do servidor" });
      }
    }
  });

  socket.on("disconnect", () => {
    // Tela de exibição: `socket/display.ts` cuida do próprio disconnect (presença/miniatura); esta
    // limpeza é só pra Participant de verdade.
    if (socket.data.roomId && !socket.data.isDisplay) leaveCurrentRoom(io, socket);
  });
}

/**
 * Decide quem é o participante:
 *  1. gmSecret correto -> é o GM: reaproveita o participante GM (nunca vira jogador
 *     por causa de uma sessão de jogador salva no mesmo navegador);
 *  2. sessionToken válido desta sala -> reconecta como ele;
 *  3. senão cria um jogador novo (precisa de nickname).
 */
async function resolveParticipant(
  roomId: string,
  roomGmSecret: string,
  input: { nickname?: string; gmSecret?: string; sessionToken?: string },
): Promise<DbParticipant> {
  const isGm = input.gmSecret !== undefined && input.gmSecret === roomGmSecret;
  if (input.gmSecret !== undefined && !isGm) throw new HandlerError("Segredo do GM inválido");

  if (input.sessionToken) {
    const existing = await prisma.participant.findUnique({ where: { sessionToken: input.sessionToken } });
    // Com gmSecret válido, só aceita a sessão se ela já for do GM.
    if (existing && existing.roomId === roomId && (!isGm || existing.role === "gm")) return existing;
  }

  if (isGm) {
    const gm = await prisma.participant.findFirst({ where: { roomId, role: "gm" }, orderBy: { createdAt: "asc" } });
    if (gm) {
      return input.nickname && input.nickname !== gm.nickname
        ? prisma.participant.update({ where: { id: gm.id }, data: { nickname: input.nickname } })
        : gm;
    }
  }

  if (!input.nickname) throw new HandlerError("Informe um nickname para entrar");
  return prisma.participant.create({
    data: { roomId, nickname: input.nickname, role: isGm ? "gm" : "player" },
  });
}

function leaveCurrentRoom(io: TypedServer, socket: TypedSocket): void {
  const { roomId, participantId } = socket.data;
  const wentOffline = removeSocket(roomId, participantId, socket.id);
  for (const r of [rooms.all(roomId), rooms.gm(roomId), rooms.players(roomId), rooms.participant(participantId)]) {
    void socket.leave(r);
  }
  if (wentOffline && !isConnected(roomId, participantId)) {
    io.to(rooms.all(roomId)).emit("room:participantLeft", { id: participantId });
  }
  socket.data.roomId = "";
  socket.data.participantId = "";
}
