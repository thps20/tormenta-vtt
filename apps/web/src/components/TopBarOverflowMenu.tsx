import React, { useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { FLOAT_MENU, MOTION } from "./MapBar";

export interface OverflowAction {
  id: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  /** Atalho mostrado à direita do rótulo ("B", "Shift+P"). */
  shortcut?: string;
  /** Separador acima deste item (ex.: "Sair para o Lobby"). */
  separated?: boolean;
  /** Item destrutivo/de saída: texto em vermelho. */
  danger?: boolean;
}

/**
 * Menu "⋯" no fim da barra superior (docs/SPEC.md §9.28): guarda o que é de PREPARAR (Handouts,
 * Acervo, Preparo) e o que é de sistema (Lobby), tirando esses botões da prateleira plana que a
 * barra era. O que é de JOGAR — Fichas, Macros, Notas, Cast, som — continua visível na barra.
 * No passo 3 do caminho C as entradas de preparar migram para a gaveta "Bastidores", e este menu
 * fica só com sistema.
 */
export const TopBarOverflowMenu: React.FC<{ actions: OverflowAction[] }> = ({ actions }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (actions.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        id="btn-topbar-overflow"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Mais opções da mesa"
        title="Mais opções da mesa"
        className={`focus-ring flex items-center justify-center h-8 w-8 rounded-ui border border-border bg-surface-1 hover:bg-surface-2 text-text-muted hover:text-text cursor-pointer ${MOTION}`}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>

      {open && (
        <div id="topbar-overflow-menu" role="menu" className={`absolute right-0 top-full mt-1.5 w-56 z-50 p-1 flex flex-col gap-0.5 ${FLOAT_MENU}`}>
          {actions.map((action) => (
            <React.Fragment key={action.id}>
              {action.separated && <div className="h-px bg-border my-0.5" aria-hidden />}
              <button
                id={`btn-overflow-${action.id}`}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  action.onClick();
                }}
                className={`focus-ring w-full flex items-center gap-2 px-2 py-1.5 rounded-ui text-13 cursor-pointer ${MOTION} ${
                  action.danger ? "text-danger hover:bg-danger/15" : "text-text hover:bg-surface-2"
                }`}
              >
                <action.Icon className={`w-3.5 h-3.5 shrink-0 ${action.danger ? "" : "text-text-muted"}`} aria-hidden />
                <span className="flex-1 min-w-0 truncate text-left">{action.label}</span>
                {action.shortcut && <kbd className="shrink-0 px-1 rounded-sm bg-bg border border-border font-data text-12 text-text-muted">{action.shortcut}</kbd>}
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
