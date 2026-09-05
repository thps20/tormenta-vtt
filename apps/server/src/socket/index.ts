import type { FastifyBaseLogger } from "fastify";
import { registerRoomHandlers } from "./room.js";
import { registerSceneHandlers } from "./scene.js";
import { registerTokenHandlers } from "./token.js";
import { registerChatHandlers } from "./chat.js";
import { registerInitiativeHandlers } from "./initiative.js";
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
    registerSceneHandlers(io, socket);
    registerTokenHandlers(io, socket);
    registerChatHandlers(io, socket);
    registerInitiativeHandlers(io, socket);

    socket.on("disconnect", (reason) => {
      log.info({ socketId: socket.id, reason }, "socket desconectado");
    });
  });
}
