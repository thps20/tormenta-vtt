import { create } from "zustand";
import type { Pin, PinCreatePayload, PinUpdatePayload } from "@tormenta-vtt/shared";
import { emitAck } from "./connection";
import { toast } from "./ui";

/**
 * Pinos no mapa (docs/plano-narracao.md — unifica o antigo `store/handouts.ts#pinsByScene` com o
 * pino de nota): `pinsByScene[sceneId][pinId]`, mesmo padrão de `templates.ts` — só a cena ativa
 * vem no room:join, as demais via `scene:enter`. Biblioteca de handouts (criar/editar/apagar/
 * mostrar/fechar) continua em `store/handouts.ts`; aqui é só o PINO no mapa (handout OU nota).
 */
interface PinsState {
  pinsByScene: Record<string, Record<string, Pin>>;

  create: (payload: PinCreatePayload) => Promise<Pin | null>;
  /** Só pinos `kind: "note"` — handout continua "apagar e fixar de novo". */
  update: (sceneId: string, pinId: string, patch: PinUpdatePayload["patch"]) => Promise<Pin | null>;
  remove: (sceneId: string, pinId: string) => Promise<boolean>;

  // Broadcasts (bindSocket) — idempotentes, a mesma função cobre o eco otimista das ações acima.
  upsertPin: (sceneId: string, pin: Pin) => void;
  removePin: (sceneId: string, pinId: string) => void;

  // Ciclo de vida do mapa (room:join / scene:enter / leave — mesmo padrão de `templates.ts`).
  setSnapshot: (activeSceneId: string | null, pins: Pin[]) => void;
  replaceScene: (sceneId: string, pins: Pin[]) => void;

  reset: () => void;
}

export const usePins = create<PinsState>((set, get) => ({
  pinsByScene: {},

  create: async (payload) => {
    const res = await emitAck("pin:create", payload);
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsertPin(payload.sceneId, res.data);
    return res.data;
  },

  update: async (sceneId, pinId, patch) => {
    const res = await emitAck("pin:update", { sceneId, pinId, patch });
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsertPin(sceneId, res.data);
    return res.data;
  },

  remove: async (sceneId, pinId) => {
    const res = await emitAck("pin:remove", { sceneId, pinId });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    get().removePin(sceneId, pinId);
    return true;
  },

  upsertPin: (sceneId, pin) => set((s) => ({ pinsByScene: { ...s.pinsByScene, [sceneId]: { ...s.pinsByScene[sceneId], [pin.id]: pin } } })),

  removePin: (sceneId, pinId) =>
    set((s) => {
      const { [pinId]: _removed, ...rest } = s.pinsByScene[sceneId] ?? {};
      return { pinsByScene: { ...s.pinsByScene, [sceneId]: rest } };
    }),

  setSnapshot: (activeSceneId, pins) => set({ pinsByScene: activeSceneId ? { [activeSceneId]: Object.fromEntries(pins.map((p) => [p.id, p])) } : {} }),

  replaceScene: (sceneId, pins) => set((s) => ({ pinsByScene: { ...s.pinsByScene, [sceneId]: Object.fromEntries(pins.map((p) => [p.id, p])) } })),

  reset: () => set({ pinsByScene: {} }),
}));

/** Lista dos pinos de UM mapa. Função pura para useMemo (não use como seletor do hook). */
export function scenePins(pinsByScene: Record<string, Record<string, Pin>>, sceneId: string | null | undefined): Pin[] {
  if (!sceneId) return [];
  return Object.values(pinsByScene[sceneId] ?? {});
}
