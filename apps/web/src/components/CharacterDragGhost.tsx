import React from "react";
import { resolveTokenDefaults } from "@tormenta-vtt/shared";
import { useCharacters } from "../store/characters";

/**
 * "Fantasma" que segue o cursor ao arrastar uma linha da aba Fichas pro mapa (SPEC §9.30) — mesmo
 * papel de `HandoutDragGhost`, mostrando a APARÊNCIA que a ficha vai ter no mapa (miniatura na cor
 * e imagem de `tokenDefaults`), pra ficar claro que o que vai cair ali é o token dela.
 */
export const CharacterDragGhost: React.FC = () => {
  const drag = useCharacters((s) => s.drag);
  const character = useCharacters((s) => (s.drag ? s.byId[s.drag.characterId] : undefined));
  if (!drag || !character) return null;
  const appearance = resolveTokenDefaults(character.tokenDefaults);
  const overTarget = drag.targetId !== null;
  return (
    <div
      id="character-drag-ghost"
      className={`fixed z-[110] pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-[#1a1712]/95 shadow-[0_8px_24px_rgba(0,0,0,0.7)] text-xs font-serif transition-colors ${
        overTarget ? "border-[#d4af37] text-amber-100" : "border-zinc-600 text-zinc-300"
      }`}
      style={{ left: drag.point.x + 14, top: drag.point.y + 10 }}
    >
      <span
        className="w-5 h-5 shrink-0 rounded-full bg-[#1e1e1e] overflow-hidden flex items-center justify-center text-[10px] font-bold text-zinc-200"
        style={{ boxShadow: `0 0 0 1.5px ${appearance.color}` }}
      >
        {appearance.imageUrl ? (
          <img src={appearance.imageUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
        ) : (
          (character.name.charAt(0) || "?").toUpperCase()
        )}
      </span>
      <span className="font-bold">{character.name}</span>
      {overTarget && <span className="text-[10px] text-[#d4af37]">colocar aqui</span>}
    </div>
  );
};
