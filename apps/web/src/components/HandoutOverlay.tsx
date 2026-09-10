import React, { useRef, useState } from "react";
import { X, ZoomIn, ZoomOut } from "lucide-react";
import type { HandoutCard } from "@tormenta-vtt/shared";
import { assetUrl } from "../lib/api";

interface HandoutOverlayProps {
  card: HandoutCard;
  /** Só quando a mensagem veio de `handout:show` E quem está vendo é o GM (§9.10: "Fechar para todos"). */
  onCloseForAll?: () => void;
  onClose: () => void;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

/**
 * Overlay em tela cheia de um handout (§9.10): imagem com zoom (scroll/botões) e arrastar, ou
 * texto com rolagem simples (sem parser de markdown — texto puro, `white-space: pre-wrap`; ver
 * limitação conhecida no SPEC §8). Fecha com o X, clique fora da imagem/texto, ou Esc; qualquer um
 * pode fechar o PRÓPRIO overlay (`onClose`, local). GM também vê "Fechar para todos"
 * (`onCloseForAll`), só quando esta exibição veio de uma mensagem de chat (`handout:show`).
 */
export const HandoutOverlay: React.FC<HandoutOverlayProps> = ({ card, onCloseForAll, onClose }) => {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = 1.15;
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, e.deltaY < 0 ? s * factor : s / factor)));
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const d = dragRef.current;
    setPos({ x: d.origX + (e.clientX - d.startX), y: d.origY + (e.clientY - d.startY) });
  };
  const handlePointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div
      id="handout-overlay"
      className="fixed inset-0 z-[100] bg-black/90 flex flex-col"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex items-center justify-between px-4 py-2.5 shrink-0">
        <p className="text-sm font-serif font-bold text-[#d4af37] truncate">{card.name}</p>
        <div className="flex items-center gap-2">
          {card.kind === "image" && (
            <>
              <button
                onClick={() => setScale((s) => Math.max(MIN_SCALE, s / 1.3))}
                title="Diminuir zoom"
                className="p-1.5 rounded bg-[#1f1f1f] hover:bg-[#2d2417] border border-[#3d3d3d] text-zinc-300 hover:text-[#d4af37] cursor-pointer"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                onClick={() => setScale((s) => Math.min(MAX_SCALE, s * 1.3))}
                title="Aumentar zoom"
                className="p-1.5 rounded bg-[#1f1f1f] hover:bg-[#2d2417] border border-[#3d3d3d] text-zinc-300 hover:text-[#d4af37] cursor-pointer"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </>
          )}
          {onCloseForAll && (
            <button
              id="btn-handout-close-all"
              onClick={onCloseForAll}
              className="px-2.5 py-1.5 rounded bg-[#1f1f1f] hover:bg-red-950 border border-[#3d3d3d] hover:border-red-500 text-zinc-300 hover:text-red-400 text-xs font-serif font-bold cursor-pointer"
            >
              Fechar para todos
            </button>
          )}
          <button
            id="btn-handout-close"
            onClick={onClose}
            title="Fechar (Esc)"
            className="p-1.5 rounded bg-[#1f1f1f] hover:bg-[#2d2417] border border-[#3d3d3d] text-zinc-300 hover:text-[#d4af37] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {card.kind === "image" ? (
        <div
          className="flex-1 min-h-0 overflow-hidden flex items-center justify-center cursor-grab active:cursor-grabbing"
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          <img
            src={assetUrl(card.imageUrl) ?? undefined}
            alt={card.name}
            draggable={false}
            className="max-w-none select-none"
            style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})`, transition: dragRef.current ? "none" : "transform 60ms linear" }}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4" onClick={(e) => e.stopPropagation()}>
          <p className="max-w-2xl mx-auto whitespace-pre-wrap text-sm leading-relaxed text-zinc-100 font-serif">{card.text}</p>
        </div>
      )}
    </div>
  );
};
