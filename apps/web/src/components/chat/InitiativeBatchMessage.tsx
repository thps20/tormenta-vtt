import React from "react";
import { Eye, Swords } from "lucide-react";
import type { ChatMessage } from "@tormenta-vtt/shared";
import { rollModeInfo } from "../../lib/rollMode";

interface InitiativeBatchMessageProps {
  msg: ChatMessage;
  time: string;
  /** GM vê o botão Revelar (mesma regra dos outros cards de rolagem). */
  isGm: boolean;
  onReveal: (messageId: string) => void;
}

/**
 * Card de iniciativa em lote (combat:roll rolando mais de um combatente de uma vez,
 * ChatMessage{kind:"initiative-batch"}): cabeçalho com a rodada e uma linha por combatente.
 * O servidor já manda só as linhas que este viewer pode ver (token oculto = linha ausente,
 * não substituída), e omite fórmula/resultado de quem `visibility` não permite (mostra "rolou").
 */
export const InitiativeBatchMessage: React.FC<InitiativeBatchMessageProps> = ({ msg, time, isGm, onReveal }) => {
  const batch = msg.initiativeBatch;
  if (!batch) return null;

  return (
    <div id={`chat-msg-${msg.id}`} className="p-3 rounded border border-zinc-800/60 bg-black/35 shadow-inner">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Swords className="w-3.5 h-3.5 text-[#d4af37]" />
          <span className="text-[11px] font-serif font-bold uppercase tracking-tight text-[#d4af37]">
            Iniciativa (rodada {batch.round})
          </span>
        </div>
        <span className="text-[9px] font-mono text-zinc-600">{time}</span>
      </div>

      <div data-batch-entries>
        {batch.entries.map((e) => (
          <div
            key={e.combatantId}
            data-combatant-id={e.combatantId}
            className="flex items-center justify-between gap-2 py-1 border-b border-zinc-800/40 last:border-0"
          >
            <span className="text-xs text-zinc-200 font-serif truncate">{e.name}</span>
            {e.result !== undefined ? (
              <span className="flex items-baseline gap-2">
                {e.formula && <span className="text-[10px] font-mono text-zinc-500">{e.formula}</span>}
                <span className="text-sm font-serif font-bold text-[#d4af37]">{e.result}</span>
              </span>
            ) : (
              <span className="text-[10px] text-zinc-500 italic">rolou</span>
            )}
          </div>
        ))}
      </div>

      {msg.visibility !== "all" &&
        (() => {
          const vis = rollModeInfo(msg.visibility);
          const VisIcon = vis.icon;
          return (
            <div
              className="mt-2 pt-1.5 border-t border-zinc-800/60 flex items-center justify-between gap-2 text-[10px] font-mono"
              data-visibility={msg.visibility}
            >
              <span className="flex items-center gap-1 text-[#d4af37]/80">
                <VisIcon className="w-3 h-3" />
                <span>{msg.visibility === "gm" ? "Rolagem secreta: só o GM vê os valores" : "Rolagem própria: só você vê os valores"}</span>
              </span>
              {isGm && (
                <button
                  type="button"
                  id={`reveal-${msg.id}`}
                  onClick={() => onReveal(msg.id)}
                  title="Tornar pública para todos"
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-[#d4af37]/40 text-[#d4af37] hover:bg-[#2d2417] transition-colors cursor-pointer"
                >
                  <Eye className="w-3 h-3" />
                  Revelar
                </button>
              )}
            </div>
          );
        })()}
    </div>
  );
};
