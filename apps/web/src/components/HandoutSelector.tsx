import React, { useEffect, useRef } from "react";
import { Image as ImageIcon } from "lucide-react";
import type { HandoutShowTarget } from "@tormenta-vtt/shared";
import { HandoutGallery, type HandoutGalleryProps } from "./HandoutGallery";
import { useHandouts } from "../store/handouts";
import { MOTION } from "./MapBar";

interface HandoutSelectorProps {
  /** Repassadas direto pro `HandoutGallery`, exceto `isOpen`/`onClose` (este componente decide). */
  gallery: Omit<HandoutGalleryProps, "isOpen" | "onClose">;
  /** Galeria aberta: controlada pela RoomPage, dona do atalho J (`useGmPanelShortcuts`). */
  open: boolean;
  /** `true` monta só o diálogo, sem o botão: o gatilho virou item do menu ⋯ da barra (§9.28). */
  hideTrigger?: boolean;
  /** Abrir (true) ou fechar (false). Quem abre também dispara `handout:list` sob demanda. */
  onOpenChange: (open: boolean) => void;
}

/**
 * Botão de Handouts da TopBar (só GM, docs/SPEC.md §9.10), ao lado do `MapSelector`: abre a
 * biblioteca da sala (`HandoutGallery`) num diálogo padrão do projeto. Clique ou a tecla **J**
 * (fora de campo de texto — H já é "Mover mapa", §3.2; listener da página, `useGmPanelShortcuts`)
 * abrem/fecham; Esc e clique fora fecham —
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
export const HandoutSelector: React.FC<HandoutSelectorProps> = ({ gallery, open, onOpenChange, hideTrigger }) => {
  const setOpen = onOpenChange;
  const overlayOpen = useHandouts((s) => s.open !== null);
  /** true entre "fechei a galeria pra mostrar" e "o overlay fechou de novo" — só aí reabre sozinha. */
  const reopenAfterOverlay = useRef(false);

  useEffect(() => {
    if (!overlayOpen && reopenAfterOverlay.current) {
      reopenAfterOverlay.current = false;
      setOpen(true);
    }
  }, [overlayOpen]);

  const handleShow = (id: string, target: HandoutShowTarget) => {
    reopenAfterOverlay.current = true;
    setOpen(false);
    gallery.onShow(id, target);
  };

  return (
    <>
      {!hideTrigger && (
      <button
        id="btn-handout-selector"
        onClick={() => setOpen(!open)}
        title="Handouts da sala (J)"
        className={`focus-ring flex items-center gap-1.5 h-7 px-2 rounded-ui text-13 text-text hover:bg-surface-2 cursor-pointer ${MOTION}`}
      >
        <ImageIcon className="w-3.5 h-3.5 shrink-0 text-text-muted" />
        <span>Handouts</span>
      </button>
      )}

      <HandoutGallery isOpen={open} onClose={() => setOpen(false)} {...gallery} onShow={handleShow} />
    </>
  );
};
