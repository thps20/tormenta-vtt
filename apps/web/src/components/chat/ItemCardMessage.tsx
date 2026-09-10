import React from "react";
import { Dices, Shapes, Sparkles } from "lucide-react";
import { formatArea, type ChatMessage, type ItemCard, type SystemDefinition } from "@tormenta-vtt/shared";
import { useTools } from "../../store/tools";
import { DamageFormula } from "../DamageTypeBadge";

interface ItemCardMessageProps {
  /** Sistema da sala, para pintar os selos de tipo de dano (null = selos neutros). */
  def: SystemDefinition | null;
  msg: ChatMessage;
  card: ItemCard;
  isGm: boolean;
  isMe: boolean;
  time: string;
  /** GM ou dono da ficha (e a ficha ainda existe): botões de ação ativos. */
  canAct: boolean;
  onRoll: (actionId: string) => void;
}

/** Marca de campo alterado por aprimoramento nesta conjuração. */
const Enhanced: React.FC = () => <span className="ml-1 text-[9px] text-emerald-400/80 font-serif italic">(aprimorado)</span>;

/**
 * Card de item usado (character:use-item). Tudo que aparece já veio pronto do
 * servidor com os rótulos do sistema (ItemCard é denormalizado); os botões só
 * disparam character:roll { type: "action" } pela ficha de origem.
 */
export const ItemCardMessage: React.FC<ItemCardMessageProps> = ({ def, msg, card, isGm, isMe, time, canAct, onRoll }) => {
  // `enhanced` diz quais campos um aprimoramento mudou nesta conjuração (cards antigos não têm).
  const enhanced = new Set(card.enhanced ?? []);
  const meta: { label: string; value: string; enhanced: boolean }[] = [];
  if (card.execution) meta.push({ label: "Execução", value: card.execution, enhanced: false });
  if (card.range) meta.push({ label: "Alcance", value: card.range, enhanced: enhanced.has("range") });
  if (card.duration) meta.push({ label: "Duração", value: card.duration, enhanced: enhanced.has("duration") });
  if (card.target) meta.push({ label: "Alvo", value: card.target, enhanced: enhanced.has("target") });
  const areaText = formatArea(def ?? { templates: undefined, grid: undefined }, card.area);
  if (areaText) meta.push({ label: "Área", value: areaText, enhanced: enhanced.has("area") });
  const enhancements = card.enhancements ?? [];
  const notes = enhancements.filter((e) => e.note);

  // "Colocar área" (docs/plano-gabaritos.md §6): só existe se a sala tem a ferramenta (def.templates)
  // e a área do card é uma FORMA reconhecida (não texto livre) — a única fonte é o campo
  // estruturado, sem reparsear texto.
  const showAreaButton = canAct && card.area?.kind === "shape" && !!def?.templates;
  const placeArea = () => {
    if (card.area?.kind === "shape") useTools.getState().pickTemplatePreset({ shape: card.area.shape, size: card.area.size });
    useTools.getState().setMode("template");
  };

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
            <div key={m.label} className="truncate" title={`${m.label}: ${m.value}${m.enhanced ? " (aprimorado)" : ""}`}>
              <span className="text-zinc-600">{m.label}:</span> {m.value}
              {m.enhanced && <Enhanced />}
            </div>
          ))}
        </div>
      )}

      {showAreaButton && (
        <button
          type="button"
          onClick={placeArea}
          className="mt-1.5 flex items-center gap-1 text-[10px] font-serif font-bold uppercase tracking-wider text-[#d4af37] hover:text-[#e8c766] cursor-pointer"
          title="Abre a ferramenta Área (T) já com a forma e o tamanho, quando o texto casar"
        >
          <Shapes className="w-3 h-3" />
          Colocar área
        </button>
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

      {/* Efeitos descritivos dos aprimoramentos (sem automação): em destaque, para o jogador aplicar à mão. */}
      {notes.length > 0 && (
        <div className="mt-2 rounded border border-amber-800/60 bg-amber-950/30 px-2 py-1.5 text-xs text-amber-100 font-serif leading-relaxed space-y-0.5" data-card-notes>
          {notes.map((e) => (
            <div key={e.id} className="whitespace-pre-wrap break-words">
              <span className="font-bold text-amber-300">{e.label || e.id}:</span> {e.note}
            </div>
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
          {enhanced.has("dc") && <Enhanced />}
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
              {a.kind === "attack" && enhanced.has("attack") && <Enhanced />}
              {/* Dano: parcelas com o selo do tipo; cards antigos não têm `damage` e mostram só a fórmula. */}
              {a.formula && <span className="font-mono font-bold text-amber-300 ml-0.5">({(a.damage ?? []).length > 0 ? <DamageFormula def={def} components={a.damage} /> : a.formula})</span>}
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
