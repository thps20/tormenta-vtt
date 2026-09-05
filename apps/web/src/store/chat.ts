import { create } from "zustand";
import type { ChatMessage } from "@tormenta-vtt/shared";
import { emitAck } from "./connection";
import { toast } from "./ui";

interface ChatState {
  messages: ChatMessage[];
  setAll: (messages: ChatMessage[]) => void;
  append: (msg: ChatMessage) => void;
  /** Envia texto ou comando (/r, /gr). Sem otimismo: a rolagem só existe depois do servidor. */
  send: (text: string) => Promise<boolean>;
}

const MAX_MESSAGES = 300;

export const useChat = create<ChatState>((set) => ({
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
}));
