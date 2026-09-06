import { create } from "zustand";
import type { CompendiumEntry } from "@tormenta-vtt/shared";
import { emitAck } from "./connection";
import { toast } from "./ui";

/**
 * Compêndio da sala (entradas vindas de compendium:list) e estado da paleta.
 * As entradas são carregadas uma vez, na primeira abertura, e ficam em memória.
 */
interface CompendiumState {
  entries: CompendiumEntry[];
  status: "idle" | "loading" | "ready" | "error";
  /** Paleta aberta por cima da ficha. */
  isOpen: boolean;
  /** Filtro inicial (tipo da aba de onde a paleta foi aberta). null = todos. */
  initialKind: string | null;
  /** Último item inserido: a ficha troca para a aba dele e o destaca por um instante. */
  lastInserted: { itemId: string; kind: string; at: number } | null;

  load: () => Promise<void>;
  open: (kind?: string | null) => void;
  close: () => void;
  markInserted: (itemId: string, kind: string) => void;
  /** Limpa o estado ao sair da sala (as entradas dependem do sistema da sala). */
  reset: () => void;
}

export const useCompendium = create<CompendiumState>((set, get) => ({
  entries: [],
  status: "idle",
  isOpen: false,
  initialKind: null,
  lastInserted: null,

  load: async () => {
    if (get().status === "loading" || get().status === "ready") return;
    set({ status: "loading" });
    const res = await emitAck("compendium:list", {});
    if (!res.ok) {
      set({ status: "error" });
      toast(res.error);
      return;
    }
    set({ entries: res.data, status: "ready" });
  },

  open: (kind = null) => {
    set({ isOpen: true, initialKind: kind });
    void get().load();
  },
  close: () => set({ isOpen: false }),
  markInserted: (itemId, kind) => set({ lastInserted: { itemId, kind, at: Date.now() } }),
  reset: () => set({ entries: [], status: "idle", isOpen: false, initialKind: null, lastInserted: null }),
}));
