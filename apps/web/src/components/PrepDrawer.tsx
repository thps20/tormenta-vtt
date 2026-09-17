import React, { useEffect } from "react";
import { ClipboardList, PanelLeftClose } from "lucide-react";
import { PrepPanel, type PrepPanelProps } from "./PrepPanel";
import { TabErrorBoundary } from "./TabErrorBoundary";

interface PrepDrawerProps {
  /** Conteúdo (o preparo do mapa visto) — null quando não há mapa ou o viewer não é GM. */
  panel: PrepPanelProps | null;
  onClose: () => void;
}

/**
 * Gaveta de Preparo (docs/SPEC.md §9.28): o que era a aba "Preparo" do painel lateral virou uma
 * COLUNA à esquerda do mapa, do lado de "preparar/montar". Ela empurra o mapa em vez de cobrir —
 * assim a barra de ferramentas do canvas continua visível e clicável.
 *
 * É deliberadamente uma casca fina (cabeçalho + `PrepPanel`): no passo 3 do caminho C
 * (`docs/critique-arquitetura-mesa.md`) esta coluna vira a gaveta "Bastidores", com Mapas, Acervo,
 * Criaturas, Handouts e Sons como irmãs do Preparo — só o cabeçalho muda de dono.
 */
export const PrepDrawer: React.FC<PrepDrawerProps> = ({ panel, onClose }) => {
  // Esc fecha (mesma convenção dos diálogos do projeto).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <aside
      id="prep-drawer"
      aria-label="Preparo"
      className="font-ui w-[340px] xl:w-[380px] shrink-0 h-full bg-surface-1 border-r border-border flex flex-col select-none z-10"
    >
      <div className="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-border">
        <ClipboardList className="w-4 h-4 text-text-muted shrink-0" aria-hidden />
        <h2 className="flex-1 min-w-0 truncate font-title text-13 font-bold uppercase tracking-widest text-text">Preparo</h2>
        <button
          id="btn-prep-drawer-close"
          type="button"
          onClick={onClose}
          title="Fechar o Preparo (Shift+P ou Esc)"
          aria-label="Fechar o Preparo"
          className="focus-ring p-1 rounded-ui text-text-muted hover:text-text hover:bg-surface-2 transition-colors cursor-pointer"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {panel ? (
          <TabErrorBoundary label="Preparo">
            <PrepPanel {...panel} />
          </TabErrorBoundary>
        ) : (
          <p className="p-3 text-12 text-text-muted">Sem mapa aberto — o preparo é por mapa.</p>
        )}
      </div>
    </aside>
  );
};
