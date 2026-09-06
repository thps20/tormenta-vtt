import { create } from "zustand";

/**
 * Ferramenta ativa no canvas (barra vertical à esquerda). Um modo por vez;
 * "fog" e "draw" já existem no tipo para a barra reservar o lugar, mas ainda
 * não fazem nada.
 */
export type ToolMode = "select" | "pan" | "ruler" | "fog" | "draw";

interface ToolsState {
  mode: ToolMode;
  /** Barra de espaço pressionada: vira "pan" temporariamente sem perder o modo escolhido. */
  spaceHeld: boolean;
  /** Esc: muda a cada pedido de cancelar o gesto em andamento (caixa de seleção, régua). */
  cancelNonce: number;
  setMode: (mode: ToolMode) => void;
  setSpaceHeld: (held: boolean) => void;
  cancel: () => void;
}

export const useTools = create<ToolsState>((set) => ({
  mode: "select",
  spaceHeld: false,
  cancelNonce: 0,
  setMode: (mode) => set({ mode }),
  setSpaceHeld: (spaceHeld) => set({ spaceHeld }),
  cancel: () => set((s) => ({ cancelNonce: s.cancelNonce + 1 })),
}));

/** Modo que o canvas deve obedecer agora (espaço segurado sobrepõe o modo escolhido). */
export const selectEffectiveMode = (s: ToolsState): ToolMode => (s.spaceHeld ? "pan" : s.mode);
