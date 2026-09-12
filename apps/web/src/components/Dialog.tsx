import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface DialogProps {
  onClose: () => void;
  ariaLabel: string;
  /** Largura máxima do conteúdo (classe Tailwind, ex. "max-w-sm", "max-w-xl"). */
  maxWidthClassName?: string;
  children: React.ReactNode;
}

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo modal ÚNICO, reaproveitado por tudo que a paleta do compêndio abre por cima de si (bloco
 * completo da criatura, editor de homebrew, exportar/importar — docs/plano-compendio-sala.md).
 *
 * Renderiza via PORTAL direto em `document.body`, nunca como descendente DOM da paleta: a paleta
 * (e o wrapper "map" que a envolve, `pointer-events-none` por padrão) tinha layouts que "prendiam"
 * um diálogo aninhado — herdava `pointer-events: none` do ancestral, ou ficava confinado à
 * stacking context de um irmão com o mesmo z-index (bug real: nem o X, nem os campos, respondiam;
 * o mesmo defeito já resolvido em `CreatureFullSheet` antes de existir este componente, agora
 * generalizado). Um portal escapa dos dois problemas: o nó DOM passa a ser filho direto do body,
 * fora de qualquer `pointer-events-none`/stacking context da paleta. **Importante**: um portal NÃO
 * escapa do bubbling de eventos do REACT (só do DOM) — um handler aqui dentro ainda "vê" os
 * `onKeyDown`/`onPointerDown` de quem renderizou o `<Dialog>` como se fosse filho normal; por isso
 * `stopPropagation` continua necessário (diferente do comentário antigo em `CreatureFullSheet`, que
 * valia só por ele ser IRMÃO NO DOM da paleta, não portal).
 *
 * Fecha por: botão X (de quem usa, no `children`), **Esc**, ou **clique fora** (no backdrop).
 * Prende o foco dentro (Tab/Shift+Tab não escapam) enquanto aberto e devolve o foco a quem tinha
 * antes, ao fechar (acessibilidade básica de modal).
 */
export const Dialog: React.FC<DialogProps> = ({ onClose, ariaLabel, maxWidthClassName = "max-w-xl", children }) => {
  const boxRef = useRef<HTMLDivElement>(null);
  // Inicializador preguiçoso: roda na fase de RENDER, antes de o diálogo ser inserido no DOM — pega
  // quem tinha o foco de verdade (ex.: a busca da paleta), sem correr atrás de um autoFocus de
  // dentro do próprio diálogo (que só acontece depois, na fase de commit).
  const [previouslyFocused] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));

  useEffect(() => {
    // Foca o diálogo inteiro por padrão (Esc/Tab já funcionam sem precisar adivinhar qual controle
    // merece o foco inicial) — mas respeita um autoFocus de algum campo lá dentro, se houver: só cai
    // pro container quando nada disputou o foco primeiro.
    if (!boxRef.current?.contains(document.activeElement)) boxRef.current?.focus();
    return () => previouslyFocused?.focus();
  }, [previouslyFocused]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const root = boxRef.current;
    if (!root) return;
    const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      role="presentation"
      onPointerDown={(e) => {
        // Clique fora (no backdrop) fecha; stopPropagation pra não borbulhar pro onPointerDown de
        // quem renderizou o Dialog (ex.: o modo "floating" da paleta fecha a PALETTA INTEIRA no
        // mesmo evento — sem isso, fechar o diálogo fecharia os dois de uma vez).
        e.stopPropagation();
        onClose();
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-[1px]"
    >
      <div
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className={`w-full ${maxWidthClassName} max-h-[90vh] flex flex-col rounded-lg border border-[#3a3022] bg-[#0f0e0c] shadow-[0_0_40px_rgba(0,0,0,0.8)] text-xs outline-none`}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
};
