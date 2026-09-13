import React, { useEffect, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { HandoutGallery, type HandoutGalleryProps } from "./HandoutGallery";
import { isTyping } from "../lib/isTyping";

interface HandoutSelectorProps {
  /** Repassadas direto pro `HandoutGallery`, exceto `isOpen`/`onClose` (este componente decide). */
  gallery: Omit<HandoutGalleryProps, "isOpen" | "onClose">;
  /** Dispara `handout:list` sob demanda, ao abrir (RoomPage decide — só a store conhece o evento). */
  onOpen: () => void;
}

/**
 * Botão de Handouts da TopBar (só GM, docs/SPEC.md §9.10), ao lado do `MapSelector`: abre a
 * biblioteca da sala (`HandoutGallery`) num diálogo padrão do projeto. Clique ou a tecla **J**
 * (fora de campo de texto — H já é "Mover mapa", §3.2) abrem/fecham; Esc e clique fora fecham —
 * o `Dialog` de dentro da galeria já cuida disso (diferente do dropdown antigo, este componente
 * não precisa mais de listener próprio pra isso).
 */
export const HandoutSelector: React.FC<HandoutSelectorProps> = ({ gallery, onOpen }) => {
  const [open, setOpen] = useState(false);

  const openGallery = () => {
    onOpen();
    setOpen(true);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() === "j") {
        e.preventDefault();
        if (open) setOpen(false);
        else openGallery();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <>
      <button
        id="btn-handout-selector"
        onClick={() => (open ? setOpen(false) : openGallery())}
        title="Handouts da sala (J)"
        className="flex items-center gap-1.5 px-2 py-1 rounded border border-transparent text-xs font-serif text-zinc-300 hover:text-[#d4af37] transition-colors cursor-pointer"
      >
        <ImageIcon className="w-3.5 h-3.5 shrink-0 text-[#d4af37]" />
        <span>Handouts</span>
      </button>

      <HandoutGallery isOpen={open} onClose={() => setOpen(false)} {...gallery} />
    </>
  );
};
