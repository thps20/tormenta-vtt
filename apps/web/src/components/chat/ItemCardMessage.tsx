import React from "react";
import { Dices, Sparkles } from "lucide-react";
import type { ChatMessage, ItemCard } from "@tormenta-vtt/shared";

interface ItemCardMessageProps {
  msg: ChatMessage;
  card: ItemCard;
  isGm: boolean;
  isMe: boolean;
  time: string;
  /** GM ou dono da ficha (e a ficha ainda existe): botões de ação ativos. */
  canAct: boolean;
  onRoll: (actionId: string) => void;
}

/**
 * Card de item usado (character:use-item). Tudo que aparece já veio pronto do
 * servidor com os rótulos do sistema (ItemCard é denormalizado); os botões só
 * disparam character:roll { type: "action" } pela ficha de origem.
 */
export const ItemCardMessage: React.FC<ItemCardMessageProps> = ({ msg, card, isGm, isMe, time, canAct, onRoll }) => {
  const meta: { label: string; value: string }[] = [];
  if (card.execution) meta.push({ label: "Execução", value: card.execution });
  if (card.range) meta.push({ label: "Alcance", value: card.range });
  if (card.duration) meta.push({ label: "Duração", value: card.duration });
  if (card.target) meta.push({ label: "Alvo", value: card.target });
  if (card.area) meta.push({ label: "Área", value: card.area });
  const enhancements = card.enhancements ?? [];

  return (
    <div id={`chat-msg-${msg.id}`} className="p-3 rounded border bg-[#101418]/80 border-sky-900/50 shadow-inner">
      {/* Cabeçalho: quem usou */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`text-[11px] font-bold uppercase tracking-tight truncate ${isGm ? "text-[#d4af37] font-serif" : isMe ? "text-blue-400" : "text-zinc-300"}`}>
            {msg.nickname}
          </span>
          {isGm && <span className="text-[9px] px-1.5 rounded bg-[#2d2417] text-[#d4af37] border border-[#d4af37]/40 font-serif font-bold">GM</span>}
          <span className="text-[10px] text-zinc-500 font-serif truncate">• {card.characterName}</span>
        </div>
        <span className="text-[9px] font-mono text-zinc-600 shrink-0">{time}</span>
      </div>

      {/* Nome + tipo + custo */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-sky-300 shrink-0" />
            <span className="text-sm font-serif font-bold text-sky-100 truncate">{card.itemName}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-1 text-[10px] font-serif">
            <span className="bg-[#1a2028] border border-sky-900/60 px-1.5 py-0.5 rounded text-sky-200">{card.kindLabel}</span>
            {card.fields.map((f) => (
              <span key={f.label} className="bg-[#1f1d19] border border-[#332b20] px-1.5 py-0.5 rounded text-zinc-300">
                <span className="text-zinc-500">{f.label}:</span> {f.value}
              </span>
            ))}
          </div>
        </div>
        {card.cost && (
          <div className="shrink-0 flex flex-col items-center px-2 py-1 rounded border border-sky-700/60 bg-sky-950/40" title="Custo já descontado da ficha">
            <span className="text-base font-serif font-bold text-sky-200 leading-none">{card.cost.amount}</span>
            <span className="text-[9px] font-mono text-sky-400 uppercase">{card.cost.abbr}</span>
          </div>
        )}
      </div>

      {/* Execução, alcance, duração, alvo, área */}
      {meta.length > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] font-mono text-zinc-400">
          {meta.map((m) => (
            <div key={m.label} className="truncate" title={`${m.label}: ${m.value}`}>
              <span className="text-zinc-600">{m.label}:</span> {m.value}
            </div>
          ))}
        </div>
      )}

      {/* Aprimoramentos usados (cards antigos no banco não têm o campo). */}
      {enhancements.length > 0 && (
        <div className="mt-2 flex items-center gap-1.5 flex-wrap text-[10px] font-serif" data-card-enhancements>
          <span className="text-zinc-500 uppercase tracking-wider text-[9px]">Aprimoramentos</span>
          {enhancements.map((e) => (
            <span key={e.id} className="bg-sky-950/40 border border-sky-800/60 px-1.5 py-0.5 rounded text-sky-100" title={e.label}>
              <span className="font-mono font-bold text-sky-300">
                +{e.cost}
                {e.times > 1 ? ` ×${e.times}` : ""}
              </span>{" "}
              {e.label || e.id}
            </span>
          ))}
        </div>
      )}

      {card.effect && <div className="mt-2 text-xs text-zinc-200 font-serif leading-relaxed whitespace-pre-wrap break-words">{card.effect}</div>}

      {/* CD de resistência */}
      {card.save && (
        <div className="mt-2 flex items-center gap-2 text-[11px] font-mono">
          <span className="px-1.5 py-0.5 rounded bg-[#2d2417] border border-[#d4af37]/40 text-[#d4af37] font-bold">
            {card.save.dc !== null ? `CD ${card.save.dc}` : "CD —"}
          </span>
          <span className="text-zinc-300">{card.save.skillLabel}</span>
          {card.save.text && <span className="text-zinc-500 font-serif truncate">({card.save.text})</span>}
        </div>
      )}

      {/* Botões de ação: rolam pela ficha de origem */}
      {card.actions.length > 0 && (
        <div className="mt-2.5 pt-2 border-t border-sky-900/40 flex items-center gap-2 flex-wrap">
          {card.actions.map((a) => (
            <button
              key={a.id}
              onClick={() => onRoll(a.id)}
              disabled={!canAct}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#221c14] hover:bg-[#33281b] border border-[#d4af37]/50 hover:border-[#d4af37] text-amber-100 text-xs font-serif font-semibold transition-all active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              title={canAct ? `Rolar ${a.label}${a.formula ? `: ${a.formula}` : ""}${a.breakdown ? ` (${a.breakdown})` : ""}` : "Só o GM ou o dono da ficha pode rolar"}
            >
              <Dices className="w-3.5 h-3.5 text-[#d4af37]" />
              <span>{a.label}</span>
              {a.formula && <span className="font-mono font-bold text-amber-300 ml-0.5">({a.formula})</span>}
            </button>
          ))}
          {/* Decomposição do dano com os aprimoramentos (só quando algum efeito mudou a fórmula). */}
          {card.actions.some((a) => a.breakdown) && (
            <div className="w-full text-[10px] font-mono text-zinc-500" data-card-breakdown>
              {card.actions.filter((a) => a.breakdown).map((a) => (
                <div key={a.id}>
                  <span className="text-zinc-600">{a.label}:</span> {a.breakdown}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
