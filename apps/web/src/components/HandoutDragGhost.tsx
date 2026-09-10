import React from "react";
import { FileText, Image as ImageIcon } from "lucide-react";
import { useHandouts } from "../store/handouts";

/** "Fantasma" que segue o cursor ao arrastar um card da biblioteca de handouts pro mapa (§9.10) —
 *  mesmo papel de `components/compendium/DragGhost.tsx`, arrastando um `Handout` em vez de uma
 *  `CompendiumEntry`. Fora do dropdown pra não herdar nenhuma transparência/clip dele. */
export const HandoutDragGhost: React.FC = () => {
  const drag = useHandouts((s) => s.drag);
  const handout = useHandouts((s) => (s.drag ? s.library.find((h) => h.id === s.drag?.handoutId) : undefined));
  if (!drag || !handout) return null;
  const Icon = handout.kind === "image" ? ImageIcon : FileText;
  const overTarget = drag.targetId !== null;
  return (
    <div
      id="handout-drag-ghost"
      className={`fixed z-[60] pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-[#1a1712]/95 shadow-[0_8px_24px_rgba(0,0,0,0.7)] text-xs font-serif transition-colors ${
        overTarget ? "border-[#d4af37] text-amber-100" : "border-zinc-600 text-zinc-300"
      }`}
      style={{ left: drag.point.x + 14, top: drag.point.y + 10 }}
    >
      <Icon className={`w-3.5 h-3.5 ${overTarget ? "text-[#d4af37]" : "text-zinc-500"}`} />
      <span className="font-bold">{handout.name}</span>
      {overTarget && <span className="text-[10px] text-[#d4af37]">fixar aqui</span>}
    </div>
  );
};
