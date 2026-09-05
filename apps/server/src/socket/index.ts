import type { FastifyBaseLogger } from "fastify";
import { registerRoomHandlers } from "./room.js";
import type { TypedServer } from "./types.js";

/** Ponto único que liga todos os handlers de socket. */
export function registerSocketHandlers(io: TypedServer, log: FastifyBaseLogger): void {
  io.on("connection", (socket) => {
    log.info({ socketId: socket.id }, "socket conectado");
    // socket.data começa vazio; room:join preenche.
    socket.data.roomId = "";
    socket.data.participantId = "";
    socket.data.role = "player";

    registerRoomHandlers(io, socket);

    socket.on("disconnect", (reason) => {
      log.info({ socketId: socket.id, reason }, "socket desconectado");
    });
  });
}
