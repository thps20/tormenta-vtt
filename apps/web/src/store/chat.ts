import { create } from "zustand";
import type { ChatMessage, RollVisibility, TokenApplyDamagePayload } from "@tormenta-vtt/shared";
import { loadRollMode, nextRollMode, saveRollMode } from "../lib/rollMode";
import { emitAck } from "./connection";
import { toast } from "./ui";

interface ChatState {
  messages: ChatMessage[];
  /** Modo de rolagem atual (vale para faixa, /r, ficha e cards até trocar). */
  rollMode: RollVisibility;
  setAll: (messages: ChatMessage[]) => void;
  /** Insere ou substitui (mesma mensagem revelada volta com visibility nova). */
  append: (msg: ChatMessage) => void;
  setRollMode: (mode: RollVisibility) => void;
  cycleRollMode: () => void;
  /** Envia texto ou comando (/r, /gmr, /pr). Sem otimismo: a rolagem só existe depois do servidor. */
  send: (text: string) => Promise<boolean>;
  /** GM torna pública uma mensagem secreta/própria. */
  reveal: (messageId: string) => Promise<boolean>;
  /** Aplica um card de dano/cura em um ou mais tokens (GM sempre; jogador só nos que possui). */
  applyDamage: (messageId: string, targets: TokenApplyDamagePayload["targets"]) => Promise<boolean>;
}

const MAX_MESSAGES = 300;

/**
 * O servidor devolve a rolagem sem `roll` quando o autor não pode vê-la
 * (jogador em modo Secreta). Como nada aparece no chat dele, avisamos por toast.
 */
export function notifyBlindRoll(msg: ChatMessage): void {
  if (msg.kind === "roll" && !msg.roll) toast("Rolagem às cegas enviada ao GM", "info");
}

export const useChat = create<ChatState>((set, get) => ({
  messages: [],
  rollMode: loadRollMode(),
  setAll: (messages) => set({ messages }),
  append: (msg) =>
    set((s) => {
      const idx = s.messages.findIndex((m) => m.id === msg.id);
      if (idx >= 0) {
        const next = s.messages.slice();
        next[idx] = msg;
        return { messages: next };
      }
      // Mensagem revelada pode ser antiga: entra na posição do createdAt, não no fim.
      const next = s.messages.slice();
      let i = next.length;
      while (i > 0 && (next[i - 1]?.createdAt ?? "") > msg.createdAt) i--;
      next.splice(i, 0, msg);
      return { messages: next.slice(-MAX_MESSAGES) };
    }),
  setRollMode: (mode) => {
    saveRollMode(mode);
    set({ rollMode: mode });
  },
  cycleRollMode: () => get().setRollMode(nextRollMode(get().rollMode)),
  send: async (text) => {
    const res = await emitAck("chat:send", { text, visibility: get().rollMode });
    if (!res.ok) toast(res.error);
    else notifyBlindRoll(res.data);
    return res.ok;
  },
  reveal: async (messageId) => {
    const res = await emitAck("chat:reveal", { messageId });
    if (!res.ok) toast(res.error);
    return res.ok;
  },
  applyDamage: async (messageId, targets) => {
    const res = await emitAck("token:apply-damage", { messageId, targets });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    // O broadcast (chat:message) também chega; append é idempotente (substitui pelo id).
    get().append(res.data);
    return true;
  },
}));
