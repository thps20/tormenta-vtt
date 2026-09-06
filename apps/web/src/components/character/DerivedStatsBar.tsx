import React, { useState } from "react";
import { Dices, Info, Target } from "lucide-react";
import {
  FormulaError,
  makeResolver,
  substitutePlaceholders,
  type Character,
  type CharacterPatch,
  type CharacterRollRequest,
  type ComputedCharacter,
  type SystemDefinition,
} from "@tormenta-vtt/shared";
import { NumInput, Select, ghostBtn } from "./fields";

interface DerivedStatsBarProps {
  def: SystemDefinition;
  character: Character;
  computed: ComputedCharacter;
  canEdit: boolean;
  isEditMode: boolean;
  onPatch: (patch: CharacterPatch) => void;
  onRoll: (request: CharacterRollRequest) => void;
}

/** Fórmula com os placeholders trocados pelos valores da ficha (só para exibir no tooltip). */
function resolvedFormula(formula: string, computed: ComputedCharacter): string {
  try {
    return substitutePlaceholders(formula, makeResolver(computed));
  } catch (err) {
    if (err instanceof FormulaError) return "?";
    throw err;
  }
}

/**
 * Stats derivados (Defesa, CD, carga...) com tooltip da fórmula, mais os campos
 * que alimentam as fórmulas (tamanho, atributo de conjuração) e as rolagens
 * nomeadas do sistema (iniciativa, extraRolls[]).
 */
export const DerivedStatsBar: React.FC<DerivedStatsBarProps> = ({ def, character, computed, canEdit, isEditMode, onPatch, onRoll }) => {
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const canRoll = canEdit && !isEditMode;
  const sizeLabel = def.sizes.find((s) => s.key === character.size)?.label ?? "—";
  const spellLabel = def.attributes.find((a) => a.key === character.spellcastingAttribute)?.abbr ?? "—";

  return (
    <div className="p-3 bg-[#111111] border-b border-[#2d2417]">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs uppercase font-serif font-bold tracking-widest text-[#d4af37]">Estatísticas derivadas</h3>
        <span className="text-[10px] text-zinc-500 font-serif">Passe o mouse para ver a fórmula</span>
      </div>

      {def.derived.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {def.derived.map((d) => {
            const override = d.editable ? character.derivedOverrides[d.key] : undefined;
            const isOverridden = override !== undefined;
            const value = computed.derived[d.key] ?? 0;

            return (
              <div
                key={d.key}
                id={`derived-${d.key}`}
                onMouseEnter={() => setActiveTooltip(d.key)}
                onMouseLeave={() => setActiveTooltip(null)}
                className={`relative bg-[#171614] border ${isOverridden ? "border-amber-600/70" : "border-[#2d261c]"} hover:border-[#d4af37] rounded p-2 flex items-center justify-between transition-colors shadow-sm`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <Target className="w-3.5 h-3.5 text-[#d4af37] shrink-0" />
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] font-serif font-semibold text-zinc-300 truncate">{d.label}</span>
                    {d.abbr && <span className="text-[9px] text-zinc-500 font-mono">{d.abbr}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0 ml-1">
                  {isEditMode && d.editable ? (
                    <NumInput
                      value={override ?? null}
                      allowEmpty
                      placeholder={String(value)}
                      onCommit={(v) => {
                        const next = { ...character.derivedOverrides };
                        if (v === null) delete next[d.key];
                        else next[d.key] = v;
                        onPatch({ derivedOverrides: next });
                      }}
                      className="text-amber-200"
                      title="Forçar um valor (vazio = calcular pela fórmula)"
                    />
                  ) : (
                    <span className={`text-base font-serif font-bold ${isOverridden ? "text-amber-400" : "text-zinc-100"}`}>{value}</span>
                  )}
                  <Info className="w-3 h-3 text-zinc-500 hover:text-[#d4af37] cursor-help" />
                </div>

                {activeTooltip === d.key && (
                  <div className="absolute z-30 top-full left-1/2 -translate-x-1/2 mt-2 w-56 p-2 bg-[#1b1915] border border-[#d4af37] rounded text-zinc-200 text-xs shadow-xl pointer-events-none">
                    <div className="font-serif font-bold text-[#d4af37] border-b border-[#332a1e] pb-1 mb-1">
                      {d.label} {d.abbr ? `(${d.abbr})` : ""}
                    </div>
                    <div className="text-[10px] font-mono text-zinc-400 space-y-0.5">
                      <div>
                        <span className="text-zinc-500">Fórmula:</span> {d.formula}
                      </div>
                      <div>
                        <span className="text-zinc-500">Resolução:</span> <span className="text-amber-200">{isOverridden ? `forçado: ${override}` : resolvedFormula(d.formula, computed)}</span>
                      </div>
                      <div className="font-bold text-zinc-100 pt-0.5 border-t border-[#332a1e] mt-1 flex justify-between">
                        <span>Resultado:</span>
                        <span className="text-[#d4af37]">{value}</span>
                      </div>
                    </div>
                    {isOverridden && <div className="mt-1 text-[9px] text-amber-400 italic">* valor sobrescrito à mão na ficha.</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Entradas das fórmulas + rolagens nomeadas */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        {def.sizes.length > 0 && (
          <label className="flex items-center gap-1 text-zinc-400">
            Tamanho
            {isEditMode ? (
              <Select value={character.size ?? ""} onChange={(v) => onPatch({ size: v || null })} options={def.sizes.map((s) => ({ value: s.key, label: s.label }))} />
            ) : (
              <span className="text-zinc-200 font-serif">{sizeLabel}</span>
            )}
          </label>
        )}
        <label className="flex items-center gap-1 text-zinc-400" title="Atributo que entra em {spellcastingAttr} (ex.: CD de magias)">
          Conjuração
          {isEditMode ? (
            <Select
              value={character.spellcastingAttribute ?? ""}
              onChange={(v) => onPatch({ spellcastingAttribute: v || null })}
              options={[{ value: "", label: "—" }, ...def.attributes.map((a) => ({ value: a.key, label: a.abbr }))]}
            />
          ) : (
            <span className="text-zinc-200 font-serif">{spellLabel}</span>
          )}
        </label>
        {!isEditMode && (
          <div className="flex flex-wrap items-center gap-1.5 ml-auto">
            <button onClick={() => onRoll({ type: "initiative" })} disabled={!canRoll} className={ghostBtn} title={def.rolls.initiative}>
              <Dices className="w-3 h-3" /> Iniciativa
            </button>
            {def.extraRolls.map((r) => (
              <button key={r.key} onClick={() => onRoll({ type: "extra", key: r.key })} disabled={!canRoll} className={ghostBtn} title={r.formula}>
                <Dices className="w-3 h-3" /> {r.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
