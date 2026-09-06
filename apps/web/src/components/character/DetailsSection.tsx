import React from "react";
import type { Character, CharacterPatch, SystemDefinition } from "@tormenta-vtt/shared";
import { NumInput, TextArea } from "./fields";

interface DetailsSectionProps {
  def: SystemDefinition;
  character: Character;
  isEditMode: boolean;
  onPatch: (patch: CharacterPatch) => void;
}

/** Moedas (currencies[] do sistema) e anotações livres. */
export const DetailsSection: React.FC<DetailsSectionProps> = ({ def, character, isEditMode, onPatch }) => {
  return (
    <div className="p-4 bg-[#0f0f0f]">
      {def.currencies.length > 0 && (
        <div className="mb-3">
          <h3 className="text-xs uppercase font-serif font-bold tracking-widest text-[#d4af37] mb-2">Moedas</h3>
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {def.currencies.map((c) => (
              <label key={c.key} className="flex items-center gap-1.5 bg-[#161513] border border-[#292319] rounded px-2 py-1 text-zinc-400" title={c.label}>
                <span className="font-serif font-bold text-amber-200">{c.abbr}</span>
                {isEditMode ? (
                  <NumInput value={character.currency[c.key] ?? 0} onCommit={(v) => onPatch({ currency: { ...character.currency, [c.key]: Math.max(0, v ?? 0) } })} className="w-16" />
                ) : (
                  <span className="font-mono text-zinc-200">{(character.currency[c.key] ?? 0).toLocaleString()}</span>
                )}
              </label>
            ))}
          </div>
        </div>
      )}
      <h3 className="text-xs uppercase font-serif font-bold tracking-widest text-[#d4af37] mb-2">Anotações</h3>
      {isEditMode ? (
        <TextArea value={character.bio} onCommit={(bio) => onPatch({ bio })} rows={4} placeholder="História, aparência, notas…" />
      ) : character.bio ? (
        <p className="text-xs text-zinc-300 font-serif whitespace-pre-wrap leading-relaxed">{character.bio}</p>
      ) : (
        <p className="text-xs text-zinc-600 italic">Sem anotações.</p>
      )}
    </div>
  );
};
