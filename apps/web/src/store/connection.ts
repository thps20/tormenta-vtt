import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@tormenta-vtt/shared";
import { SERVER_URL } from "../config";

/**
 * Store Zustand: um objeto global de estado que qualquer componente lê com um hook.
 * Aqui guardamos só a conexão. Cada domínio (tokens, chat...) terá sua própria store.
 */
export type TypedSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface ConnectionState {
  socket: TypedSocket | null;
  status: "disconnected" | "connecting" | "connected";
  connect: () => void;
}

export const useConnection = create<ConnectionState>((set, get) => ({
  socket: null,
  status: "disconnected",
  connect: () => {
    if (get().socket) return;
    const socket: TypedSocket = io(SERVER_URL, { autoConnect: true });
    set({ socket, status: "connecting" });
    socket.on("connect", () => set({ status: "connected" }));
    socket.on("disconnect", () => set({ status: "disconnected" }));
  },
}));
