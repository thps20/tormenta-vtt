import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp } from 'lucide-react';
import type { RollVisibility } from '@tormenta-vtt/shared';
import { ROLL_MODES, nextRollMode, rollModeInfo } from '../../lib/rollMode';

interface RollModeButtonProps {
  mode: RollVisibility;
  onChange: (mode: RollVisibility) => void;
}

const LONG_PRESS_MS = 450;
const MENU_WIDTH = 240;

/** Cor do botão por modo: público neutro, secreto âmbar, próprio azul. */
const MODE_CLASS: Record<RollVisibility, string> = {
  all: 'text-zinc-400 border-[#3d3d3d] hover:text-[#d4af37] hover:border-[#d4af37]/50',
  gm: 'text-amber-300 border-amber-500/60 bg-amber-950/30 hover:bg-amber-950/50',
  self: 'text-sky-300 border-sky-500/60 bg-sky-950/30 hover:bg-sky-950/50',
};

/**
 * Botão do modo de rolagem na faixa "Rolar": mostra o modo atual (ícone + rótulo).
 * Clique alterna para o próximo; clique longo ou a seta abre o menu com os três.
 */
export const RollModeButton: React.FC<RollModeButtonProps> = ({ mode, onChange }) => {
  const [open, setOpen] = useState(false);
  // O menu vai num portal com posição fixa: a faixa "Rolar" é um flex apertado e
  // qualquer overflow dela recortaria um popover posicionado por dentro.
  const [menuPos, setMenuPos] = useState({ left: 0, bottom: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pressTimer = useRef<number | null>(null);
  // Clique longo abre o menu; o "click" que vem logo depois não pode alternar o modo.
  const longPressed = useRef(false);
  const info = rollModeInfo(mode);
  const Icon = info.icon;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const clearTimer = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };

  const openMenu = () => {
    const r = rootRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ left: Math.max(4, Math.min(r.left, window.innerWidth - MENU_WIDTH - 4)), bottom: window.innerHeight - r.top + 4 });
    setOpen(true);
  };

  const startPress = () => {
    longPressed.current = false;
    clearTimer();
    pressTimer.current = window.setTimeout(() => {
      longPressed.current = true;
      openMenu();
    }, LONG_PRESS_MS);
  };

  const handleClick = () => {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    setOpen(false);
    onChange(nextRollMode(mode));
  };

  return (
    <div ref={rootRef} className="relative flex items-center shrink-0">
      <button
        id="roll-mode-btn"
        type="button"
        data-mode={mode}
        onClick={handleClick}
        onPointerDown={startPress}
        onPointerUp={clearTimer}
        onPointerLeave={clearTimer}
        onPointerCancel={clearTimer}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenu();
        }}
        title={`Modo de rolagem: ${info.label}. Clique para alternar; segure para escolher.`}
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-l border bg-[#1a1a1a] font-mono text-[10px] uppercase tracking-wide transition-colors cursor-pointer select-none ${MODE_CLASS[mode]}`}
      >
        <Icon className="w-3 h-3" />
        <span>{info.label}</span>
      </button>
      <button
        id="roll-mode-menu-btn"
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        title="Escolher modo de rolagem"
        aria-expanded={open}
        className={`flex items-center px-1 py-0.5 rounded-r border border-l-0 bg-[#1a1a1a] transition-colors cursor-pointer ${MODE_CLASS[mode]}`}
      >
        <ChevronUp className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open &&
        createPortal(
        <div
          id="roll-mode-menu"
          ref={menuRef}
          role="menu"
          style={{ position: 'fixed', left: menuPos.left, bottom: menuPos.bottom, width: MENU_WIDTH }}
          className="z-50 rounded border border-[#3d3d3d] bg-[#121212] shadow-xl p-1 space-y-0.5"
        >
          {ROLL_MODES.map((m) => {
            const MIcon = m.icon;
            const active = m.id === mode;
            return (
              <button
                key={m.id}
                id={`roll-mode-opt-${m.id}`}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                className={`w-full text-left flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                  active ? 'bg-[#2d2417] text-[#d4af37]' : 'text-zinc-300 hover:bg-[#1f1f1f]'
                }`}
              >
                <MIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span className="flex flex-col">
                  <span className="text-[11px] font-bold uppercase tracking-wide">{m.label}</span>
                  <span className="text-[10px] text-zinc-500 leading-snug normal-case">{m.description}</span>
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
};
