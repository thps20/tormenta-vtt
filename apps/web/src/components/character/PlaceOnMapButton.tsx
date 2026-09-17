import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Crosshair, MapPin } from "lucide-react";
import type { PlaceOnMapController } from "../../lib/placeOnMap";

const MENU_WIDTH = 168;

interface Props {
  characterId: string;
  placeOnMap: PlaceOnMapController;
  /** Linha da lista de fichas: só o ícone, sem rótulo. */
  compact?: boolean;
  className?: string;
}

/**
 * "Colocar no mapa" (SPEC §9.30) — ou "Ir para o token", quando esta ficha JÁ tem token no mapa
 * visto: o caso comum é querer achar o personagem, não duplicá-lo. Duplicar continua possível, mas
 * só pelo item de menu "Colocar outro" (a setinha ao lado), pra ninguém encher a mesa de cópias
 * clicando duas vezes sem querer.
 *
 * O menu vai num portal com `position: fixed` (mesmo motivo do menu da visão de grupo): a lista de
 * fichas rola, e um menu `absolute` seria cortado por ela.
 */
export const PlaceOnMapButton: React.FC<Props> = ({ characterId, placeOnMap, compact, className }) => {
  const token = placeOnMap.tokenOf(characterId);
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menuOpen) {
      setPos(null);
      return;
    }
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ left: Math.min(Math.max(rect.right - MENU_WIDTH, 4), window.innerWidth - MENU_WIDTH - 4), top: rect.bottom + 4 });
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    const onPointerDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", close, true);
    };
  }, [menuOpen]);

  const label = token ? "Ir para o token" : "Colocar no mapa";
  const Icon = token ? Crosshair : MapPin;
  const base =
    "focus-ring flex items-center gap-1 rounded border border-[#3d3d3d] text-[10px] text-zinc-300 hover:border-[#d4af37] hover:text-[#d4af37] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className={`flex items-center ${className ?? ""}`} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        id={`btn-place-on-map-${characterId}`}
        disabled={!placeOnMap.enabled}
        title={placeOnMap.enabled ? label : "Nenhum mapa aberto"}
        aria-label={label}
        onClick={() => (token ? placeOnMap.goTo(token.id) : placeOnMap.place(characterId))}
        className={`${base} px-1.5 py-0.5 ${token ? "rounded-r-none border-r-0" : ""}`}
      >
        <Icon className="w-3 h-3 shrink-0" />
        {!compact && <span className="truncate">{label}</span>}
      </button>
      {token && (
        <button
          type="button"
          ref={btnRef}
          disabled={!placeOnMap.enabled}
          title="Mais opções"
          aria-label="Mais opções de colocar no mapa"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
          className={`${base} px-0.5 py-0.5 rounded-l-none`}
        >
          <ChevronDown className="w-3 h-3" />
        </button>
      )}
      {menuOpen &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", left: pos?.left ?? -9999, top: pos?.top ?? -9999, width: MENU_WIDTH, visibility: pos ? "visible" : "hidden" }}
            className="z-[60] bg-[#1a1a1a] border border-[#2d2417] rounded shadow-2xl p-1"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                placeOnMap.place(characterId);
              }}
              className="focus-ring w-full text-left px-2 py-1.5 rounded text-[11px] text-zinc-200 hover:bg-[#262626] cursor-pointer flex items-center gap-2"
            >
              <MapPin className="w-3 h-3 shrink-0 text-zinc-500" />
              Colocar outro
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
};
