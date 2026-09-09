import { create } from "zustand";
import type { CompendiumEntry } from "@tormenta-vtt/shared";
import { dropTargetAt, type DropPoint } from "../lib/dropTargets";
import { emitAck } from "./connection";
import { toast } from "./ui";

/**
 * Compêndio da sala (entradas vindas de compendium:list) e estado da paleta.
 * As entradas são carregadas uma vez, na primeira abertura, e ficam em memória.
 */
interface CompendiumState {
  entries: CompendiumEntry[];
  /** Ids que vieram do compêndio da SALA (homebrew do GM): o chip "Sala" da paleta só aparece com algum. */
  roomIds: string[];
  status: "idle" | "loading" | "ready" | "error";
  /** Paleta aberta por cima da ficha. */
  isOpen: boolean;
  /** Filtro inicial (tipo da aba de onde a paleta foi aberta). null = todos. */
  initialKind: string | null;
  /** Último item inserido: a ficha troca para a aba dele e o destaca por um instante. */
  lastInserted: { itemId: string; kind: string; at: number } | null;
  /**
   * Arrasto em andamento (pointer events, não HTML5 drag). `targetId` é o alvo
   * registrado sob o cursor (lib/dropTargets), para o feedback da zona de soltura.
   */
  drag: { entryId: string; point: DropPoint; targetId: string | null } | null;

  load: () => Promise<void>;
  open: (kind?: string | null) => void;
  close: () => void;
  markInserted: (itemId: string, kind: string) => void;
  startDrag: (entryId: string, point: DropPoint) => void;
  moveDrag: (point: DropPoint) => void;
  /** Solta: chama onDrop do alvo sob o cursor (se houver) e devolve se caiu em algum. */
  endDrag: () => boolean;
  cancelDrag: () => void;
  /** Limpa o estado ao sair da sala (as entradas dependem do sistema da sala). */
  reset: () => void;
}

export const useCompendium = create<CompendiumState>((set, get) => ({
  entries: [],
  roomIds: [],
  status: "idle",
  isOpen: false,
  initialKind: null,
  lastInserted: null,
  drag: null,

  load: async () => {
    if (get().status === "loading" || get().status === "ready") return;
    set({ status: "loading" });
    const res = await emitAck("compendium:list", {});
    if (!res.ok) {
      set({ status: "error" });
      toast(res.error);
      return;
    }
    set({ entries: res.data.entries, roomIds: res.data.roomIds, status: "ready" });
  },

  open: (kind = null) => {
    set({ isOpen: true, initialKind: kind });
    void get().load();
  },
  close: () => set({ isOpen: false }),
  markInserted: (itemId, kind) => set({ lastInserted: { itemId, kind, at: Date.now() } }),

  startDrag: (entryId, point) => set({ drag: { entryId, point, targetId: null } }),
  moveDrag: (point) => {
    const { drag, entries } = get();
    const entry = drag ? entries.find((e) => e.id === drag.entryId) : undefined;
    if (!drag || !entry) return;
    set({ drag: { ...drag, point, targetId: dropTargetAt(point, entry)?.id ?? null } });
  },
  endDrag: () => {
    const { drag, entries } = get();
    const entry = drag ? entries.find((e) => e.id === drag.entryId) : undefined;
    const target = drag && entry ? dropTargetAt(drag.point, entry) : null;
    set({ drag: null });
    if (!drag || !entry || !target) return false;
    target.onDrop(entry, drag.point);
    return true;
  },
  cancelDrag: () => set({ drag: null }),
  reset: () => set({ entries: [], roomIds: [], status: "idle", isOpen: false, initialKind: null, lastInserted: null, drag: null }),
}));
