import React, { useRef } from "react";
import { CloudFog, Hand, MapPin, MousePointer2, Pencil, Redo2, Ruler, Shapes, Undo2 } from "lucide-react";
import type { ToolMode } from "../store/tools";
import { useBarTranslucency } from "../lib/useBarTranslucency";
import { BarDivider, FLOAT_SURFACE, KBD, MOTION } from "./MapBar";

interface ToolbarProps {
  /** GM vê a ferramenta Névoa e os botões de desfazer/refazer; jogador só a lista básica. */
  isGm: boolean;
  /** Ferramenta "Área" (docs/plano-gabaritos.md) só aparece se o sistema declarar `templates`. */
  showTemplateTool: boolean;
  /** Modo escolhido pelo usuário (não o temporário do espaço). */
  mode: ToolMode;
  /** Modo em vigor (espaço segurado mostra "Mover mapa" aceso). */
  effectiveMode: ToolMode;
  onChange: (mode: ToolMode) => void;
  /** Desfazer/refazer (docs/plano-desfazer.md) — pilha do GM, fora do modo Névoa. */
  canUndo: boolean;
  canRedo: boolean;
  /** Resumo da entrada no topo de cada pilha, pro tooltip ("apagar Goblin 3"). */
  undoSummary?: string;
  redoSummary?: string;
  onUndo: () => void;
  onRedo: () => void;
  /** Preferência por usuário (padrão ligada, botão no HUD inferior do VttCanvas): translúcida
   *  quando esta barra está sobre o mapa e o mouse/foco não está nela — ver lib/useBarTranslucency. */
  translucentBarsOverMap: boolean;
  /** Modo imersivo (docs/SPEC.md §9.22): some de vez (opacidade 0, sem pointer-events) depois de
   *  2s sem mouse/tecla — sobrepõe a translucidez normal, que continua valendo fora da ociosidade. */
  immersiveHidden: boolean;
}

/** Dica à direita do botão: aparece no hover e no foco do teclado. */
const TOOLTIP =
  "pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 whitespace-nowrap rounded-ui bg-surface-2 border border-border px-2 py-1 font-ui text-12 text-text shadow-float opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150 ease-out flex items-center gap-1.5 z-20";

interface ToolDef {
  mode: ToolMode;
  label: string;
  shortcut: string | null;
  Icon: React.ComponentType<{ className?: string }>;
  /** Reservado na barra, ainda sem comportamento. */
  soon?: boolean;
}

const TOOLS: ToolDef[] = [
  { mode: "select", label: "Selecionar", shortcut: "V", Icon: MousePointer2 },
  { mode: "pan", label: "Mover mapa", shortcut: "H", Icon: Hand },
  { mode: "ruler", label: "Régua", shortcut: "R", Icon: Ruler },
];

/** Só quando o sistema declara `templates` (docs/plano-gabaritos.md) — não é GM-only. */
const TEMPLATE_TOOL: ToolDef = { mode: "template", label: "Área", shortcut: "T", Icon: Shapes };

/** Desenho livre (SPEC §9.17) — GM sempre; jogador conforme o toggle da sala (ver DrawToolbar,
 *  que mostra o aviso quando está desligado). Não é GM-only na barra. */
const DRAW_TOOL: ToolDef = { mode: "draw", label: "Desenho", shortcut: "D", Icon: Pencil };
// D só troca para Desenho sem token selecionado; com seleção, D move o token (WASD, useToolShortcuts).

/** Só o GM: pintar a névoa (ver FogToolbar para os sub-modos) e fixar pinos (docs/plano-narracao.md). */
const GM_TOOLS: ToolDef[] = [
  { mode: "fog", label: "Névoa", shortcut: "F", Icon: CloudFog },
  { mode: "pin", label: "Pino", shortcut: "P", Icon: MapPin },
];

