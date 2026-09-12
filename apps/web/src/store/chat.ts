import { create } from "zustand";
import type { ChatMessage, RollVisibility, TokenApplyDamagePayload } from "@tormenta-vtt/shared";
import { loadRollMode, nextRollMode, saveRollMode } from "../lib/rollMode";
import { emitAck } from "./connection";
import { toast } from "./ui";

interface ChatState {
  messages: ChatMessage[];
  /** Modo de rolagem atual (vale para faixa, /r, ficha e cards até trocar). */
  rollMode: RollVisibility;
  /**
   * Sussurro pontual (docs/plano-narracao.md — seletor "para" ao lado do modo de rolagem):
   * participantId escolhido pra PRÓXIMA mensagem (texto ou rolagem), ou null = todos. Diferente de
   * `rollMode`, NÃO fica "grudado": `send` reseta pra null depois de enviar, pra não sussurrar sem
   * querer na mensagem seguinte.
   */
  whisperTarget: string | null;
  setAll: (messages: ChatMessage[]) => void;
  /** Insere ou substitui (mesma mensagem revelada volta com visibility nova). */
  append: (msg: ChatMessage) => void;
  setRollMode: (mode: RollVisibility) => void;
  cycleRollMode: () => void;
  setWhisperTarget: (participantId: string | null) => void;
  /** Envia texto ou comando (/r, /gmr, /pr, /w). Sem otimismo: a rolagem só existe depois do
   *  servidor. Usa `whisperTarget` (se setado) e reseta ele depois de enviar. */
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
  whisperTarget: null,
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
  setWhisperTarget: (participantId) => set({ whisperTarget: participantId }),
  send: async (text) => {
    const whisperTo = get().whisperTarget;
    const res = await emitAck("chat:send", { text, visibility: get().rollMode, whisperTo });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    notifyBlindRoll(res.data);
    // Um-shot (docs/plano-narracao.md): não fica "grudado" como o modo de rolagem, pra não
    // sussurrar sem querer na mensagem seguinte.
    if (whisperTo) set({ whisperTarget: null });
    return true;
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
