import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@tormenta-vtt/shared";
import { SERVER_URL } from "../config";
import { bindSocket } from "./bindSocket";

/**
 * Store Zustand: um objeto global de estado que qualquer componente lê com um hook.
 * Aqui guardamos só a conexão. Cada domínio (tokens, chat...) tem sua própria store.
 */
export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface ConnectionState {
  socket: TypedSocket | null;
  status: "disconnected" | "connecting" | "connected";
  /** Cria o socket na primeira chamada; nas seguintes devolve o existente. */
  connect: () => TypedSocket;
}

export const useConnection = create<ConnectionState>((set, get) => ({
  socket: null,
  status: "disconnected",
  connect: () => {
    const existing = get().socket;
    if (existing) return existing;
    const socket: TypedSocket = io(SERVER_URL, { autoConnect: true });
    set({ socket, status: "connecting" });
    socket.on("connect", () => set({ status: "connected" }));
    socket.on("disconnect", () => set({ status: "disconnected" }));
    // Liga os broadcasts do servidor às stores de domínio (uma vez só).
    bindSocket(socket);
    return socket;
  },
}));

/** Atalho para as stores emitirem eventos. */
export function getSocket(): TypedSocket {
  return useConnection.getState().connect();
}

/** Payload e resposta de ack de cada evento, derivados do contrato do shared. */
export type PayloadOf<E extends keyof ClientToServerEvents> = Parameters<ClientToServerEvents[E]>[0];
export type AckOf<E extends keyof ClientToServerEvents> = Parameters<Parameters<ClientToServerEvents[E]>[1]>[0];

/**
 * Emite um evento e devolve o ack como Promise, mantendo a tipagem do contrato.
 * O cast interno é necessário porque o TS não correlaciona o genérico E com o overload do emit.
 */
export function emitAck<E extends keyof ClientToServerEvents>(event: E, payload: PayloadOf<E>): Promise<AckOf<E>> {
  return new Promise((resolve) => {
    // Importante: chamar como método (socket.emit) para preservar o `this` do socket.
    const socket = getSocket() as unknown as { emit: (ev: string, p: unknown, ack: (r: AckOf<E>) => void) => void };
    socket.emit(event, payload, resolve);
  });
}
