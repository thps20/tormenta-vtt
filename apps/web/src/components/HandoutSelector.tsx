import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, Image as ImageIcon } from "lucide-react";
import { HandoutsPanel, type HandoutsPanelProps } from "./HandoutsPanel";
import { isTyping } from "../lib/isTyping";

interface HandoutSelectorProps {
  /** Repassadas direto pro HandoutsPanel dentro do dropdown. */
  handouts: HandoutsPanelProps;
  /** Dispara `handout:list` sob demanda, ao abrir (RoomPage decide — só a store conhece o evento). */
  onOpen: () => void;
}

/**
 * Botão-seletor de Handouts da TopBar (só GM, docs/SPEC.md §9.10), ao lado do `MapSelector`: abre
 * um dropdown com a biblioteca da sala (`HandoutsPanel`) — mesmo padrão visual e de interação do
 * seletor de mapas. Clique ou a tecla **J** (fora de campo de texto — H já é "Mover mapa", §3.2)
 * abrem/fecham; Esc ou clique fora fecham.
 */
export const HandoutSelector: React.FC<HandoutSelectorProps> = ({ handouts, onOpen }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const openDropdown = () => {
    onOpen();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() === "j") {
        e.preventDefault();
        if (open) setOpen(false);
        else openDropdown();
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        id="btn-handout-selector"
        onClick={() => (open ? setOpen(false) : openDropdown())}
        title="Handouts da sala (J)"
        className="flex items-center gap-1.5 px-2 py-1 rounded border border-transparent text-xs font-serif text-zinc-300 hover:text-[#d4af37] transition-colors cursor-pointer"
      >
        <ImageIcon className="w-3.5 h-3.5 shrink-0 text-[#d4af37]" />
        <span>Handouts</span>
        <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          id="handout-selector-dropdown"
          className="absolute left-0 top-full mt-1 w-[340px] max-h-[70vh] flex flex-col rounded bg-[#181614] border border-[#2d2417] shadow-2xl z-50 overflow-hidden"
        >
          <HandoutsPanel {...handouts} />
        </div>
      )}
    </div>
  );
};
