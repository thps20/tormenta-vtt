import { create } from "zustand";
import type { Drawing, DrawingPatchPayload } from "@tormenta-vtt/shared";
import { throttle } from "../lib/throttle";
import { emitAck } from "./connection";
import { toast } from "./ui";

type DrawingPatch = DrawingPatchPayload["patch"];

/**
 * Desenho livre no mapa (docs/SPEC.md §9.17): `byScene[sceneId][drawingId]`, mesmo padrão de
 * `templates.ts`/`pins.ts` — só a cena ativa vem no `room:join`, as demais via `scene:enter`.
 * Persistido (diferente dos gabaritos): o servidor é sempre quem confirma create/update/remove.
 */
interface DrawingsState {
  byScene: Record<string, Record<string, Drawing>>;
  /** Seleção é só local (não sincronizada, como token/gabarito/pino): halo, Delete apaga. */
  selectedId: string | null;
  select: (drawingId: string | null) => void;

  /** Cria um traço novo (geometria já resolvida em pixels do mapa). Otimista, com rollback. */
  create: (sceneId: string, drawing: Drawing) => Promise<Drawing | null>;
  /** Move/redimensiona durante o gesto: aplica local e emite com throttle (sem reverter — eco `live`). */
  updateLive: (sceneId: string, drawingId: string, patch: DrawingPatch) => void;
  /** Ao soltar: patch final do gesto (ou edição pontual de cor/espessura/preenchimento/visibilidade). */
  commit: (sceneId: string, drawingId: string, patch: DrawingPatch) => Promise<Drawing | null>;
  remove: (sceneId: string, drawingId: string) => Promise<boolean>;
  /** "Limpar meus desenhos" (qualquer role) / "Limpar tudo" (GM) — sem eco otimista: o próprio
   *  broadcast `drawing:cleared` volta pro autor (mesma regra de pin:remove/handout:delete). */
  clearMine: (sceneId: string) => Promise<boolean>;
  clearAll: (sceneId: string) => Promise<boolean>;
  /** GM: liga/desliga "jogadores podem desenhar" na sala — o novo estado chega pelo broadcast
   *  `drawing:playerPermissionChanged` (bindSocket → useRoom), não é aplicado aqui. */
  setPlayerPermission: (enabled: boolean) => Promise<boolean>;

  // Broadcasts (bindSocket) — idempotentes, a mesma função cobre o eco otimista das ações acima.
  upsertLocal: (sceneId: string, drawing: Drawing) => void;
  removeLocal: (sceneId: string, drawingId: string) => void;
  removeManyLocal: (sceneId: string, drawingIds: string[]) => void;

  // Ciclo de vida do mapa (room:join / scene:enter / leave — mesmo padrão de `templates.ts`).
  setSnapshot: (activeSceneId: string | null, drawings: Drawing[]) => void;
  replaceScene: (sceneId: string, drawings: Drawing[]) => void;
  reset: () => void;
}

const emitPatchThrottled = throttle((sceneId: string, drawingId: string, patch: DrawingPatch) => {
  void emitAck("drawing:update", { sceneId, drawingId, patch, live: true });
}, 33);

export const useDrawings = create<DrawingsState>((set, get) => {
  /** Aplica um patch geométrico local, otimista — usado por updateLive/commit antes do ack chegar. */
  const mergePatch = (sceneId: string, drawingId: string, patch: DrawingPatch): void => {
    const current = get().byScene[sceneId]?.[drawingId];
    if (!current) return;
    const merged = { ...current, ...patch } as Drawing;
    set((s) => ({ byScene: { ...s.byScene, [sceneId]: { ...s.byScene[sceneId], [drawingId]: merged } } }));
  };

  return {
    byScene: {},
    selectedId: null,
    select: (drawingId) => set({ selectedId: drawingId }),

    create: async (sceneId, drawing) => {
      get().upsertLocal(sceneId, drawing);
      const res = await emitAck("drawing:create", { sceneId, drawing });
      if (!res.ok) {
        get().removeLocal(sceneId, drawing.id);
        toast(res.error);
        return null;
      }
      get().upsertLocal(sceneId, res.data);
      return res.data;
    },

    updateLive: (sceneId, drawingId, patch) => {
      mergePatch(sceneId, drawingId, patch);
      emitPatchThrottled(sceneId, drawingId, patch);
    },

    commit: async (sceneId, drawingId, patch) => {
      emitPatchThrottled.cancel();
      mergePatch(sceneId, drawingId, patch);
      const res = await emitAck("drawing:update", { sceneId, drawingId, patch });
      if (!res.ok) {
        toast(res.error);
        return null;
      }
      get().upsertLocal(sceneId, res.data);
      return res.data;
    },

    remove: async (sceneId, drawingId) => {
      const previous = get().byScene[sceneId]?.[drawingId];
      get().removeLocal(sceneId, drawingId);
      const res = await emitAck("drawing:remove", { sceneId, drawingId });
      if (!res.ok) {
        if (previous) get().upsertLocal(sceneId, previous);
        toast(res.error);
        return false;
      }
      return true;
    },

    clearMine: async (sceneId) => {
      const res = await emitAck("drawing:clear-mine", { sceneId });
      if (!res.ok) {
        toast(res.error);
        return false;
      }
      return true;
    },

    clearAll: async (sceneId) => {
      const res = await emitAck("drawing:clear-all", { sceneId });
      if (!res.ok) {
        toast(res.error);
        return false;
      }
      return true;
    },

    setPlayerPermission: async (enabled) => {
      const res = await emitAck("drawing:set-player-permission", { enabled });
      if (!res.ok) {
        toast(res.error);
        return false;
      }
      return true;
    },

    upsertLocal: (sceneId, drawing) =>
      set((s) => ({ byScene: { ...s.byScene, [sceneId]: { ...s.byScene[sceneId], [drawing.id]: drawing } } })),

    removeLocal: (sceneId, drawingId) =>
      set((s) => {
        const { [drawingId]: _removed, ...rest } = s.byScene[sceneId] ?? {};
        return { byScene: { ...s.byScene, [sceneId]: rest }, selectedId: s.selectedId === drawingId ? null : s.selectedId };
      }),

    removeManyLocal: (sceneId, drawingIds) =>
      set((s) => {
        const ids = new Set(drawingIds);
        const scene = s.byScene[sceneId] ?? {};
        const rest = Object.fromEntries(Object.entries(scene).filter(([id]) => !ids.has(id)));
        return { byScene: { ...s.byScene, [sceneId]: rest }, selectedId: s.selectedId && ids.has(s.selectedId) ? null : s.selectedId };
      }),

    setSnapshot: (activeSceneId, drawings) =>
      set({ byScene: activeSceneId ? { [activeSceneId]: Object.fromEntries(drawings.map((d) => [d.id, d])) } : {}, selectedId: null }),

    replaceScene: (sceneId, drawings) =>
      set((s) => ({ byScene: { ...s.byScene, [sceneId]: Object.fromEntries(drawings.map((d) => [d.id, d])) } })),

    reset: () => set({ byScene: {}, selectedId: null }),
  };
});

/** Lista dos traços de UM mapa. Função pura para useMemo (não use como seletor do hook). */
export function sceneDrawings(byScene: Record<string, Record<string, Drawing>>, sceneId: string | null | undefined): Drawing[] {
  if (!sceneId) return [];
  return Object.values(byScene[sceneId] ?? {});
}
