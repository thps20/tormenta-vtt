import { create } from "zustand";
import type { CompendiumEntry, RoomCompendiumEntryInput, RoomCompendiumImportResult } from "@tormenta-vtt/shared";
import { dropTargetAt, type DropPoint } from "../lib/dropTargets";
import { emitAck } from "./connection";
import { toast } from "./ui";

/** Onde a paleta foi aberta: "sheet" (ficha, insere item) ou "map" (mesa em foco, GM solta criatura). */
export type PaletteContext = "sheet" | "map";

/** Toggle "invisível ao soltar": lembrado na sessão (sessionStorage), não por sala nem por criatura. */
const SPAWN_INVISIBLE_KEY = "tvtt:compendiumSpawnInvisible";

function readSpawnInvisible(): boolean {
  try {
    return sessionStorage.getItem(SPAWN_INVISIBLE_KEY) !== "false";
  } catch {
    return true;
  }
}

/**
 * Compêndio da sala (entradas vindas de compendium:list) e estado da paleta.
 * As entradas são carregadas uma vez, na primeira abertura, e ficam em memória.
 */
interface CompendiumState {
  entries: CompendiumEntry[];
  /** Ids que vieram do compêndio da SALA (homebrew do GM): o chip "Sala" da paleta só aparece com algum. */
  roomIds: string[];
  status: "idle" | "loading" | "ready" | "error";
  /** Paleta aberta (por cima da ficha, ou flutuando sobre o mapa). */
  isOpen: boolean;
  context: PaletteContext;
  /** Filtro inicial (aba ativa da ficha, ou o chip "Criaturas" ao abrir sobre o mapa). null = todos. */
  initialKind: string | null;
  /** Último item inserido: a ficha troca para a aba dele e o destaca por um instante. */
  lastInserted: { itemId: string; kind: string; at: number } | null;
  /**
   * Arrasto em andamento (pointer events, não HTML5 drag). `targetId` é o alvo
   * registrado sob o cursor (lib/dropTargets), para o feedback da zona de soltura.
   */
  drag: { entryId: string; point: DropPoint; targetId: string | null } | null;
  /**
   * Quantidade e toggle "invisível ao soltar" de uma criatura (preview no contexto "map").
   * Vivem aqui, não como estado local da paleta, porque o fantasma de células do VttCanvas
   * (docs/plano-criaturas.md §2.4) também precisa da quantidade durante o arrasto.
   */
  spawnCount: number;
  spawnInvisible: boolean;

  load: () => Promise<void>;
  open: (context: PaletteContext, kind?: string | null) => void;
  close: () => void;
  markInserted: (itemId: string, kind: string) => void;
  startDrag: (entryId: string, point: DropPoint) => void;
  moveDrag: (point: DropPoint) => void;
  /** Solta: chama onDrop do alvo sob o cursor (se houver) e devolve se caiu em algum. */
  endDrag: () => boolean;
  cancelDrag: () => void;
  setSpawnCount: (n: number) => void;
  /** Persiste em sessionStorage. */
  setSpawnInvisible: (v: boolean) => void;

  // Homebrew da sala (docs/plano-compendio-sala.md, §9.18): GM cria/edita/apaga entradas próprias,
  // que entram na mesma lista `entries` (o servidor já manda mesclado) e em `roomIds`.
  /** `entryId` null = cria (o servidor gera o id do nome); preenchido = substitui o corpo inteiro. */
  saveRoomEntry: (entryId: string | null, entry: RoomCompendiumEntryInput) => Promise<CompendiumEntry | null>;
  deleteRoomEntry: (entryId: string) => Promise<boolean>;
  /** Tudo que não está apagado, pronto pra virar um arquivo .json. */
  exportRoom: () => Promise<CompendiumEntry[] | null>;
  importRoom: (entries: CompendiumEntry[], overwriteConflicts: boolean) => Promise<RoomCompendiumImportResult | null>;
  // Broadcasts (bindSocket) — idempotentes, mesmo padrão de useEncounters.upsert/removeLocal. Uma
  // entrada da sala apagada some da lista; se por acaso ela sobrepunha uma do sistema (só possível
  // via import — a criação normal nunca deixa colidir, ver nextEntryId), o sistema só volta a
  // aparecer numa recarga da paleta (compendium:list de novo), não sozinho aqui.
  upsertRoomEntry: (entry: CompendiumEntry) => void;
  removeRoomEntry: (entryId: string) => void;
  /** Limpa o estado ao sair da sala (as entradas dependem do sistema da sala). */
  reset: () => void;
}

export const useCompendium = create<CompendiumState>((set, get) => ({
  entries: [],
  roomIds: [],
  status: "idle",
  isOpen: false,
  context: "sheet",
  initialKind: null,
  lastInserted: null,
  drag: null,
  spawnCount: 1,
  spawnInvisible: readSpawnInvisible(),

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

  open: (context, kind = null) => {
    set({ isOpen: true, context, initialKind: kind });
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
  setSpawnCount: (n) => set({ spawnCount: n }),
  setSpawnInvisible: (v) => {
    set({ spawnInvisible: v });
    try {
      sessionStorage.setItem(SPAWN_INVISIBLE_KEY, String(v));
    } catch {
      /* sessionStorage indisponível (aba privada etc.): só não lembra entre reaberturas. */
    }
  },

  saveRoomEntry: async (entryId, entry) => {
    const res = entryId ? await emitAck("compendium:room-update", { entryId, entry }) : await emitAck("compendium:room-create", { entry });
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsertRoomEntry(res.data);
    return res.data;
  },
  deleteRoomEntry: async (entryId) => {
    const res = await emitAck("compendium:room-delete", { entryId });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    get().removeRoomEntry(entryId);
    return true;
  },
  exportRoom: async () => {
    const res = await emitAck("compendium:room-export", {});
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    return res.data.entries;
  },
  importRoom: async (entries, overwriteConflicts) => {
    const res = await emitAck("compendium:room-import", { entries, overwriteConflicts });
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    // As entradas criadas/atualizadas também chegam por compendium:room-created/-updated (broadcast
    // pra rooms.gm, e esta aba já está ligada nele) — nada a fazer aqui além de devolver o resumo.
    return res.data;
  },
  upsertRoomEntry: (entry) =>
    set((s) => ({
      entries: s.entries.some((e) => e.id === entry.id) ? s.entries.map((e) => (e.id === entry.id ? entry : e)) : [...s.entries, entry],
      roomIds: s.roomIds.includes(entry.id) ? s.roomIds : [...s.roomIds, entry.id],
    })),
  removeRoomEntry: (entryId) => set((s) => ({ entries: s.entries.filter((e) => e.id !== entryId), roomIds: s.roomIds.filter((id) => id !== entryId) })),

  reset: () => set({ entries: [], roomIds: [], status: "idle", isOpen: false, context: "sheet", initialKind: null, lastInserted: null, drag: null, spawnCount: 1 }),
}));
