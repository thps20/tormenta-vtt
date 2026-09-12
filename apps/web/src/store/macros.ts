import { create } from "zustand";
import type { Macro, MacroAction } from "@tormenta-vtt/shared";
import { useCharacters } from "./characters";
import { useChat } from "./chat";
import { emitAck } from "./connection";
import { toast } from "./ui";

/**
 * Macros (§9.20): barra de botões por participante, persistida por sala. Mesmo padrão de
 * `store/pins.ts` — as ações de mutação (`create`/`update`/`remove`/`reorder`) e o handler de
 * broadcast (`bindSocket.ts`) convergem nas mesmas funções `upsertMacro`/`removeMacro`/`setOrder`.
 *
 * EXECUTAR uma macro (`run`) não é um evento de macro nenhum: ela só reconstrói o payload do
 * evento que já existe (`chat:send`/`character:roll`/`character:use-item`) e chama a AÇÃO da store
 * correspondente — o mesmo caminho que o botão manual (faixa de chat, botão de ação da ficha)
 * usaria. Isso garante de graça que a permissão de executar é a mesma de sempre.
 */
interface MacrosState {
  macros: Macro[];

  create: (payload: { label: string; icon: string; color: string; action: MacroAction }) => Promise<Macro | null>;
  update: (id: string, patch: Partial<{ label: string; icon: string; color: string; action: MacroAction }>) => Promise<Macro | null>;
  remove: (id: string) => Promise<boolean>;
  reorder: (macroIds: string[]) => Promise<boolean>;
  /** Executa a ação da macro reemitindo o evento correspondente. */
  run: (macro: Macro) => Promise<void>;

  // Broadcasts (bindSocket) — idempotentes, mesma função cobre o eco otimista das ações acima.
  upsertMacro: (macro: Macro) => void;
  removeMacro: (id: string) => void;
  applyReorder: (order: { id: string; order: number }[]) => void;

  setAll: (macros: Macro[]) => void;
  reset: () => void;
}

export const useMacros = create<MacrosState>((set, get) => ({
  macros: [],

  create: async (payload) => {
    const res = await emitAck("macro:create", payload);
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsertMacro(res.data);
    return res.data;
  },

  update: async (id, patch) => {
    const res = await emitAck("macro:update", { id, patch });
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsertMacro(res.data);
    return res.data;
  },

  remove: async (id) => {
    const res = await emitAck("macro:remove", { id });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    get().removeMacro(id);
    return true;
  },

  reorder: async (macroIds) => {
    const previous = get().macros.map((m) => ({ id: m.id, order: m.order }));
    get().applyReorder(macroIds.map((id, order) => ({ id, order }))); // 1. otimista
    const res = await emitAck("macro:reorder", { macroIds });
    if (!res.ok) {
      get().applyReorder(previous); // 2. reverte
      toast(res.error);
      return false;
    }
    get().applyReorder(res.data.order);
    return true;
  },

  run: async (macro) => {
    const { action } = macro;
    switch (action.type) {
      case "roll":
        await useChat.getState().send(`/r ${action.formula}${action.label ? ` # ${action.label}` : ""}`);
        return;
      case "chatText":
        await useChat.getState().send(action.text);
        return;
      case "characterAction":
        await useCharacters.getState().roll(action.characterId, { type: "action", itemId: action.itemId, actionId: action.actionId, enhancements: action.enhancements });
        return;
      case "useItem":
        await useCharacters.getState().useItem(action.characterId, action.itemId, action.enhancements);
        return;
    }
  },

  upsertMacro: (macro) => set((s) => ({ macros: s.macros.some((m) => m.id === macro.id) ? s.macros.map((m) => (m.id === macro.id ? macro : m)) : [...s.macros, macro] })),
  removeMacro: (id) => set((s) => ({ macros: s.macros.filter((m) => m.id !== id) })),
  applyReorder: (order) => {
    const orderById = new Map(order.map((o) => [o.id, o.order]));
    set((s) => ({ macros: s.macros.map((m) => (orderById.has(m.id) ? { ...m, order: orderById.get(m.id)! } : m)) }));
  },

  setAll: (macros) => set({ macros }),
  reset: () => set({ macros: [] }),
}));

/** Macros na ordem de exibição (barra e teclas 1..9). Função pura para useMemo. */
export function orderedMacros(macros: Macro[]): Macro[] {
  return [...macros].sort((a, b) => a.order - b.order);
}
