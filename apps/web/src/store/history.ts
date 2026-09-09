import { create } from "zustand";
import { emitAck } from "./connection";
import { toast } from "./ui";

/**
 * Pilha de desfazer/refazer do GM (docs/plano-desfazer.md). O estado (canUndo/canRedo/summaries)
 * vem do broadcast `history:updated` (bindSocket.ts) — esta store nunca calcula isso sozinha, só
 * espelha o que o servidor manda. `undo()`/`redo()` só emitem o evento e mostram o toast: o
 * broadcast `history:updated` (e o `token:updated`/`token:deleted`/etc. normal de cada entidade
 * afetada) é quem atualiza o resto da UI, igual a qualquer outra ação do projeto.
 */
interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoSummary?: string;
  redoSummary?: string;
  setState: (p: { canUndo: boolean; canRedo: boolean; undoSummary?: string; redoSummary?: string }) => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export const useHistory = create<HistoryState>((set, get) => ({
  canUndo: false,
  canRedo: false,
  undoSummary: undefined,
  redoSummary: undefined,

  // set(p) faria merge raso: como o servidor OMITE undoSummary/redoSummary quando a pilha
  // correspondente está vazia (peekSummaries, services/history.ts), a chave nem chega no `p` — um
  // merge raso deixaria o valor antigo "preso" pra sempre (ex.: tooltip do botão desabilitado ainda
  // mostrando o resumo da última entrada desfeita). Reconstrói os 4 campos por inteiro toda vez.
  setState: (p) => set({ canUndo: p.canUndo, canRedo: p.canRedo, undoSummary: p.undoSummary, redoSummary: p.redoSummary }),

  undo: async () => {
    if (!get().canUndo) return;
    const res = await emitAck("history:undo", {});
    if (!res.ok) {
      toast(res.error);
      return;
    }
    if (res.data) toast(`Desfeito: ${res.data.summary}`, "info");
  },

  redo: async () => {
    if (!get().canRedo) return;
    const res = await emitAck("history:redo", {});
    if (!res.ok) {
      toast(res.error);
      return;
    }
    if (res.data) toast(`Refeito: ${res.data.summary}`, "info");
  },
}));
