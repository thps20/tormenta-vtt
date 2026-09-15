import React from "react";
import { FileText, Image as ImageIcon } from "lucide-react";
import type { ChatMessage, HandoutCard } from "@tormenta-vtt/shared";
import { assetUrl } from "../../lib/api";

interface HandoutCardMessageProps {
  msg: ChatMessage;
  time: string;
  onOpen: (messageId: string, card: HandoutCard) => void;
}

/**
 * Card de handout mostrado pelo GM (`ChatMessage{kind:"handout"}`, §9.10): miniatura clicável que
 * reabre o overlay em tela cheia — o card já carrega o conteúdo denormalizado (`msg.handout`),
 * então reabrir é local, sem round-trip ao servidor. Quem recebeu ao vivo já viu o overlay abrir
 * sozinho (bindSocket.ts); este card é o que fica no histórico pra quem entrou depois (SPEC §9.10).
 */
export const HandoutCardMessage: React.FC<HandoutCardMessageProps> = ({ msg, time, onOpen }) => {
  const card = msg.handout;
  if (!card) return null;

  return (
    <button
      id={`chat-msg-${msg.id}`}
      onClick={() => onOpen(msg.id, card)}
      className="focus-ring font-ui w-full flex items-center gap-2.5 p-2 rounded-ui border border-border bg-surface-2 hover:bg-surface-2/70 transition-colors cursor-pointer text-left"
    >
      {card.kind === "image" ? (
        <img src={assetUrl(card.imageUrl) ?? undefined} alt="" className="w-10 h-10 rounded-ui object-cover border border-border shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded-ui border border-border bg-surface-1 flex items-center justify-center shrink-0">
          <FileText className="w-4 h-4 text-text-muted" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <ImageIcon className="w-3 h-3 text-text-muted shrink-0" />
          <span className="text-[10px] font-title font-bold text-text-muted uppercase tracking-wide">Handout</span>
        </div>
        <p className="text-xs text-text truncate">{card.name}</p>
      </div>
      <span className="text-[9px] font-data tabular-nums text-text-muted shrink-0">{time}</span>
    </button>
  );
};
