import { create } from "zustand";

/** Toasts de erro/aviso (ex.: ack { ok:false } que fez reverter uma mudança). */
export interface Toast {
  id: number;
  message: string;
  kind: "error" | "info";
}

interface UiState {
  toasts: Toast[];
  push: (message: string, kind?: Toast["kind"]) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useUi = create<UiState>((set) => ({
  toasts: [],
  push: (message, kind = "error") => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (message: string, kind?: Toast["kind"]) => useUi.getState().push(message, kind);
