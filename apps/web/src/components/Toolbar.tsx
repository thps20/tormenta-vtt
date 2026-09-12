import React, { useRef } from "react";
import { CloudFog, Hand, MousePointer2, Pencil, Redo2, Ruler, Shapes, Undo2 } from "lucide-react";
import type { ToolMode } from "../store/tools";
import { useBarTranslucency } from "../lib/useBarTranslucency";

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
}

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

/** Só o GM: pintar a névoa (ver FogToolbar para os sub-modos). */
const GM_TOOLS: ToolDef[] = [{ mode: "fog", label: "Névoa", shortcut: "F", Icon: CloudFog }];

const FUTURE_TOOLS: ToolDef[] = [{ mode: "draw", label: "Desenho", shortcut: null, Icon: Pencil, soon: true }];

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
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const translucent = useBarTranslucency(rootRef, translucentBarsOverMap);
  return (
    <div
      ref={rootRef}
      id="vtt-toolbar"
      role="toolbar"
      aria-orientation="vertical"
      style={{ opacity: translucent ? 0.55 : 1 }}
      className="absolute top-4 left-4 z-10 flex flex-col gap-1 p-1.5 rounded bg-[#1a1a1a] border border-[#2d2417] shadow-2xl transition-opacity duration-150"
    >
      {TOOLS.map((t) => (
        <ToolButton key={t.mode} tool={t} active={effectiveMode === t.mode} chosen={mode === t.mode} onClick={() => onChange(t.mode)} />
      ))}
      {showTemplateTool && (
        <ToolButton tool={TEMPLATE_TOOL} active={effectiveMode === TEMPLATE_TOOL.mode} chosen={mode === TEMPLATE_TOOL.mode} onClick={() => onChange(TEMPLATE_TOOL.mode)} />
      )}
      <div className="h-[1px] w-full bg-[#2d2417] my-0.5" />
      {isGm &&
        GM_TOOLS.map((t) => (
          <ToolButton key={t.mode} tool={t} active={effectiveMode === t.mode} chosen={mode === t.mode} onClick={() => onChange(t.mode)} />
        ))}
      {FUTURE_TOOLS.map((t) => (
        <ToolButton key={t.mode} tool={t} active={false} chosen={false} onClick={() => undefined} />
      ))}
      {isGm && (
        <>
          <div className="h-[1px] w-full bg-[#2d2417] my-0.5" />
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
      className={`group relative w-9 h-9 flex items-center justify-center rounded transition-colors ${
        disabled ? "text-zinc-700 cursor-not-allowed" : "text-zinc-400 hover:bg-[#252525] hover:text-[#d4af37] cursor-pointer"
      }`}
    >
      <Icon className="w-4 h-4" />
      <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 whitespace-nowrap rounded bg-[#1a1a1a] border border-[#2d2417] px-2 py-1 text-[11px] text-zinc-200 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5">
        {tip}
        <kbd className="px-1 rounded bg-[#252525] border border-[#3d3d3d] font-mono text-[10px] text-zinc-400">{shortcut}</kbd>
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
      className={`group relative w-9 h-9 flex items-center justify-center rounded transition-colors ${
        tool.soon
          ? "text-zinc-600 cursor-not-allowed"
          : active
            ? "bg-[#2d2417] text-[#d4af37] border border-[#d4af37]/50 cursor-pointer"
            : "text-zinc-400 hover:bg-[#252525] hover:text-[#d4af37] cursor-pointer"
      }`}
    >
      <Icon className="w-4 h-4" />
      {/* Tooltip à direita, só no hover (title nativo demora a aparecer). */}
      <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 whitespace-nowrap rounded bg-[#1a1a1a] border border-[#2d2417] px-2 py-1 text-[11px] text-zinc-200 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5">
        {tool.label}
        {tool.soon ? (
          <span className="text-zinc-500">em breve</span>
        ) : (
          tool.shortcut && (
            <kbd className="px-1 rounded bg-[#252525] border border-[#3d3d3d] font-mono text-[10px] text-zinc-400">{tool.shortcut}</kbd>
          )
        )}
      </span>
    </button>
  );
}
