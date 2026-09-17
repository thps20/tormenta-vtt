import React, { useEffect, useState } from "react";
import { ClipboardList, Map as MapIcon, PanelLeftClose } from "lucide-react";
import { MOTION } from "../MapBar";

/** Seções da gaveta. Passo 3 traz Mapas e Preparo; Acervo, Criaturas, Handouts e Sons vêm no 4. */
export type BastidoresSection = "mapas" | "preparo";

export const BASTIDORES_SECTIONS: { id: BastidoresSection; label: string; Icon: React.ComponentType<{ className?: string }>; shortcut: string }[] = [
  { id: "mapas", label: "Mapas", Icon: MapIcon, shortcut: "M" },
  { id: "preparo", label: "Preparo", Icon: ClipboardList, shortcut: "Shift+P" },
];

interface BastidoresDrawerProps {
  /** `false` inicia a animação de saída; a página desmonta logo depois (ver RoomPage). */
  open: boolean;
  section: BastidoresSection;
  onSectionChange: (section: BastidoresSection) => void;
  onClose: () => void;
  /** Conteúdo da seção ativa (a página monta — as seções dependem de props da sala). */
  children: React.ReactNode;
}

/**
 * Gaveta "Bastidores" (docs/SPEC.md §9.29, caminho C de `docs/critique-arquitetura-mesa.md`): tudo
 * que é de EDITAR/MONTAR mora numa coluna à esquerda do mapa; o que é de CONDUZIR fica na coluna da
 * Mesa, à direita. Uma seção por vez, cada uma com tecla própria (M = Mapas, Shift+P = Preparo).
 *
 * A gaveta EMPURRA o mapa em vez de cobrir — assim a barra de ferramentas do canvas, que é ancorada
 * à borda da área do mapa, nunca fica embaixo dela. Em janelas estreitas quem decide se as duas
 * colunas cabem juntas é a página (ver `useNarrowLayout` em RoomPage).
 */
export const BastidoresDrawer: React.FC<BastidoresDrawerProps> = ({ open, section, onSectionChange, onClose, children }) => {
  // Anima a largura: entra do zero no primeiro quadro depois de montar, e volta a zero quando
  // `open` vira false (a página segura o desmonte por um instante). Curta de propósito — é layout
  // mudando, não um efeito: 150 ms, a mesma duração das outras transições da mesa (MOTION).
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!open) {
      setExpanded(false);
      return;
    }
    const id = requestAnimationFrame(() => setExpanded(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Esc fecha (mesma convenção dos diálogos e da gaveta de ficha).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <aside
      id="bastidores-drawer"
      aria-label="Bastidores"
      aria-hidden={!open}
      className={`font-ui shrink-0 h-full bg-surface-1 border-r border-border flex flex-col select-none z-10 overflow-hidden transition-[width] duration-150 ease-out ${
        expanded ? "w-[340px] xl:w-[360px]" : "w-0"
      }`}
    >
      {/* Largura fixa do conteúdo: sem isto o texto se reorganiza a cada quadro da animação. */}
      <div className="w-[340px] xl:w-[360px] h-full flex flex-col">
      <div className="h-11 shrink-0 flex items-center gap-2 px-3 border-b border-border">
        <h2 className="flex-1 min-w-0 truncate font-title text-13 font-bold uppercase tracking-widest text-text">Bastidores</h2>
        <button
          id="btn-bastidores-close"
          type="button"
          onClick={onClose}
          title="Fechar os Bastidores (Esc)"
          aria-label="Fechar os Bastidores"
          className={`focus-ring p-1 rounded-ui text-text-muted hover:text-text hover:bg-surface-2 cursor-pointer ${MOTION}`}
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>

      {/* Lista de seções: uma visível por vez, com a tecla de cada uma na dica. */}
      <div role="tablist" aria-label="Seções dos Bastidores" className="flex items-center gap-1 px-2 py-1.5 border-b border-border shrink-0">
        {BASTIDORES_SECTIONS.map(({ id, label, Icon, shortcut }) => {
          const active = id === section;
          return (
            <button
              key={id}
              id={`btn-bastidores-section-${id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="bastidores-section-panel"
              tabIndex={active ? 0 : -1}
              onClick={() => onSectionChange(id)}
              title={`${label} (${shortcut})`}
              onKeyDown={(e) => {
                const order = BASTIDORES_SECTIONS.map((s) => s.id);
                const i = order.indexOf(section);
                const next =
                  e.key === "ArrowRight" ? order[(i + 1) % order.length] : e.key === "ArrowLeft" ? order[(i - 1 + order.length) % order.length] : null;
                if (!next) return;
                e.preventDefault();
                e.stopPropagation();
                onSectionChange(next);
                document.getElementById(`btn-bastidores-section-${next}`)?.focus();
              }}
              className={`focus-ring flex items-center gap-1.5 h-7 px-2.5 rounded-ui border text-12 font-title font-bold uppercase tracking-wider cursor-pointer ${MOTION} ${
                active ? "bg-surface-2 border-accent/60 text-accent" : "border-transparent text-text-muted hover:bg-surface-2 hover:text-text"
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
              {label}
            </button>
          );
        })}
      </div>

      <div id="bastidores-section-panel" role="tabpanel" aria-labelledby={`btn-bastidores-section-${section}`} className="flex-1 min-h-0 overflow-hidden">
        {children}
      </div>
      </div>
    </aside>
  );
};
