import React, { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus, X, Zap } from "lucide-react";
import { effectiveCost, enhancementEffect, resolveEnhancements, type Character, type CharacterItem, type EnhancementUse, type SystemDefinition } from "@tormenta-vtt/shared";
import { describeEffect } from "../../lib/enhancements";
import { EffectDamageType } from "../DamageTypeBadge";

interface EnhancementPickerProps {
  def: SystemDefinition;
  character: Character;
  item: CharacterItem;
  /** Texto do botão de uso do tipo ("Conjurar", "Usar"). */
  useLabel: string;
  /** Confirma o uso com a escolha (vazia = só a base). */
  onCast: (selection: EnhancementUse[]) => void;
  onClose: () => void;
}

/**
 * Popover de escolha de aprimoramentos ao usar um item. Cada linha é um checkbox
 * (ou contador, se repetível); o custo total é recalculado ao vivo pelas mesmas
 * funções do shared que o servidor usa (fórmula do sistema + modificadores + piso),
 * então o número do botão é o que será descontado.
 */
export const EnhancementPicker: React.FC<EnhancementPickerProps> = ({ def, character, item, useLabel, onCast, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [times, setTimes] = useState<Record<string, number>>({});

  // Fecha com Esc ou clique fora.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const selection: EnhancementUse[] = useMemo(
    () => item.enhancements.filter((e) => (times[e.id] ?? 0) > 0).map((e) => ({ id: e.id, times: times[e.id] ?? 1 })),
    [item.enhancements, times],
  );
  const selected = useMemo(() => resolveEnhancements(def, item, selection), [def, item, selection]);
  const baseOnly = effectiveCost(def, character, item);
  const total = effectiveCost(def, character, item, selected);

  const costResource = def.activation.resource ? def.resources.find((r) => r.key === def.activation.resource) : undefined;
  const abbr = costResource?.abbr ?? "";
  const resource = costResource ? character.resources[costResource.key] : undefined;
  const available = (resource?.current ?? 0) + (resource?.temp ?? 0);
  const insufficient = costResource !== undefined && total > available;

  const setCount = (id: string, value: number) => setTimes((prev) => ({ ...prev, [id]: Math.max(0, value) }));

  return (
    <div
      ref={ref}
      id={`enhancement-picker-${item.id}`}
      className="absolute left-0 top-full mt-1 z-30 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-sky-800/70 bg-[#0f1418] shadow-[0_8px_30px_rgba(0,0,0,0.7)] text-xs"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-sky-900/50">
        <span className="font-serif font-bold text-sky-100 truncate">
          {useLabel} {item.name}
        </span>
        <button onClick={onClose} className="p-0.5 rounded text-zinc-500 hover:text-zinc-200 cursor-pointer" title="Fechar (Esc)">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <ul className="max-h-64 overflow-y-auto divide-y divide-[#1c2228]">
        {item.enhancements.map((e) => {
          const count = times[e.id] ?? 0;
          const active = count > 0;
          return (
            <li key={e.id} className={`flex items-start gap-2 px-3 py-1.5 ${active ? "bg-sky-950/30" : ""}`} data-enhancement-id={e.id}>
              {e.repeatable ? (
                <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
                  <button onClick={() => setCount(e.id, count - 1)} disabled={count === 0} className="p-0.5 rounded border border-zinc-700 text-zinc-300 hover:bg-[#1b2c3a] disabled:opacity-30 cursor-pointer disabled:cursor-default" title="Uma vez a menos">
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="w-5 text-center font-mono font-bold text-sky-200" data-count>
                    {count}
                  </span>
                  <button onClick={() => setCount(e.id, count + 1)} className="p-0.5 rounded border border-zinc-700 text-zinc-300 hover:bg-[#1b2c3a] cursor-pointer" title="Uma vez a mais (repetível)">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <input type="checkbox" checked={active} onChange={(ev) => setCount(e.id, ev.target.checked ? 1 : 0)} className="mt-1 shrink-0 accent-sky-500 cursor-pointer" />
              )}
              <label className="flex-1 min-w-0 cursor-pointer" onClick={() => !e.repeatable && setCount(e.id, active ? 0 : 1)} title={e.label}>
                <span className="font-mono font-bold text-sky-300 mr-1.5">
                  +{e.cost} {abbr}
                  {e.repeatable && <span className="text-zinc-500 font-normal"> ×</span>}
                </span>
                {describeEffect(def, e) && (
                  <span className="mr-1.5 px-1 rounded bg-amber-950/40 border border-amber-800/60 text-amber-300 font-mono text-[10px]" title="Efeito aplicado ao dano ao conjurar">
                    {describeEffect(def, e)}
                  </span>
                )}
                <EffectDamageType def={def} effect={enhancementEffect(e)} />{" "}
                <span className="text-zinc-300 font-serif leading-snug line-clamp-2">{e.label || e.id}</span>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="px-3 py-2 border-t border-sky-900/50 flex items-center justify-between gap-2 flex-wrap">
        <span className={`font-mono ${insufficient ? "text-red-300" : "text-zinc-400"}`} id={`enhancement-total-${item.id}`} title="Custo total com modificadores; o que será descontado">
          Total: <span className="font-bold text-sky-200">{total}</span> {abbr}
          {costResource && <span className="text-zinc-500"> · tem {available}</span>}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onCast([])}
            className="px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:bg-[#1a1a1a] font-serif cursor-pointer"
            title={`${useLabel} sem aprimoramentos (${baseOnly} ${abbr})`}
            id={`enhancement-cast-base-${item.id}`}
          >
            Só a base ({baseOnly} {abbr})
          </button>
          <button
            onClick={() => onCast(selection)}
            disabled={insufficient}
            className={`flex items-center gap-1 px-2.5 py-1 rounded border font-serif font-bold cursor-pointer disabled:cursor-not-allowed ${
              insufficient ? "bg-red-950/40 border-red-800/70 text-red-200 opacity-70" : "bg-[#14202a] hover:bg-[#1b2c3a] border-sky-700/60 hover:border-sky-400 text-sky-100"
            }`}
            title={insufficient ? `${abbr || "Recurso"} insuficiente: precisa de ${total}, tem ${available}` : `${useLabel} com os aprimoramentos escolhidos`}
            id={`enhancement-cast-${item.id}`}
          >
            <Zap className="w-3.5 h-3.5" />
            {useLabel} ({total} {abbr})
          </button>
        </div>
      </div>
    </div>
  );
};
