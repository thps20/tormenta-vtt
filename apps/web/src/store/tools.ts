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
  setMode: (mode: ToolMode) => void;
  setSpaceHeld: (held: boolean) => void;
}

export const useTools = create<ToolsState>((set) => ({
  mode: "select",
  spaceHeld: false,
  setMode: (mode) => set({ mode }),
  setSpaceHeld: (spaceHeld) => set({ spaceHeld }),
}));

/** Modo que o canvas deve obedecer agora (espaço segurado sobrepõe o modo escolhido). */
export const selectEffectiveMode = (s: ToolsState): ToolMode => (s.spaceHeld ? "pan" : s.mode);
