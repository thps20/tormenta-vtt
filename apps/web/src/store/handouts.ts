import { create } from "zustand";
import type {
  ChatMessage,
  Handout,
  HandoutCard,
  HandoutCreatePayload,
  HandoutPatch,
  HandoutPin,
  HandoutShowTarget,
} from "@tormenta-vtt/shared";
import { dropTargetAt, type DropPoint } from "../lib/dropTargets";
import { emitAck } from "./connection";
import { toast } from "./ui";

/**
 * Handouts (docs/SPEC.md §9.10): biblioteca por sala (só GM, carregada sob demanda — mesmo padrão
 * de `sceneList.ts`/`scene:list`) + pinos por mapa (mesmo padrão de `templates.ts`:
 * `pinsByScene[sceneId][pinId]`, só a cena ativa vem no room:join, as demais via `scene:enter`) +
 * o overlay em tela cheia atualmente aberto.
 */
interface HandoutsState {
  library: Handout[];
  libraryStatus: "idle" | "loading" | "ready" | "error";
  pinsByScene: Record<string, Record<string, HandoutPin>>;

  /**
   * Overlay aberto agora (null = fechado). `messageId` é `null` quando veio de um clique num pino
   * do mapa (sem mensagem de chat associada) — nesse caso não existe "Fechar para todos" (é só uma
   * visualização local, como abrir a ficha de um token). Guardado pra `handout:closed` saber se é
   * ESTA mensagem que deve fechar.
   */
  open: { messageId: string | null; card: HandoutCard } | null;

  /** Arrasto em andamento (pointer events, mesmo mecanismo de `store/compendium.ts`). */
  drag: { handoutId: string; point: DropPoint; targetId: string | null } | null;

  loadLibrary: () => Promise<void>;
  create: (payload: HandoutCreatePayload) => Promise<Handout | null>;
  update: (id: string, patch: HandoutPatch) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  show: (id: string, target: HandoutShowTarget) => Promise<boolean>;
  /** "Fechar para todos" (GM): fecha o overlay de quem via a mensagem — a mensagem continua no chat. */
  closeForAll: (messageId: string) => Promise<boolean>;
  pin: (sceneId: string, handoutId: string, x: number, y: number, visible: boolean) => Promise<HandoutPin | null>;
  unpin: (sceneId: string, pinId: string) => Promise<boolean>;

  // Broadcasts (bindSocket) — idempotentes, a mesma função cobre o eco otimista das ações acima.
  upsertLibrary: (handout: Handout) => void;
  removeFromLibrary: (id: string) => void;
  upsertPin: (sceneId: string, pin: HandoutPin) => void;
  removePin: (sceneId: string, pinId: string) => void;
  /** `handout:closed`: fecha o overlay LOCAL se for esta mesma mensagem (senão não faz nada). */
  closeIfOpen: (messageId: string) => void;

  // Ciclo de vida do mapa (room:join / scene:enter / leave — mesmo padrão de `templates.ts`).
  setSnapshot: (activeSceneId: string | null, pins: HandoutPin[]) => void;
  replaceScene: (sceneId: string, pins: HandoutPin[]) => void;

  /**
   * Chamado pelo handler de `chat:message` AO VIVO (bindSocket), nunca pela hidratação do
   * histórico (`room:join`/snapshot): abre o overlay sozinho quando a mensagem é um handout — é
   * assim que "GM mostra" abre na hora pra quem recebe, mas quem entra depois só vê a miniatura no
   * chat e clica pra abrir (a mensagem já veio filtrada pelo servidor: se chegou, o viewer pode vê-la).
   */
  openFromLiveMessage: (msg: ChatMessage) => void;
  /** Abre localmente sem emitir nada (clique numa miniatura do chat, ou num pino do mapa). */
  openLocal: (messageId: string | null, card: HandoutCard) => void;
  closeLocal: () => void;

  startDrag: (handoutId: string, point: DropPoint) => void;
  moveDrag: (point: DropPoint) => void;
  /** Solta: chama onDrop do alvo sob o cursor (se houver). */
  endDrag: () => void;
  cancelDrag: () => void;

  reset: () => void;
}

