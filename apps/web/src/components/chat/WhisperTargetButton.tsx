import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp, MessageCircle, Users } from 'lucide-react';
import type { Participant } from '@tormenta-vtt/shared';

interface WhisperTargetButtonProps {
  /** Todos os participantes da sala, menos eu (a lista já vem filtrada por quem chama). */
  participants: Participant[];
  /** null = todos (sem sussurro). */
  target: string | null;
  onChange: (participantId: string | null) => void;
}

const MENU_WIDTH = 200;

/**
 * Seletor "para" (docs/plano-narracao.md), ao lado do modo de rolagem: escolhe um sussurro
 * pontual pra próxima mensagem (texto ou rolagem) — reseta pra "Todos" sozinho depois de enviar
 * (ver store/chat.ts#send). Mesmo componente-base de `RollModeButton` (portal, clique abre menu).
 */
export const WhisperTargetButton: React.FC<WhisperTargetButtonProps> = ({ participants, target, onChange }) => {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ left: 0, bottom: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

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

  const openMenu = () => {
    const r = rootRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ left: Math.max(4, Math.min(r.left, window.innerWidth - MENU_WIDTH - 4)), bottom: window.innerHeight - r.top + 4 });
    setOpen(true);
  };

  const targetParticipant = target ? participants.find((p) => p.id === target) : null;
  const label = targetParticipant ? targetParticipant.nickname : 'Todos';
  const whispering = target !== null;

  return (
    <div ref={rootRef} className="relative flex items-center shrink-0">
      <button
        id="whisper-target-btn"
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        title={whispering ? `Sussurrando para ${label} — clique para trocar` : 'Sussurrar para alguém (seletor "para")'}
        aria-expanded={open}
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded border font-mono text-[10px] uppercase tracking-wide transition-colors cursor-pointer select-none ${
          whispering ? 'text-purple-300 border-purple-500/60 bg-purple-950/30 hover:bg-purple-950/50' : 'text-zinc-400 border-[#3d3d3d] hover:text-[#d4af37] hover:border-[#d4af37]/50'
        }`}
      >
        {whispering ? <MessageCircle className="w-3 h-3" /> : <Users className="w-3 h-3" />}
        <span className="max-w-[64px] truncate">{label}</span>
        <ChevronUp className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open &&
        createPortal(
          <div
            id="whisper-target-menu"
            ref={menuRef}
            role="menu"
            style={{ position: 'fixed', left: menuPos.left, bottom: menuPos.bottom, width: MENU_WIDTH }}
            className="z-50 rounded border border-[#3d3d3d] bg-[#121212] shadow-xl p-1 space-y-0.5 max-h-56 overflow-y-auto"
          >
            <button
              type="button"
              role="menuitemradio"
              aria-checked={target === null}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors text-[11px] ${
                target === null ? 'bg-[#2d2417] text-[#d4af37]' : 'text-zinc-300 hover:bg-[#1f1f1f]'
              }`}
            >
              <Users className="w-3.5 h-3.5 shrink-0" />
              Todos (sem sussurro)
            </button>
            {participants.map((p) => (
              <button
                key={p.id}
                type="button"
                role="menuitemradio"
                aria-checked={target === p.id}
                onClick={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
                className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors text-[11px] truncate ${
                  target === p.id ? 'bg-purple-950/40 text-purple-300' : 'text-zinc-300 hover:bg-[#1f1f1f]'
                }`}
              >
                <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                {p.nickname}
                {p.role === 'gm' && <span className="text-[9px] text-[#d4af37]">(GM)</span>}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
};
