import type { Server, Socket } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "@tormenta-vtt/shared";

/** Aliases para não repetir os 4 generics do Socket.io em todo arquivo. */
export type TypedServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type TypedSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Nomes das "salas" internas do Socket.io usadas para broadcast. */
export const rooms = {
  all: (roomId: string) => `room:${roomId}`,
  gm: (roomId: string) => `room:${roomId}:gm`,
  players: (roomId: string) => `room:${roomId}:players`,
  /** Todos os sockets (abas) de um mesmo participante. */
  participant: (participantId: string) => `participant:${participantId}`,
};
