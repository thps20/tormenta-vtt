import { create } from "zustand";
import type { ChatMessage, TokenApplyDamagePayload } from "@tormenta-vtt/shared";
import { emitAck } from "./connection";
import { toast } from "./ui";

interface ChatState {
  messages: ChatMessage[];
  setAll: (messages: ChatMessage[]) => void;
  append: (msg: ChatMessage) => void;
  /** Envia texto ou comando (/r, /gr). Sem otimismo: a rolagem só existe depois do servidor. */
  send: (text: string) => Promise<boolean>;
  /** Aplica um card de dano/cura em um ou mais tokens (GM sempre; jogador só nos que possui). */
  applyDamage: (messageId: string, targets: TokenApplyDamagePayload["targets"]) => Promise<boolean>;
}

const MAX_MESSAGES = 300;

export const useChat = create<ChatState>((set, get) => ({
  messages: [],
  setAll: (messages) => set({ messages }),
  append: (msg) =>
    set((s) => {
      if (s.messages.some((m) => m.id === msg.id)) return s;
      return { messages: [...s.messages, msg].slice(-MAX_MESSAGES) };
    }),
  send: async (text) => {
    const res = await emitAck("chat:send", { text });
    if (!res.ok) toast(res.error);
    return res.ok;
  },
  applyDamage: async (messageId, targets) => {
    const res = await emitAck("token:apply-damage", { messageId, targets });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    // O broadcast (chat:message) também chega; append é idempotente (ignora id repetido).
    get().append(res.data);
    return true;
  },
}));
