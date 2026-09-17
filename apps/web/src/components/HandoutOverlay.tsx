import React, { useEffect, useRef, useState } from "react";
import { X, ZoomIn, ZoomOut } from "lucide-react";
import type { DisplayHandoutViewPayload, HandoutCard } from "@tormenta-vtt/shared";
import { assetUrl } from "../lib/api";
import { getSocket } from "../store/connection";
import { useCast } from "../store/cast";
import { SMOOTH_MS } from "../lib/castCamera";

interface HandoutOverlayProps {
  card: HandoutCard;
  /** Só quando a mensagem veio de `handout:show` E quem está vendo é o GM (§9.10: "Fechar para todos"). */
  onCloseForAll?: () => void;
  onClose: () => void;
  /**
   * GM (docs/revisao-cast.md): liga o polling que manda `display:handout-view` (zoom/pan) pra tela
   * de exibição. Só passar `true` quando ESTE overlay é o mesmo aberto "para todos" nela — nunca
   * num sussurro (RoomPage decide isso a partir de `useHandouts().open.whisperTo`).
   */
  syncToDisplay?: boolean;
  /**
   * Tela de exibição (`DisplayPage`): overlay sem interação própria (a tela não tem mouse/teclado
   * por perto) — zoom/pan vêm só do `display:handout-view` mais recente (`null` = Mestre ainda não
   * mexeu neste handout, mostra centralizado). Presença desta prop (mesmo `null`) já liga o modo
   * somente-leitura; `undefined` (RoomPage) mantém o overlay interativo de sempre.
   */
  remoteView?: DisplayHandoutViewPayload | null;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

/** Mesmo throttle do enquadramento do mapa (`lib/castCamera.ts#EMIT_GM_VIEW_INTERVAL_MS`). */
const EMIT_HANDOUT_VIEW_INTERVAL_MS = 150;

/**
 * Overlay em tela cheia de um handout (§9.10): imagem com zoom (scroll/botões) e arrastar, ou
 * texto com rolagem simples (sem parser de markdown — texto puro, `white-space: pre-wrap`; ver
 * limitação conhecida no SPEC §8). Fecha com o X, clique fora da imagem/texto, ou Esc; qualquer um
 * pode fechar o PRÓPRIO overlay (`onClose`, local). GM também vê "Fechar para todos"
 * (`onCloseForAll`), só quando esta exibição veio de uma mensagem de chat (`handout:show`).
 *
 * Zoom/pan sincronizado com a tela de exibição (docs/revisao-cast.md): este mesmo componente é
 * reaproveitado tal e qual pela tela (`remoteView`, somente leitura) — as duas pontas convertem
 * entre `pos`/`scale` (pixels de tela, dependem do tamanho da janela) e `x`/`y`/`zoom` (fração do
 * TAMANHO NATURAL da imagem, o único valor que as duas telas compartilham de verdade).
 */
export const HandoutOverlay: React.FC<HandoutOverlayProps> = ({ card, onCloseForAll, onClose, syncToDisplay, remoteView }) => {
  const readOnly = remoteView !== undefined;
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // GM: manda o enquadramento atual pra tela, throttled e só enquanto vale a pena (tela conectada
  // e a imagem já carregou — sem `natural` não dá pra converter pra fração). Mesmo padrão de
  // `lib/castCamera.ts#useEmitGmView` (poll com chave de dedupe, não efeito reativo por campo).
  const lastKeyRef = useRef("");
  useEffect(() => {
    if (!syncToDisplay || card.kind !== "image" || !natural) return;
    const id = setInterval(() => {
      if (useCast.getState().displayCount === 0) return;
      const x = 0.5 - pos.x / (scale * natural.w);
      const y = 0.5 - pos.y / (scale * natural.h);
      const key = `${card.handoutId}:${scale.toFixed(3)}:${x.toFixed(4)}:${y.toFixed(4)}`;
      if (key === lastKeyRef.current) return;
      lastKeyRef.current = key;
      getSocket().emit("display:handout-view", { handoutId: card.handoutId, zoom: scale, x, y }, () => undefined);
    }, EMIT_HANDOUT_VIEW_INTERVAL_MS);
    return () => clearInterval(id);
  }, [syncToDisplay, card.handoutId, card.kind, natural, pos, scale]);

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

  // Tela: reconstrói pos/scale a partir da fração recebida — inverso exato da conta que o GM faz
  // acima. Sem `remoteView` (Mestre ainda não mexeu) ou sem `natural` ainda, fica centralizado.
  const effectiveScale = readOnly && remoteView ? remoteView.zoom : scale;
  const effectivePos = readOnly && remoteView && natural ? { x: remoteView.zoom * natural.w * (0.5 - remoteView.x), y: remoteView.zoom * natural.h * (0.5 - remoteView.y) } : pos;

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
          {card.kind === "image" && !readOnly && (
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
          className={`flex-1 min-h-0 overflow-hidden flex items-center justify-center ${readOnly ? "" : "cursor-grab active:cursor-grabbing"}`}
          onWheel={readOnly ? undefined : handleWheel}
          onPointerDown={readOnly ? undefined : handlePointerDown}
          onPointerMove={readOnly ? undefined : handlePointerMove}
          onPointerUp={readOnly ? undefined : handlePointerUp}
          onPointerLeave={readOnly ? undefined : handlePointerUp}
        >
          <img
            src={assetUrl(card.imageUrl) ?? undefined}
            alt={card.name}
            draggable={false}
            onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="max-w-none select-none"
            style={{
              transform: `translate(${effectivePos.x}px, ${effectivePos.y}px) scale(${effectiveScale})`,
              transition: readOnly ? `transform ${SMOOTH_MS}ms ease-out` : dragRef.current ? "none" : "transform 60ms linear",
            }}
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
