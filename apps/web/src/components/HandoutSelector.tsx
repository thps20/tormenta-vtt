import React, { useEffect, useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { HandoutShowTarget } from "@tormenta-vtt/shared";
import { HandoutGallery, type HandoutGalleryProps } from "./HandoutGallery";
import { useHandouts } from "../store/handouts";
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
 *
 * **Mostrar fecha a galeria sozinha**: ao "Mostrar para todos"/"Mostrar para...", a galeria fecha
 * na hora (`handleShow`) pra o overlay do handout (`store/handouts.ts#open`, aberto pro GM pelo
 * broadcast ao vivo — ele também recebe a própria mensagem) ficar visível sozinho, sem o diálogo
 * por cima. Reabre sozinha quando esse overlay fecha de novo (`Fechar para todos` ou o fechar
 * local do próprio GM) — o `HandoutGallery` continua montado o tempo todo (só `isOpen=false`
 * some da tela), então busca/filtro/seleção de antes continuam lá quando reabre.
 */
export const HandoutSelector: React.FC<HandoutSelectorProps> = ({ gallery, onOpen }) => {
  const [open, setOpen] = useState(false);
  const overlayOpen = useHandouts((s) => s.open !== null);
  /** true entre "fechei a galeria pra mostrar" e "o overlay fechou de novo" — só aí reabre sozinha. */
  const reopenAfterOverlay = useRef(false);

  useEffect(() => {
    if (!overlayOpen && reopenAfterOverlay.current) {
      reopenAfterOverlay.current = false;
      setOpen(true);
    }
  }, [overlayOpen]);

  const openGallery = () => {
    onOpen();
    setOpen(true);
  };

  const handleShow = (id: string, target: HandoutShowTarget) => {
    reopenAfterOverlay.current = true;
    setOpen(false);
    gallery.onShow(id, target);
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

      <HandoutGallery isOpen={open} onClose={() => setOpen(false)} {...gallery} onShow={handleShow} />
    </>
  );
};