export const useHandouts = create<HandoutsState>((set, get) => ({
  library: [],
  libraryStatus: "idle",
  pinsByScene: {},
  open: null,
  drag: null,

  loadLibrary: async () => {
    if (get().libraryStatus === "loading") return;
    set({ libraryStatus: "loading" });
    const res = await emitAck("handout:list", {});
    if (!res.ok) {
      set({ libraryStatus: "error" });
      toast(res.error);
      return;
    }
    set({ library: res.data.items, libraryStatus: "ready" });
  },

  create: async (payload) => {
    const res = await emitAck("handout:create", payload);
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsertLibrary(res.data);
    return res.data;
  },

  update: async (id, patch) => {
    const res = await emitAck("handout:update", { id, patch });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    get().upsertLibrary(res.data);
    return true;
  },

  remove: async (id) => {
    const res = await emitAck("handout:delete", { id });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    get().removeFromLibrary(id);
    return true;
  },

  show: async (id, target) => {
    const res = await emitAck("handout:show", { id, target });
    if (!res.ok) toast(res.error);
    return res.ok;
  },

  closeForAll: async (messageId) => {
    const res = await emitAck("handout:close", { messageId });
    if (!res.ok) toast(res.error);
    return res.ok;
  },

  pin: async (sceneId, handoutId, x, y, visible) => {
    const res = await emitAck("handout:pin", { sceneId, handoutId, x, y, visible });
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsertPin(sceneId, res.data);
    return res.data;
  },

  unpin: async (sceneId, pinId) => {
    const res = await emitAck("handout:unpin", { sceneId, pinId });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    get().removePin(sceneId, pinId);
    return true;
  },

  upsertLibrary: (handout) =>
    set((s) => ({
      library: s.library.some((h) => h.id === handout.id) ? s.library.map((h) => (h.id === handout.id ? handout : h)) : [...s.library, handout],
    })),

  removeFromLibrary: (id) => set((s) => ({ library: s.library.filter((h) => h.id !== id) })),

  upsertPin: (sceneId, pin) => set((s) => ({ pinsByScene: { ...s.pinsByScene, [sceneId]: { ...s.pinsByScene[sceneId], [pin.id]: pin } } })),

  removePin: (sceneId, pinId) =>
    set((s) => {
      const { [pinId]: _removed, ...rest } = s.pinsByScene[sceneId] ?? {};
      return { pinsByScene: { ...s.pinsByScene, [sceneId]: rest } };
    }),

  closeIfOpen: (messageId) => set((s) => (s.open?.messageId === messageId ? { open: null } : {})),

  setSnapshot: (activeSceneId, pins) =>
    set({ pinsByScene: activeSceneId ? { [activeSceneId]: Object.fromEntries(pins.map((p) => [p.id, p])) } : {} }),

  replaceScene: (sceneId, pins) => set((s) => ({ pinsByScene: { ...s.pinsByScene, [sceneId]: Object.fromEntries(pins.map((p) => [p.id, p])) } })),

  openFromLiveMessage: (msg) => {
    if (msg.kind === "handout" && msg.handout) set({ open: { messageId: msg.id, card: msg.handout } });
  },
  openLocal: (messageId, card) => set({ open: { messageId, card } }),
  closeLocal: () => set({ open: null }),

  startDrag: (handoutId, point) => set({ drag: { handoutId, point, targetId: null } }),
  moveDrag: (point) => {
    const { drag, library } = get();
    const handout = drag ? library.find((h) => h.id === drag.handoutId) : undefined;
    if (!drag || !handout) return;
    set({ drag: { ...drag, point, targetId: dropTargetAt(point, handout)?.id ?? null } });
  },
  endDrag: () => {
    const { drag, library } = get();
    const handout = drag ? library.find((h) => h.id === drag.handoutId) : undefined;
    const target = drag && handout ? dropTargetAt(drag.point, handout) : null;
    set({ drag: null });
    if (target && handout) target.onDrop(handout, drag!.point);
  },
  cancelDrag: () => set({ drag: null }),

  reset: () => set({ library: [], libraryStatus: "idle", pinsByScene: {}, open: null, drag: null }),
}));

/** Lista dos pinos de UM mapa. Função pura para useMemo (não use como seletor do hook). */
export function scenePins(pinsByScene: Record<string, Record<string, HandoutPin>>, sceneId: string | null | undefined): HandoutPin[] {
  if (!sceneId) return [];
  return Object.values(pinsByScene[sceneId] ?? {});
}
