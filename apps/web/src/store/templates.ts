import { create } from "zustand";
import type { Template } from "@tormenta-vtt/shared";
import { throttle } from "../lib/throttle";
import { emitAck } from "./connection";
import { toast } from "./ui";

/**
 * Gabaritos de área de efeito (docs/plano-gabaritos.md): efêmeros, um mapa de cada vez —
 * `byScene[sceneId][templateId]`, mesmo padrão de `combat.byScene` (só a cena ativa vem no
 * snapshot; as demais o GM carrega ao visitar via `scene:enter`).
 */
interface TemplatesState {
  byScene: Record<string, Record<string, Template>>;
  /** Seleção é só local (não sincronizada): alças de mover/girar, Delete apaga o selecionado. */
  selectedId: string | null;

  /** room:join / leave: substitui tudo (igual a combat.setSnapshot). */
  setSnapshot: (activeSceneId: string | null, templates: Template[]) => void;
  /** scene:enter: substitui os gabaritos de UM mapa. */
  replaceScene: (sceneId: string, templates: Template[]) => void;
  /** Broadcast (bindSocket) ou eco otimista local. */
  upsertLocal: (sceneId: string, template: Template) => void;
  removeLocal: (sceneId: string, templateId: string) => void;
  select: (templateId: string | null) => void;

  /** Cria um gabarito novo (clique de origem já resolvido em pixels). */
  create: (sceneId: string, template: Template) => Promise<boolean>;
  /** Move/gira durante o arraste: aplica local e emite com throttle (sem ack, sem reverter — eco `live`). */
  updateLive: (sceneId: string, template: Template) => void;
  /** Ao soltar: patch final do gesto, com ack. */
  commit: (sceneId: string, template: Template) => Promise<boolean>;
  remove: (sceneId: string, templateId: string) => Promise<boolean>;
}

const emitUpsertThrottled = throttle((sceneId: string, template: Template) => {
  void emitAck("template:upsert", { sceneId, template, live: true });
}, 33);

export const useTemplates = create<TemplatesState>((set, get) => ({
  byScene: {},
  selectedId: null,

  setSnapshot: (activeSceneId, templates) =>
    set({ byScene: activeSceneId ? { [activeSceneId]: Object.fromEntries(templates.map((t) => [t.id, t])) } : {}, selectedId: null }),

  replaceScene: (sceneId, templates) =>
    set((s) => ({ byScene: { ...s.byScene, [sceneId]: Object.fromEntries(templates.map((t) => [t.id, t])) } })),

  upsertLocal: (sceneId, template) =>
    set((s) => ({ byScene: { ...s.byScene, [sceneId]: { ...s.byScene[sceneId], [template.id]: template } } })),

  removeLocal: (sceneId, templateId) =>
    set((s) => {
      const { [templateId]: _removed, ...rest } = s.byScene[sceneId] ?? {};
      return { byScene: { ...s.byScene, [sceneId]: rest }, selectedId: s.selectedId === templateId ? null : s.selectedId };
    }),

  select: (templateId) => set({ selectedId: templateId }),

  create: async (sceneId, template) => {
    get().upsertLocal(sceneId, template);
    const res = await emitAck("template:upsert", { sceneId, template });
    if (!res.ok) {
      get().removeLocal(sceneId, template.id);
      toast(res.error);
      return false;
    }
    get().upsertLocal(sceneId, res.data);
    return true;
  },

  updateLive: (sceneId, template) => {
    get().upsertLocal(sceneId, template);
    emitUpsertThrottled(sceneId, template);
  },

  commit: async (sceneId, template) => {
    emitUpsertThrottled.cancel();
    get().upsertLocal(sceneId, template);
    const res = await emitAck("template:upsert", { sceneId, template });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    get().upsertLocal(sceneId, res.data);
    return true;
  },

  remove: async (sceneId, templateId) => {
    const previous = get().byScene[sceneId]?.[templateId];
    get().removeLocal(sceneId, templateId);
    const res = await emitAck("template:remove", { sceneId, templateId });
    if (!res.ok) {
      if (previous) get().upsertLocal(sceneId, previous);
      toast(res.error);
      return false;
    }
    return true;
  },
}));

/** Lista dos gabaritos de UM mapa. Função pura para useMemo (não use como seletor do hook). */
export function sceneTemplates(byScene: Record<string, Record<string, Template>>, sceneId: string | null | undefined): Template[] {
  if (!sceneId) return [];
  return Object.values(byScene[sceneId] ?? {});
}
