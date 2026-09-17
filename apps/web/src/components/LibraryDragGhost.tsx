import React from "react";
import { Image as ImageIcon, Music, Scroll, Swords, Users, Zap } from "lucide-react";
import type { LibraryItem } from "@tormenta-vtt/shared";
import { useLibrary } from "../store/library";

/** Ícone por tipo de item do acervo (docs/plano-preparo.md §1.5) — mesma ideia de `HandoutDragGhost`. */
function iconOf(item: LibraryItem) {
  if (item.kind === "asset") return item.assetKind === "audio" ? Music : ImageIcon;
  if (item.kind === "handout") return item.handout.kind === "image" ? ImageIcon : Scroll;
  if (item.kind === "encounter") return Swords;
  if (item.kind === "creature") return Users;
  return Zap; // macro (não é arrastável, mas cobre o tipo exaustivamente)
}

/** "Fantasma" que segue o cursor ao arrastar um card do `LibraryDialog` pro mapa (§1.5) — mesmo
 *  papel de `HandoutDragGhost`, generalizado pro `LibraryItem` combinado. */
export const LibraryDragGhost: React.FC = () => {
  const drag = useLibrary((s) => s.drag);
  if (!drag) return null;
  const Icon = iconOf(drag.item);
  const overTarget = drag.targetId !== null;
  return (
    <div
      id="library-drag-ghost"
      className={`fixed z-[110] pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-[#1a1712]/95 shadow-[0_8px_24px_rgba(0,0,0,0.7)] text-xs font-serif transition-colors ${
        overTarget ? "border-[#d4af37] text-amber-100" : "border-zinc-600 text-zinc-300"
      }`}
      style={{ left: drag.point.x + 14, top: drag.point.y + 10 }}
    >
      <Icon className={`w-3.5 h-3.5 ${overTarget ? "text-[#d4af37]" : "text-zinc-500"}`} />
      <span className="font-bold">{drag.item.name}</span>
      {overTarget && <span className="text-[10px] text-[#d4af37]">soltar aqui</span>}
    </div>
  );
};
