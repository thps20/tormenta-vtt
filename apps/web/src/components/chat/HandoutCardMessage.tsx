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
      className="w-full flex items-center gap-2.5 p-2 rounded border border-zinc-800/60 bg-black/35 shadow-inner hover:border-[#d4af37]/60 hover:bg-black/50 transition-colors cursor-pointer text-left"
    >
      {card.kind === "image" ? (
        <img src={assetUrl(card.imageUrl) ?? undefined} alt="" className="w-10 h-10 rounded object-cover border border-[#3d3d3d] shrink-0" />
      ) : (
        <div className="w-10 h-10 rounded border border-[#3d3d3d] bg-[#1f1f1f] flex items-center justify-center shrink-0">
          <FileText className="w-4 h-4 text-zinc-500" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <ImageIcon className="w-3 h-3 text-[#d4af37] shrink-0" />
          <span className="text-[10px] font-serif font-bold text-[#d4af37] uppercase tracking-wide">Handout</span>
        </div>
        <p className="text-xs text-zinc-200 font-serif truncate">{card.name}</p>
      </div>
      <span className="text-[9px] font-mono text-zinc-600 shrink-0">{time}</span>
    </button>
  );
};
