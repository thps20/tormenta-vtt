import React from "react";
import { CloudFog, Hand, MousePointer2, Pencil, Ruler } from "lucide-react";
import type { ToolMode } from "../store/tools";

interface ToolbarProps {
  /** GM vê a ferramenta Névoa; jogador só a lista básica. */
  isGm: boolean;
  /** Modo escolhido pelo usuário (não o temporário do espaço). */
  mode: ToolMode;
  /** Modo em vigor (espaço segurado mostra "Mover mapa" aceso). */
  effectiveMode: ToolMode;
  onChange: (mode: ToolMode) => void;
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

/** Só o GM: pintar a névoa (ver FogToolbar para os sub-modos). */
const GM_TOOLS: ToolDef[] = [{ mode: "fog", label: "Névoa", shortcut: "F", Icon: CloudFog }];

const FUTURE_TOOLS: ToolDef[] = [{ mode: "draw", label: "Desenho", shortcut: null, Icon: Pencil, soon: true }];

/** Barra vertical de ferramentas do canvas (canto superior esquerdo da mesa). */
export const Toolbar: React.FC<ToolbarProps> = ({ isGm, mode, effectiveMode, onChange }) => (
  <div
    id="vtt-toolbar"
    role="toolbar"
    aria-orientation="vertical"
    className="absolute top-4 left-4 z-10 flex flex-col gap-1 p-1.5 rounded bg-[#1a1a1a] border border-[#2d2417] shadow-2xl"
  >
    {TOOLS.map((t) => (
      <ToolButton key={t.mode} tool={t} active={effectiveMode === t.mode} chosen={mode === t.mode} onClick={() => onChange(t.mode)} />
    ))}
    <div className="h-[1px] w-full bg-[#2d2417] my-0.5" />
    {isGm &&
      GM_TOOLS.map((t) => (
        <ToolButton key={t.mode} tool={t} active={effectiveMode === t.mode} chosen={mode === t.mode} onClick={() => onChange(t.mode)} />
      ))}
    {FUTURE_TOOLS.map((t) => (
      <ToolButton key={t.mode} tool={t} active={false} chosen={false} onClick={() => undefined} />
    ))}
  </div>
);

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
