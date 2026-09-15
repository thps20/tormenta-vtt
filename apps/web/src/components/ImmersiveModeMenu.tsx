import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronUp, Expand, Maximize, Minimize, RotateCcw, Shrink } from "lucide-react";
import { DEFAULT_IMMERSIVE_BG_COLOR } from "../lib/immersiveMode";
import { FLOAT_MENU, MOTION, pressedClass } from "./MapBar";

const MENU_WIDTH = 250;

interface ImmersiveModeMenuProps {
  active: boolean;
  onToggle: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  /** `null` = cor padrão (quase preto) — ver `DEFAULT_IMMERSIVE_BG_COLOR`. */
  backgroundColor: string | null;
  onBackgroundColorChange: (color: string | null) => void;
}

/**
 * Botão "Imersivo" do HUD inferior (docs/SPEC.md §9.22): clique entra/sai do modo na hora (mesmo
 * padrão de ação única do botão principal do `RollModeButton`); a seta ao lado abre um menu com
 * "Tela cheia do navegador" (Fullscreen API, combinável com o modo) e a cor de fundo fora do mapa
 * nesse modo (preferência pessoal, com botão pra voltar ao padrão). Mesmo padrão de popover ancorado
 * (portal, fecha ao clicar fora ou Esc) do `GridAppearanceMenu`.
 */
export const ImmersiveModeMenu: React.FC<ImmersiveModeMenuProps> = ({
  active,
  onToggle,
  isFullscreen,
  onToggleFullscreen,
  backgroundColor,
  onBackgroundColorChange,
}) => {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ left: 0, bottom: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = backgroundColor ?? DEFAULT_IMMERSIVE_BG_COLOR;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggleMenu = () => {
    if (open) {
      setOpen(false);
      return;
    }
    const r = rootRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ left: Math.max(4, Math.min(r.left, window.innerWidth - MENU_WIDTH - 4)), bottom: window.innerHeight - r.top + 4 });
    setOpen(true);
  };

  return (
    <div ref={rootRef} className="relative flex items-center shrink-0">
      <button
        id="immersive-mode-btn"
        type="button"
        onClick={onToggle}
        title={`Modo imersivo (Shift+F): ${active ? "sair" : "entrar"}`}
        aria-pressed={active}
        className={`focus-ring flex items-center gap-1.5 h-7 pl-2 pr-1.5 rounded-l-ui border border-r-0 text-12 font-medium cursor-pointer ${MOTION} ${pressedClass(active)}`}
      >
        {active ? <Shrink className="w-3.5 h-3.5" /> : <Expand className="w-3.5 h-3.5" />}
        <span className="hidden sm:inline">Imersivo</span>
      </button>
      <button
        id="immersive-mode-menu-btn"
        type="button"
        onClick={toggleMenu}
        title="Opções do modo imersivo"
        aria-expanded={open}
        aria-label="Opções do modo imersivo"
        className={`focus-ring grid place-items-center h-7 w-5 rounded-r-ui border border-l-0 cursor-pointer ${MOTION} ${pressedClass(active)}`}
      >
        <ChevronUp className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open &&
        createPortal(
          <div
            id="immersive-mode-menu"
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", left: menuPos.left, bottom: menuPos.bottom, width: MENU_WIDTH }}
            className={`z-50 p-3 space-y-3 ${FLOAT_MENU}`}
          >
            <label className="flex items-center justify-between cursor-pointer gap-2">
              <span className="text-13 font-medium flex items-center gap-1.5">
                {isFullscreen ? <Minimize className="w-3.5 h-3.5 shrink-0" /> : <Maximize className="w-3.5 h-3.5 shrink-0" />}
                Tela cheia do navegador
              </span>
              <input type="checkbox" checked={isFullscreen} onChange={onToggleFullscreen} className="focus-ring w-4 h-4 accent-text cursor-pointer shrink-0" />
            </label>
            <p className="text-12 text-text-muted leading-snug -mt-2">Combina com o modo imersivo. F11 ou o Esc do navegador também saem.</p>

            <div className="pt-2.5 border-t border-border flex items-center justify-between">
              <span className="text-13 font-medium">Fundo fora do mapa</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={current}
                  onChange={(e) => onBackgroundColorChange(e.target.value)}
                  className="focus-ring w-6 h-6 rounded-sm border border-border cursor-pointer bg-transparent"
                />
                <span className="font-data text-12 text-text-muted uppercase">{current}</span>
              </div>
            </div>

            <button
              id="immersive-bg-reset-btn"
              type="button"
              disabled={backgroundColor === null}
              onClick={() => onBackgroundColorChange(null)}
              className="w-full flex items-center justify-center gap-1.5 h-8 px-2 rounded-ui border text-13 font-medium border-border text-text disabled:opacity-40 disabled:cursor-default enabled:cursor-pointer enabled:hover:bg-surface-2 focus-ring"
            >
              <RotateCcw className="w-3 h-3" />
              Usar o padrão (quase preto)
            </button>

            <p className="text-12 text-text-muted leading-snug pt-2.5 border-t border-border">
              Shift+F entra e sai do modo a qualquer momento; Esc também sai.
            </p>
          </div>,
          document.body,
        )}
    </div>
  );
};
