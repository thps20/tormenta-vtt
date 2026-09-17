import { create } from "zustand";
import type { PrepItemOptions, PrepItemPatch, PrepRef, PrepStep, PrepStepPatch } from "@tormenta-vtt/shared";
import { emitAck } from "./connection";
import { toast } from "./ui";

/**
 * Preparo do mapa (docs/plano-preparo.md §2): lista de passos por CENA, carregada sob demanda
 * (como `store/pins.ts`/notas — só a cena que a aba "Preparo" está mostrando). Cada mutação de item
 * já devolve o `PrepStep` inteiro (com `sceneId`), então o `upsertStep` local não precisa que quem
 * chama informe onde guardar — a única exceção é `prep:step-delete` (ack sem dado), que por isso
 * pede `sceneId` explícito na assinatura.
 */
interface PrepState {
  stepsByScene: Record<string, PrepStep[]>;
  statusByScene: Record<string, "idle" | "loading" | "ready" | "error">;

  loadSteps: (sceneId: string) => Promise<void>;
  createStep: (sceneId: string, title: string, afterStepId?: string) => Promise<PrepStep | null>;
  updateStep: (stepId: string, patch: PrepStepPatch) => Promise<PrepStep | null>;
  deleteStep: (sceneId: string, stepId: string) => Promise<boolean>;
  reorderSteps: (sceneId: string, stepIds: string[]) => Promise<boolean>;
  /** Mesmo mapa = duplica; mapa diferente = copia pro fim de lá. `brokenPinRefs` avisa que algum
   *  item `pin` não faz sentido no mapa de destino (§2.4). */
  copyStep: (stepId: string, targetSceneId: string) => Promise<{ step: PrepStep; brokenPinRefs: boolean } | null>;

  addItem: (stepId: string, ref: PrepRef, index?: number) => Promise<PrepStep | null>;
  updateItem: (stepId: string, itemId: string, patch: PrepItemPatch) => Promise<PrepStep | null>;
  removeItem: (stepId: string, itemId: string) => Promise<PrepStep | null>;
  moveItem: (stepId: string, itemId: string, toStepId: string, index: number) => Promise<boolean>;

  resetPrep: (sceneId: string) => Promise<boolean>;

  // Broadcasts (bindSocket) — idempotentes, a mesma função cobre o eco otimista das ações acima.
  upsertStep: (step: PrepStep) => void;
  removeStepLocal: (sceneId: string, stepId: string) => void;
  applyReorder: (sceneId: string, order: { stepId: string; order: number }[]) => void;

  reset: () => void;
}

/** Atalho pra chamar um `patch` de item só com uma opção (auto/used/options parcial). */
export function itemPatchOptions(current: PrepItemOptions, patch: Partial<PrepItemOptions>): PrepItemOptions {
  return { ...current, ...patch };
}

export const usePrep = create<PrepState>((set, get) => ({
  stepsByScene: {},
  statusByScene: {},

  loadSteps: async (sceneId) => {
    if (get().statusByScene[sceneId] === "loading") return;
    set((s) => ({ statusByScene: { ...s.statusByScene, [sceneId]: "loading" } }));
    const res = await emitAck("prep:list", { sceneId });
    if (!res.ok) {
      set((s) => ({ statusByScene: { ...s.statusByScene, [sceneId]: "error" } }));
      toast(res.error);
      return;
    }
    set((s) => ({
      stepsByScene: { ...s.stepsByScene, [sceneId]: [...res.data].sort((a, b) => a.order - b.order) },
      statusByScene: { ...s.statusByScene, [sceneId]: "ready" },
    }));
  },

  createStep: async (sceneId, title, afterStepId) => {
    const res = await emitAck("prep:step-create", { sceneId, title, afterStepId });
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsertStep(res.data);
    return res.data;
  },

  updateStep: async (stepId, patch) => {
    const res = await emitAck("prep:step-update", { stepId, patch });
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsertStep(res.data);
    return res.data;
  },

  deleteStep: async (sceneId, stepId) => {
    const res = await emitAck("prep:step-delete", { stepId });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    get().removeStepLocal(sceneId, stepId);
    return true;
  },

  reorderSteps: async (sceneId, stepIds) => {
    const res = await emitAck("prep:step-reorder", { sceneId, stepIds });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    set((s) => ({ stepsByScene: { ...s.stepsByScene, [sceneId]: [...res.data].sort((a, b) => a.order - b.order) } }));
    return true;
  },

  copyStep: async (stepId, targetSceneId) => {
    const res = await emitAck("prep:step-copy", { stepId, targetSceneId });
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsertStep(res.data.step);
    return res.data;
  },

  addItem: async (stepId, ref, index) => {
    const res = await emitAck("prep:item-add", { stepId, ref, index });
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsertStep(res.data);
    return res.data;
  },

  updateItem: async (stepId, itemId, patch) => {
    const res = await emitAck("prep:item-update", { stepId, itemId, patch });
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsertStep(res.data);
    return res.data;
  },

  removeItem: async (stepId, itemId) => {
    const res = await emitAck("prep:item-remove", { stepId, itemId });
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsertStep(res.data);
    return res.data;
  },

  moveItem: async (stepId, itemId, toStepId, index) => {
    const res = await emitAck("prep:item-move", { stepId, itemId, toStepId, index });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    for (const step of res.data) get().upsertStep(step);
    return true;
  },

  resetPrep: async (sceneId) => {
    const res = await emitAck("prep:reset", { sceneId });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    for (const step of res.data) get().upsertStep(step);
    return true;
  },

  upsertStep: (step) =>
    set((s) => {
      const list = s.stepsByScene[step.sceneId] ?? [];
      const next = list.some((st) => st.id === step.id) ? list.map((st) => (st.id === step.id ? step : st)) : [...list, step];
      next.sort((a, b) => a.order - b.order);
      return { stepsByScene: { ...s.stepsByScene, [step.sceneId]: next } };
    }),

  removeStepLocal: (sceneId, stepId) =>
    set((s) => ({ stepsByScene: { ...s.stepsByScene, [sceneId]: (s.stepsByScene[sceneId] ?? []).filter((st) => st.id !== stepId) } })),

  applyReorder: (sceneId, order) =>
    set((s) => {
      const list = s.stepsByScene[sceneId];
      if (!list) return {};
      const orderById = new Map(order.map((o) => [o.stepId, o.order]));
      const next = list.map((st) => (orderById.has(st.id) ? { ...st, order: orderById.get(st.id)! } : st)).sort((a, b) => a.order - b.order);
      return { stepsByScene: { ...s.stepsByScene, [sceneId]: next } };
    }),

  reset: () => set({ stepsByScene: {}, statusByScene: {} }),
}));
