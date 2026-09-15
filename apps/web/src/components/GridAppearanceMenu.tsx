import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Grid as GridIcon, RotateCcw } from "lucide-react";
import type { GridAppearanceOverride, GridAppearancePrefs, GridLineStyle, ResolvedGridAppearance } from "../lib/gridAppearance";
import { FLOAT_MENU, MOTION, pressedClass } from "./MapBar";

const MENU_WIDTH = 250;

const STYLE_OPTIONS: { id: GridLineStyle; label: string }[] = [
  { id: "lines", label: "Linhas" },
  { id: "dashed", label: "Pontilhado" },
  { id: "crosses", label: "Marcas nos cruzamentos" },
];

/** `<input type="color">` só aceita "#rrggbb" — a cor efetiva pode vir do Mestre com alfa embutido
 *  (ex. "#00000055") ou em qualquer outro formato; nesse caso mostra um acento neutro no seletor. */
function toColorInputValue(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#c79c54";
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
        aria-pressed={prefs.visible}
        className={`focus-ring relative flex items-center gap-1.5 h-7 px-2 rounded-ui border text-12 font-medium cursor-pointer ${MOTION} ${pressedClass(prefs.visible)}`}
      >
        <GridIcon className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Grid</span>
        {/* Indicador discreto: o usuário sobrepôs o padrão do mapa (docs/SPEC.md §9.21). */}
        {overridden && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-text" title="Aparência personalizada" />}
      </button>

      {open &&
        createPortal(
          <div
            id="grid-appearance-menu"
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", left: menuPos.left, bottom: menuPos.bottom, width: MENU_WIDTH }}
            className={`z-50 p-3 space-y-3 ${FLOAT_MENU}`}
          >
            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-13 font-medium">Exibir grid (só pra mim)</span>
              <input
                type="checkbox"
                checked={prefs.visible}
                onChange={(e) => onChange({ ...prefs, visible: e.target.checked })}
                className="focus-ring w-4 h-4 accent-text cursor-pointer"
              />
            </label>
            <p className="text-12 text-text-muted leading-snug -mt-2">Ocultar não desliga snap nem medidas — só não desenha.</p>

            <div className="pt-2.5 border-t border-border space-y-1">
              <span className="text-13 font-medium">Estilo</span>
              <div className="flex flex-col gap-1">
                {STYLE_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={current.style === opt.id}
                    onClick={() => patchOverride({ style: opt.id })}
                    className={`focus-ring text-left h-7 px-2 rounded-ui border text-13 cursor-pointer ${MOTION} ${pressedClass(current.style === opt.id)}`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-13 font-medium">Cor</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={toColorInputValue(current.color)}
                  onChange={(e) => patchOverride({ color: e.target.value })}
                  className="focus-ring w-6 h-6 rounded-sm border border-border cursor-pointer bg-transparent"
                />
                <span className="font-data text-12 text-text-muted uppercase">{toColorInputValue(current.color)}</span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-13 font-medium">Opacidade</span>
                <span className="font-data text-12 tabular-nums text-text">{Math.round(current.opacity * 100)}%</span>
              </div>
              <input
                type="range"
                min={10}
                max={100}
                value={Math.round(current.opacity * 100)}
                onChange={(e) => patchOverride({ opacity: Number(e.target.value) / 100 })}
                className="focus-ring w-full accent-text cursor-pointer"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-13 font-medium">Espessura</span>
                <span className="font-data text-12 tabular-nums text-text">{current.thickness}px</span>
              </div>
              <input
                type="range"
                min={1}
                max={3}
                step={1}
                value={current.thickness}
                onChange={(e) => patchOverride({ thickness: Number(e.target.value) })}
                className="focus-ring w-full accent-text cursor-pointer"
              />
            </div>

            <button
              id="grid-appearance-reset-btn"
              type="button"
              disabled={!overridden}
              onClick={() => onChange({ ...prefs, override: null })}
              className="w-full flex items-center justify-center gap-1.5 h-8 px-2 rounded-ui border text-13 font-medium border-border text-text disabled:opacity-40 disabled:cursor-default enabled:cursor-pointer enabled:hover:bg-surface-2 focus-ring"
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
