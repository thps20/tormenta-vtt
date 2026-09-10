import { create } from "zustand";
import { toast } from "./ui";

/**
 * Ctrl+Z LOCAL do jogador pra gabaritos de área de efeito (docs/plano-gabaritos.md §4) — jogador
 * não tem a pilha geral do GM (`store/history.ts`, `history:undo`/`history:redo` do servidor, só
 * `gmOnly`), então cada ação de gabarito do PRÓPRIO jogador empilha aqui, no cliente, sem servidor
 * nenhum envolvido. Só undo (sem redo), mesmo motivo da Névoa não ter refazer: mantém simples, sem
 * precisar reconciliar com o que outros participantes mexeram no meio tempo. Empilhado só quando
 * `!isGm` — o GM já tem a pilha geral cobrindo os próprios gabaritos (`socket/templates.ts`).
 */
interface TemplateHistoryEntry {
  /** "colocar área (cone 9 m)" etc. — mesmo formato de `describeTemplateChange` (shared). */
  summary: string;
  /** Reverte a ação (reemite template:upsert/remove com o estado anterior). */
  revert: () => Promise<boolean>;
}

interface TemplateHistoryState {
  entries: TemplateHistoryEntry[];
  push: (entry: TemplateHistoryEntry) => void;
  undo: () => Promise<void>;
}

export const useTemplateHistory = create<TemplateHistoryState>((set, get) => ({
  entries: [],

  push: (entry) => set((s) => ({ entries: [...s.entries, entry] })),

  undo: async () => {
    const { entries } = get();
    const top = entries[entries.length - 1];
    if (!top) return;
    set({ entries: entries.slice(0, -1) });
    const ok = await top.revert();
    if (ok) toast(`Desfeito: ${top.summary}`, "info");
    // Falhou (ex.: alguém apagou o gabarito no meio tempo) — a entrada já saiu da pilha, sem
    // segunda tentativa, mesmo espírito de invalidação do desfazer geral (docs/plano-desfazer.md §7).
  },
}));
