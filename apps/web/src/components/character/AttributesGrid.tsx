import React from "react";
import { Dices } from "lucide-react";
import type { Character, CharacterPatch, CharacterRollRequest, ComputedCharacter, SystemDefinition } from "@tormenta-vtt/shared";
import { signed } from "../../lib/system";
import { NumInput } from "./fields";

interface AttributesGridProps {
  def: SystemDefinition;
  character: Character;
  computed: ComputedCharacter;
  canEdit: boolean;
  isEditMode: boolean;
  onPatch: (patch: CharacterPatch) => void;
  onRoll: (request: CharacterRollRequest) => void;
}

/** Atributos em cartões: clique rola (modo visualização); no modo edição, altera o valor base. */
export const AttributesGrid: React.FC<AttributesGridProps> = ({ def, character, computed, canEdit, isEditMode, onPatch, onRoll }) => {
  const canRoll = canEdit && !isEditMode;
  const cols = Math.min(6, Math.max(3, def.attributes.length));

  return (
    <div className="p-4 bg-[#111] border-b border-[#2d2417]">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs uppercase font-serif font-bold tracking-widest text-[#d4af37]">Atributos</h3>
        <span className="text-[11px] text-zinc-500 font-serif">{isEditMode ? "Ajuste os valores base" : canEdit ? "Clique no atributo para rolar" : ""}</span>
      </div>

      <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {def.attributes.map((attr) => {
          const base = character.attributes[attr.key]?.base ?? attr.default;
          const total = computed.attributes[attr.key] ?? base;
          const modSum = total - base;

          return (
            <div
              key={attr.key}
              id={`card-attr-${attr.key}`}
              onClick={() => canRoll && onRoll({ type: "attribute", key: attr.key })}
              className={`group relative flex flex-col items-center justify-center p-2.5 rounded-lg border transition-all select-none ${
                canRoll
                  ? "bg-gradient-to-b from-[#1c1914] to-[#12110f] border-[#383020] hover:border-[#d4af37] hover:shadow-[0_0_12px_rgba(212,175,55,0.2)] cursor-pointer active:scale-95"
                  : "bg-[#181818] border-zinc-700"
              }`}
              title={canRoll ? `Rolar teste de ${attr.label} (${def.rolls.attributeCheck.replace("{attr}", String(total))})` : attr.label}
            >
              <span className="text-xs font-serif font-bold text-amber-300 tracking-wider">{attr.abbr}</span>
              <span className="text-[10px] text-zinc-400 font-serif truncate max-w-full">{attr.label}</span>

              <div className="my-1 flex items-center justify-center">
                {isEditMode ? (
                  <NumInput
                    value={base}
                    onCommit={(v) => onPatch({ attributes: { ...character.attributes, [attr.key]: { base: Math.floor(v ?? attr.default) } } })}
                    className="text-base font-serif font-bold text-[#d4af37] py-0.5"
                    title={`Valor base (${attr.min ?? "−∞"} a ${attr.max ?? "∞"})`}
                  />
                ) : (
                  <span className="text-2xl font-serif font-bold text-[#d4af37] tracking-tight group-hover:text-amber-200">{signed(total)}</span>
                )}
              </div>

              <div className="flex items-center gap-1 text-[10px] text-zinc-500 font-mono">
                {isEditMode ? (
                  <span>Total: {signed(total)}</span>
                ) : modSum !== 0 ? (
                  <span className="text-emerald-400 font-semibold" title={`Base ${base}, modificadores ${signed(modSum)}`}>
                    (Base {base} {signed(modSum)})
                  </span>
                ) : (
                  <span>Base {base}</span>
                )}
              </div>

              {canRoll && (
                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Dices className="w-3.5 h-3.5 text-[#d4af37]" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
