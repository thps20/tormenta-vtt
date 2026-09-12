import { create } from "zustand";
import { DRAWING_MAX_STROKE_WIDTH, DRAWING_MIN_STROKE_WIDTH, type DrawingKind, type Ruler, type TemplatePreset, type TemplateShape } from "@tormenta-vtt/shared";
import { throttle } from "../lib/throttle";
import { emitAck } from "./connection";

/**
 * Ferramenta ativa no canvas (barra vertical à esquerda). Um modo por vez.
 * "fog" é só do GM (ver useToolShortcuts e Toolbar). "template"/"draw" não são GM-only (jogador usa
 * "draw" condicionado ao toggle `RoomState.playerDrawingEnabled`, SPEC §9.17).
 */
export type ToolMode = "select" | "pan" | "ruler" | "fog" | "template" | "draw" | "pin";

/** Paleta fixa da sub-barra de Desenho (SPEC §9.17: "paleta pequena", sem color-picker livre). */
export const DRAWING_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#f8fafc"] as const;

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
  /**
   * Modo Área (docs/plano-gabaritos.md): forma escolhida, tamanho na unidade do sistema (metros em
   * T20) e, só para cone/linha, a sobrescrita de ângulo/largura de um preset (undefined = usa o
   * padrão do sistema, `SystemDefinition.templates.coneAngle`/`.lineWidth`).
   */
  templateShape: TemplateShape;
  templateSize: number;
  templateAngle: number | undefined;
  templateWidth: number | undefined;
  /** Modo Desenho (SPEC §9.17): forma do traço, cor (paleta fixa acima), espessura (1-20px, ou
   *  fontSize quando `drawKind === "text"`), preenchimento (só rect/ellipse) e visibilidade do
   *  PRÓXIMO traço que o GM criar ("todos" padrão, ou "só GM" pra marcar coisas na preparação —
   *  jogador não tem este controle, o servidor sempre força `true` no traço dele). */
  drawKind: DrawingKind;
  drawColor: string;
  drawStrokeWidth: number;
  drawFilled: boolean;
  drawVisible: boolean;
  setMode: (mode: ToolMode) => void;
  setFogMode: (fogMode: FogToolMode) => void;
  setFogShape: (fogShape: FogToolShape) => void;
  setFogBrushSize: (size: number) => void;
  setTemplateShape: (shape: TemplateShape) => void;
  setTemplateSize: (size: number) => void;
  setDrawKind: (kind: DrawingKind) => void;
  setDrawColor: (color: string) => void;
  setDrawStrokeWidth: (width: number) => void;
  setDrawFilled: (filled: boolean) => void;
  setDrawVisible: (visible: boolean) => void;
  /** Preset do JSON do sistema, ou do botão "Colocar área" do card de item: preenche forma+tamanho
   *  (e ângulo/largura, se o preset sobrescrever) sem posicionar sozinho — o clique no mapa continua
   *  definindo a origem. */
  pickTemplatePreset: (preset: Pick<TemplatePreset, "shape" | "size" | "angle" | "width">) => void;
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
  templateShape: "circle",
  templateSize: 6,
  templateAngle: undefined,
  templateWidth: undefined,
  drawKind: "pen",
  drawColor: DRAWING_COLORS[0],
  drawStrokeWidth: 4,
  drawFilled: false,
  drawVisible: true,
  setMode: (mode) => set({ mode }),
  setFogMode: (fogMode) => set({ fogMode }),
  setFogShape: (fogShape) => set({ fogShape }),
  setFogBrushSize: (size) => set({ fogBrushSize: Math.max(FOG_BRUSH_MIN, Math.min(FOG_BRUSH_MAX, Math.round(size))) }),
  setTemplateShape: (templateShape) => set({ templateShape }),
  setTemplateSize: (size) => set({ templateSize: Math.max(0.1, size) }),
  setDrawKind: (drawKind) => set({ drawKind }),
  setDrawColor: (drawColor) => set({ drawColor }),
  setDrawStrokeWidth: (width) => set({ drawStrokeWidth: Math.max(DRAWING_MIN_STROKE_WIDTH, Math.min(DRAWING_MAX_STROKE_WIDTH, Math.round(width))) }),
  setDrawFilled: (drawFilled) => set({ drawFilled }),
  setDrawVisible: (drawVisible) => set({ drawVisible }),
  pickTemplatePreset: (preset) =>
    set({ templateShape: preset.shape, templateSize: preset.size, templateAngle: preset.angle, templateWidth: preset.width }),
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
