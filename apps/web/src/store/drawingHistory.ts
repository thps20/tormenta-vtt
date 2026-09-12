import { create } from "zustand";
import { toast } from "./ui";

/**
 * Ctrl+Z LOCAL do jogador pra desenho livre (docs/SPEC.md §9.17, mesma decisão de gabaritos —
 * `store/templateHistory.ts`): jogador não tem a pilha geral do GM (`store/history.ts`,
 * `history:undo`/`history:redo` do servidor, só `gmOnly`), então cada ação do PRÓPRIO jogador
 * (criar/mover/redimensionar/apagar um traço, "Limpar meus desenhos") empilha aqui, no cliente, sem
 * servidor nenhum envolvido. Só undo (sem redo), mesmo motivo da névoa/gabaritos: mantém simples,
 * sem precisar reconciliar com o que outros participantes mexeram no meio tempo. Empilhado só
 * quando `!isGm` — o GM já tem a pilha geral cobrindo os próprios traços (socket/drawings.ts).
 */
interface DrawingHistoryEntry {
  /** "desenhar", "mover desenho", "apagar desenho", "limpar 3 desenhos"... */
  summary: string;
  /** Reverte a ação (reemite drawing:create/update/remove com o estado anterior). */
  revert: () => Promise<boolean>;
}

interface DrawingHistoryState {
  entries: DrawingHistoryEntry[];
  push: (entry: DrawingHistoryEntry) => void;
  undo: () => Promise<void>;
}

export const useDrawingHistory = create<DrawingHistoryState>((set, get) => ({
  entries: [],

  push: (entry) => set((s) => ({ entries: [...s.entries, entry] })),

  undo: async () => {
    const { entries } = get();
    const top = entries[entries.length - 1];
    if (!top) return;
    set({ entries: entries.slice(0, -1) });
    const ok = await top.revert();
    if (ok) toast(`Desfeito: ${top.summary}`, "info");
    // Falhou (ex.: o GM apagou o traço no meio tempo) — a entrada já saiu da pilha, sem segunda
    // tentativa, mesmo espírito de invalidação do desfazer geral (docs/plano-desfazer.md §7).
  },
}));
