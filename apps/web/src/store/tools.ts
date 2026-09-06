import { create } from "zustand";
import type { Ruler } from "@tormenta-vtt/shared";
import { throttle } from "../lib/throttle";
import { emitAck } from "./connection";

/**
 * Ferramenta ativa no canvas (barra vertical à esquerda). Um modo por vez;
 * "draw" já existe no tipo para a barra reservar o lugar, mas ainda não faz nada.
 * "fog" é só do GM (ver useToolShortcuts e Toolbar).
 */
export type ToolMode = "select" | "pan" | "ruler" | "fog" | "draw";

/** Sub-modo da névoa: o que a forma desenhada faz. */
export type FogToolMode = "reveal" | "hide";
/** Forma que o GM desenha no modo Névoa. */
export type FogToolShape = "brush" | "rect" | "polygon";

export const FOG_BRUSH_MIN = 20;
export const FOG_BRUSH_MAX = 600;

/** Régua de outro participante, como chegou em ruler:updated. */
export interface RemoteRuler {
  participantId: string;
  nickname: string;
  sceneId: string;
  ruler: Ruler;
}

interface ToolsState {
  mode: ToolMode;
  /** Barra de espaço pressionada: vira "pan" temporariamente sem perder o modo escolhido. */
  spaceHeld: boolean;
  /** Esc: muda a cada pedido de cancelar o gesto em andamento (caixa de seleção, régua). */
  cancelNonce: number;
  /** Minha régua em andamento (pixels do mapa). Some ao soltar o mouse. */
  ruler: Ruler | null;
  /** Réguas dos outros, por participante. */
  remoteRulers: Record<string, RemoteRuler>;
  /** Modo Névoa (GM): revelar ou ocultar, com qual forma, e o diâmetro do pincel em pixels do mapa. */
  fogMode: FogToolMode;
  fogShape: FogToolShape;
  fogBrushSize: number;
  setMode: (mode: ToolMode) => void;
  setFogMode: (fogMode: FogToolMode) => void;
  setFogShape: (fogShape: FogToolShape) => void;
  setFogBrushSize: (size: number) => void;
  setSpaceHeld: (held: boolean) => void;
  cancel: () => void;
  /** Aplica local e emite com throttle (efêmero: sem ack, sem reverter). */
  updateRuler: (sceneId: string, ruler: Ruler) => void;
  /** Soltou/cancelou: apaga local e avisa os outros (se havia régua). */
  clearRuler: (sceneId: string) => void;
  setRemoteRuler: (p: { participantId: string; nickname: string; sceneId: string; ruler: Ruler | null }) => void;
  removeRemoteRuler: (participantId: string) => void;
}

/** Máx. ~30 emissões por segundo enquanto arrasta a régua (mesmo ritmo do token). */
const emitRulerThrottled = throttle((sceneId: string, ruler: Ruler) => {
  void emitAck("ruler:update", { sceneId, ruler });
}, 33);

export const useTools = create<ToolsState>((set, get) => ({
  mode: "select",
  spaceHeld: false,
  cancelNonce: 0,
  ruler: null,
  remoteRulers: {},
  fogMode: "reveal",
  fogShape: "brush",
  fogBrushSize: 140,
  setMode: (mode) => set({ mode }),
  setFogMode: (fogMode) => set({ fogMode }),
  setFogShape: (fogShape) => set({ fogShape }),
  setFogBrushSize: (size) => set({ fogBrushSize: Math.max(FOG_BRUSH_MIN, Math.min(FOG_BRUSH_MAX, Math.round(size))) }),
  setSpaceHeld: (spaceHeld) => set({ spaceHeld }),
  cancel: () => set((s) => ({ cancelNonce: s.cancelNonce + 1 })),

  updateRuler: (sceneId, ruler) => {
    set({ ruler });
    emitRulerThrottled(sceneId, ruler);
  },
  clearRuler: (sceneId) => {
    if (!get().ruler) return;
    // Um envio pendente chegaria depois do "apagar" e ressuscitaria a régua nos outros.
    emitRulerThrottled.cancel();
    set({ ruler: null });
    void emitAck("ruler:update", { sceneId, ruler: null });
  },
  setRemoteRuler: ({ participantId, nickname, sceneId, ruler }) =>
    set((s) => {
      const { [participantId]: _old, ...rest } = s.remoteRulers;
      return { remoteRulers: ruler ? { ...rest, [participantId]: { participantId, nickname, sceneId, ruler } } : rest };
    }),
  removeRemoteRuler: (participantId) =>
    set((s) => {
      const { [participantId]: _old, ...rest } = s.remoteRulers;
      return { remoteRulers: rest };
    }),
}));

/** Modo que o canvas deve obedecer agora (espaço segurado sobrepõe o modo escolhido). */
export const selectEffectiveMode = (s: ToolsState): ToolMode => (s.spaceHeld ? "pan" : s.mode);
