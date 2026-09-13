import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronUp, Expand, Maximize, Minimize, RotateCcw, Shrink } from "lucide-react";
import { DEFAULT_IMMERSIVE_BG_COLOR } from "../lib/immersiveMode";

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
        className={`p-1.5 rounded-l transition-colors cursor-pointer flex items-center gap-1 text-xs border border-r-0 ${
          active ? "bg-[#2d2417] text-[#d4af37] border-[#d4af37]/50" : "hover:bg-[#252525] text-zinc-400 border-transparent"
        }`}
      >
        {active ? <Shrink className="w-3.5 h-3.5" /> : <Expand className="w-3.5 h-3.5" />}
        <span className="hidden sm:inline text-[10px] font-serif font-bold uppercase tracking-wider">Imersivo</span>
      </button>
      <button
        id="immersive-mode-menu-btn"
        type="button"
        onClick={toggleMenu}
        title="Opções do modo imersivo"
        aria-expanded={open}
        className={`p-1.5 rounded-r border border-l-0 transition-colors cursor-pointer ${
          active ? "border-[#d4af37]/50 text-[#d4af37] hover:bg-[#252525]" : "border-transparent text-zinc-500 hover:bg-[#252525] hover:text-zinc-300"
        }`}
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
            className="z-50 rounded border border-[#3d3d3d] bg-[#121212] shadow-xl p-2.5 space-y-2.5 text-zinc-300"
          >
            <label className="flex items-center justify-between cursor-pointer gap-2">
              <span className="text-xs font-serif font-medium flex items-center gap-1.5">
                {isFullscreen ? <Minimize className="w-3.5 h-3.5 shrink-0" /> : <Maximize className="w-3.5 h-3.5 shrink-0" />}
                Tela cheia do navegador
              </span>
              <input type="checkbox" checked={isFullscreen} onChange={onToggleFullscreen} className="w-4 h-4 accent-[#d4af37] cursor-pointer shrink-0" />
            </label>
            <p className="text-[10px] text-zinc-500 leading-snug -mt-1.5">Combina com o modo imersivo. F11 ou o Esc do navegador também saem.</p>

            <div className="pt-1.5 border-t border-[#2d2417] flex items-center justify-between">
              <span className="text-xs font-serif font-medium">Fundo fora do mapa</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={current}
                  onChange={(e) => onBackgroundColorChange(e.target.value)}
                  className="w-6 h-6 rounded border border-[#2d2417] cursor-pointer bg-transparent"
                />
                <span className="font-mono text-[10px] text-zinc-500 uppercase">{current}</span>
              </div>
            </div>

            <button
              id="immersive-bg-reset-btn"
              type="button"
              disabled={backgroundColor === null}
              onClick={() => onBackgroundColorChange(null)}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border text-[11px] font-serif font-semibold transition-colors border-[#3d3d3d] text-zinc-300 disabled:opacity-40 disabled:cursor-default enabled:cursor-pointer enabled:hover:bg-[#1f1f1f]"
            >
              <RotateCcw className="w-3 h-3" />
              Usar o padrão (quase preto)
            </button>

            <p className="text-[10px] text-zinc-500 leading-snug pt-1.5 border-t border-[#2d2417]">
              Shift+F entra e sai do modo a qualquer momento; Esc também sai.
            </p>
          </div>,
          document.body,
        )}
    </div>
  );
};
