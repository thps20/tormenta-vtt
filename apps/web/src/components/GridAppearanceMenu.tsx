import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Grid as GridIcon, RotateCcw } from "lucide-react";
import type { GridAppearanceOverride, GridAppearancePrefs, GridLineStyle, ResolvedGridAppearance } from "../lib/gridAppearance";

const MENU_WIDTH = 250;

const STYLE_OPTIONS: { id: GridLineStyle; label: string }[] = [
  { id: "lines", label: "Linhas" },
  { id: "dashed", label: "Pontilhado" },
  { id: "crosses", label: "Marcas nos cruzamentos" },
];

/** `<input type="color">` só aceita "#rrggbb" — a cor efetiva pode vir do Mestre com alfa embutido
 *  (ex. "#00000055") ou em qualquer outro formato; nesse caso mostra um acento neutro no seletor. */
function toColorInputValue(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#d4af37";
}

interface GridAppearanceMenuProps {
  prefs: GridAppearancePrefs;
  /** Estilo/cor/opacidade/espessura já resolvidos com o padrão do mapa — só para pré-popular os
   *  controles na primeira mudança, quando `prefs.override` ainda é `null`. */
  effective: ResolvedGridAppearance;
  onChange: (next: GridAppearancePrefs) => void;
}

/**
 * Botão "Grid" do HUD inferior (docs/SPEC.md §9.21): abre um menu com preferências PESSOAIS de
 * aparência (mostrar/ocultar, estilo, cor, opacidade, espessura), sem tocar geometria, snap,
 * medidas ou gabaritos — só como o grid é desenhado nesta tela. Mesmo padrão de popover ancorado do
 * `RollModeButton` (portal com posição fixa, fecha ao clicar fora ou Esc).
 */
export const GridAppearanceMenu: React.FC<GridAppearanceMenuProps> = ({ prefs, effective, onChange }) => {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ left: 0, bottom: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const overridden = prefs.override !== null;
  const current = prefs.override ?? effective;

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

  /** Muda um campo do estilo/cor/opacidade/espessura — cria o override a partir do efetivo atual na
   *  primeira mudança (assim as outras propriedades continuam iguais ao que já se via). */
  const patchOverride = (patch: Partial<GridAppearanceOverride>) => {
    const base = prefs.override ?? effective;
    onChange({ ...prefs, override: { style: base.style, color: base.color, opacity: base.opacity, thickness: base.thickness, ...patch } });
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        id="grid-appearance-btn"
        type="button"
        onClick={toggleMenu}
        title="Aparência do grid (só pra mim)"
        aria-expanded={open}
        className={`relative p-1.5 rounded transition-colors cursor-pointer flex items-center gap-1 text-xs ${
          prefs.visible ? "bg-[#2d2417] text-[#d4af37] border border-[#d4af37]/50" : "hover:bg-[#252525] text-zinc-400"
        }`}
      >
        <GridIcon className="w-3.5 h-3.5" />
        <span className="hidden sm:inline text-[10px] font-serif font-bold uppercase tracking-wider">Grid</span>
        {/* Indicador discreto: o usuário sobrepôs o padrão do mapa (docs/SPEC.md §9.21). */}
        {overridden && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-sky-400" />}
      </button>

      {open &&
        createPortal(
          <div
            id="grid-appearance-menu"
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", left: menuPos.left, bottom: menuPos.bottom, width: MENU_WIDTH }}
            className="z-50 rounded border border-[#3d3d3d] bg-[#121212] shadow-xl p-2.5 space-y-2.5 text-zinc-300"
          >
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-xs font-serif font-medium">Exibir grid (só pra mim)</span>
              <input
                type="checkbox"
                checked={prefs.visible}
                onChange={(e) => onChange({ ...prefs, visible: e.target.checked })}
                className="w-4 h-4 accent-[#d4af37] cursor-pointer"
              />
            </label>
            <p className="text-[10px] text-zinc-500 leading-snug -mt-1.5">Ocultar não desliga snap nem medidas — só não desenha.</p>

            <div className="pt-1.5 border-t border-[#2d2417] space-y-1">
              <span className="text-xs font-serif font-medium">Estilo</span>
              <div className="flex flex-col gap-1">
                {STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={current.style === opt.id}
                    onClick={() => patchOverride({ style: opt.id })}
                    className={`text-left px-2 py-1 rounded text-[11px] cursor-pointer transition-colors ${
                      current.style === opt.id ? "bg-[#2d2417] text-[#d4af37]" : "hover:bg-[#1f1f1f]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs font-serif font-medium">Cor</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={toColorInputValue(current.color)}
                  onChange={(e) => patchOverride({ color: e.target.value })}
                  className="w-6 h-6 rounded border border-[#2d2417] cursor-pointer bg-transparent"
                />
                <span className="font-mono text-[10px] text-zinc-500 uppercase">{toColorInputValue(current.color)}</span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-serif font-medium">Opacidade</span>
                <span className="font-mono text-[11px] font-bold text-[#d4af37]">{Math.round(current.opacity * 100)}%</span>
              </div>
              <input
                type="range"
                min={10}
                max={100}
                value={Math.round(current.opacity * 100)}
                onChange={(e) => patchOverride({ opacity: Number(e.target.value) / 100 })}
                className="w-full accent-[#d4af37] cursor-pointer"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-serif font-medium">Espessura</span>
                <span className="font-mono text-[11px] font-bold text-[#d4af37]">{current.thickness}px</span>
              </div>
              <input
                type="range"
                min={1}
                max={3}
                step={1}
                value={current.thickness}
                onChange={(e) => patchOverride({ thickness: Number(e.target.value) })}
                className="w-full accent-[#d4af37] cursor-pointer"
              />
            </div>

            <button
              id="grid-appearance-reset-btn"
              type="button"
              disabled={!overridden}
              onClick={() => onChange({ ...prefs, override: null })}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded border text-[11px] font-serif font-semibold transition-colors border-[#3d3d3d] text-zinc-300 disabled:opacity-40 disabled:cursor-default enabled:cursor-pointer enabled:hover:bg-[#1f1f1f]"
            >
              <RotateCcw className="w-3 h-3" />
              Usar o padrão do mapa
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
};