/** Barra vertical de ferramentas do canvas (canto superior esquerdo da mesa). */
export const Toolbar: React.FC<ToolbarProps> = ({
  isGm,
  showTemplateTool,
  mode,
  effectiveMode,
  onChange,
  canUndo,
  canRedo,
  undoSummary,
  redoSummary,
  onUndo,
  onRedo,
  translucentBarsOverMap,
  immersiveHidden,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const translucent = useBarTranslucency(rootRef, translucentBarsOverMap);

  /**
   * Padrão WAI-ARIA de toolbar vertical: com o foco num botão, ↑/↓ andam entre os botões habilitados
   * (dando a volta) e Home/End vão às pontas. `stopPropagation` impede a seta de chegar ao atalho de
   * mover token (`useTokenMoveShortcuts`, listener da janela) — a seta aqui é navegação, não movimento.
   */
  const handleArrowKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    const buttons = Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    e.preventDefault();
    e.stopPropagation();
    const last = buttons.length - 1;
    const next = e.key === "Home" ? 0 : e.key === "End" ? last : e.key === "ArrowDown" ? (index >= last ? 0 : index + 1) : index <= 0 ? last : index - 1;
    buttons[next]?.focus();
  };
  return (
    <div
      ref={rootRef}
      id="vtt-toolbar"
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Ferramentas do mapa"
      onKeyDown={handleArrowKeys}
      style={{ opacity: immersiveHidden ? 0 : translucent ? 0.55 : 1, pointerEvents: immersiveHidden ? "none" : undefined }}
      className={`absolute top-4 left-4 z-10 flex flex-col gap-0.5 p-1 transition-opacity duration-150 ease-out ${FLOAT_SURFACE}`}
    >
      {TOOLS.map((t) => (
        <ToolButton key={t.mode} tool={t} active={effectiveMode === t.mode} chosen={mode === t.mode} onClick={() => onChange(t.mode)} />
      ))}
      {showTemplateTool && (
        <ToolButton tool={TEMPLATE_TOOL} active={effectiveMode === TEMPLATE_TOOL.mode} chosen={mode === TEMPLATE_TOOL.mode} onClick={() => onChange(TEMPLATE_TOOL.mode)} />
      )}
      <ToolButton tool={DRAW_TOOL} active={effectiveMode === DRAW_TOOL.mode} chosen={mode === DRAW_TOOL.mode} onClick={() => onChange(DRAW_TOOL.mode)} />
      <BarDivider orientation="horizontal" />
      {isGm &&
        GM_TOOLS.map((t) => (
          <ToolButton key={t.mode} tool={t} active={effectiveMode === t.mode} chosen={mode === t.mode} onClick={() => onChange(t.mode)} />
        ))}
      {isGm && (
        <>
          <BarDivider orientation="horizontal" />
          <HistoryButton id="history-undo" icon={Undo2} label="Desfazer" shortcut="Ctrl+Z" summary={undoSummary} disabled={!canUndo} onClick={onUndo} />
          <HistoryButton id="history-redo" icon={Redo2} label="Refazer" shortcut="Ctrl+Shift+Z" summary={redoSummary} disabled={!canRedo} onClick={onRedo} />
        </>
      )}
    </div>
  );
};

/**
 * Desfazer/refazer: visual parecido com ToolButton, mas não é "modo" (sem aria-pressed/chosen) —
 * dispara na hora. Tooltip mostra o resumo da entrada no topo da pilha em vez do rótulo fixo da
 * ferramenta (docs/plano-desfazer.md §9).
 */
function HistoryButton({
  id,
  icon: Icon,
  label,
  shortcut,
  summary,
  disabled,
  onClick,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut: string;
  summary: string | undefined;
  disabled: boolean;
  onClick: () => void;
}) {
  const tip = summary ? `${label}: ${summary}` : label;
  return (
    <button
      id={id}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={tip}
      className={`focus-ring group relative w-9 h-9 flex items-center justify-center rounded-ui ${MOTION} ${
        disabled ? "text-text-muted/35 cursor-not-allowed" : "text-text-muted hover:bg-surface-2 hover:text-text cursor-pointer"
      }`}
    >
      <Icon className="w-4 h-4" />
      <span className={TOOLTIP}>
        {tip}
        <kbd className={KBD}>{shortcut}</kbd>
      </span>
    </button>
  );
}

function ToolButton({ tool, active, chosen, onClick }: { tool: ToolDef; active: boolean; chosen: boolean; onClick: () => void }) {
  const { Icon } = tool;
  const tip = tool.soon ? `${tool.label} (em breve)` : tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label;
  return (
    <button
      id={`tool-${tool.mode}`}
      type="button"
      onClick={onClick}
      disabled={tool.soon}
      aria-label={tip}
      aria-pressed={chosen}
      className={`focus-ring group relative w-9 h-9 flex items-center justify-center rounded-ui ${MOTION} ${
        tool.soon
          ? "text-text-muted/35 cursor-not-allowed"
          : active
            ? "bg-surface-2 text-accent cursor-pointer"
            : "text-text-muted hover:bg-surface-2 hover:text-text cursor-pointer"
      }`}
    >
      <Icon className="w-4 h-4" />
      {/* Tooltip à direita, no hover e no foco do teclado (title nativo demora a aparecer). */}
      <span className={TOOLTIP}>
        {tool.label}
        {tool.soon ? (
          <span className="text-text-muted">em breve</span>
        ) : (
          tool.shortcut && (
            <kbd className={KBD}>{tool.shortcut}</kbd>
          )
        )}
      </span>
    </button>
  );
}
