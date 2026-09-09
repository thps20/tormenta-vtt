import React from "react";
import { CloudFog, Eye, EyeOff, Hexagon, Paintbrush, Power, Square, SunMedium, Undo2 } from "lucide-react";
import { FOG_SHAPES_WARN, type FogConfig, type FogOp, type GridConfig } from "@tormenta-vtt/shared";
import { FOG_BRUSH_MAX, FOG_BRUSH_MIN, type FogToolMode, type FogToolShape } from "../store/tools";

interface FogToolbarProps {
  fog: FogConfig;
  grid: GridConfig;
  fogMode: FogToolMode;
  fogShape: FogToolShape;
  /** Diâmetro do pincel em pixels do mapa. */
  brushSize: number;
  onFogMode: (mode: FogToolMode) => void;
  onFogShape: (shape: FogToolShape) => void;
  onBrushSize: (size: number) => void;
  onOp: (op: FogOp) => void;
}

const MODES: Array<{ value: FogToolMode; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { value: "reveal", label: "Revelar", Icon: Eye },
  { value: "hide", label: "Ocultar", Icon: EyeOff },
];

const SHAPES: Array<{ value: FogToolShape; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { value: "brush", label: "Pincel", Icon: Paintbrush },
  { value: "rect", label: "Retângulo", Icon: Square },
  { value: "polygon", label: "Polígono", Icon: Hexagon },
];

const cellsFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/**
 * Painel secundário do modo Névoa (só GM), à direita da barra de ferramentas:
 * revelar/ocultar, forma, tamanho do pincel, desfazer, revelar/ocultar tudo e o
 * toggle "Fog ativo" da cena. Só chama ações; o estado vem das stores.
 */
export const FogToolbar: React.FC<FogToolbarProps> = ({ fog, grid, fogMode, fogShape, brushSize, onFogMode, onFogShape, onBrushSize, onOp }) => {
  const shapeCount = fog.shapes.length;
  // Com grid quadrado, mostramos o pincel em células (é como o GM pensa); sem grid, em pixels.
  const brushLabel = grid.type === "square" ? `${cellsFormat.format(brushSize / grid.cellSize)} cél.` : `${brushSize} px`;

  return (
    <div
      id="fog-toolbar"
      role="toolbar"
      aria-label="Ferramentas de névoa"
      className="absolute top-4 left-[4.25rem] z-10 flex items-center gap-1.5 p-1.5 rounded bg-[#1a1a1a] border border-[#2d2417] shadow-2xl text-zinc-300"
    >
      <Segmented items={MODES} value={fogMode} onChange={onFogMode} idPrefix="fog-mode" />
      <Divider />
      <Segmented items={SHAPES} value={fogShape} onChange={onFogShape} idPrefix="fog-shape" />
      {fogShape === "brush" && (
        <label className="flex items-center gap-1.5 px-1.5 text-[10px] font-mono text-zinc-400" title="Tamanho do pincel">
          <input
            id="fog-brush-size"
            type="range"
            min={FOG_BRUSH_MIN}
            max={FOG_BRUSH_MAX}
            step={10}
            value={brushSize}
            onChange={(e) => onBrushSize(Number(e.target.value))}
            className="w-20 accent-[#d4af37]"
          />
          <span className="w-12 text-right tabular-nums">{brushLabel}</span>
        </label>
      )}
      <Divider />
      <IconButton id="fog-undo" title="Desfazer último (Ctrl+Z)" disabled={shapeCount === 0} onClick={() => onOp({ type: "removeLast" })}>
        <Undo2 className="w-4 h-4" />
      </IconButton>
      <TextButton id="fog-reveal-all" title="Limpa todas as formas e deixa o mapa inteiro visível" onClick={() => onOp({ type: "revealAll" })}>
        <SunMedium className="w-3.5 h-3.5" />
        Revelar tudo
      </TextButton>
      <TextButton id="fog-hide-all" title="Limpa todas as formas e cobre o mapa inteiro" onClick={() => onOp({ type: "hideAll" })}>
        <CloudFog className="w-3.5 h-3.5" />
        Ocultar tudo
      </TextButton>
      <Divider />
      <button
        id="fog-enabled"
        type="button"
        aria-pressed={fog.enabled}
        title={fog.enabled ? "Névoa ativa neste mapa (clique para desligar)" : "Névoa desligada neste mapa (clique para ligar)"}
        onClick={() => onOp({ type: "setEnabled", enabled: !fog.enabled })}
        className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-serif font-bold uppercase tracking-wider cursor-pointer transition-colors ${
          fog.enabled ? "bg-[#2d2417] text-[#d4af37] border border-[#d4af37]/50" : "text-zinc-400 border border-transparent hover:bg-[#252525]"
        }`}
      >
        <Power className="w-3.5 h-3.5" />
        Fog {fog.enabled ? "ativo" : "inativo"}
      </button>
      <span
        className={`text-[10px] font-mono px-1.5 tabular-nums ${shapeCount > FOG_SHAPES_WARN ? "text-amber-400" : "text-zinc-500"}`}
        title="Formas de névoa neste mapa"
      >
        {shapeCount} {shapeCount === 1 ? "forma" : "formas"}
      </span>
    </div>
  );
};

function Divider() {
  return <div className="w-[1px] h-5 bg-[#2d2417] mx-0.5" />;
}

function Segmented<T extends string>({
  items,
  value,
  onChange,
  idPrefix,
}: {
  items: Array<{ value: T; label: string; Icon: React.ComponentType<{ className?: string }> }>;
  value: T;
  onChange: (v: T) => void;
  idPrefix: string;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {items.map(({ value: v, label, Icon }) => (
        <button
          key={v}
          id={`${idPrefix}-${v}`}
          type="button"
          aria-pressed={value === v}
          title={label}
          onClick={() => onChange(v)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-serif font-bold uppercase tracking-wider cursor-pointer transition-colors ${
            value === v ? "bg-[#2d2417] text-[#d4af37] border border-[#d4af37]/50" : "text-zinc-400 border border-transparent hover:bg-[#252525] hover:text-[#d4af37]"
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

function IconButton({ id, title, disabled, onClick, children }: { id: string; title: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      id={id}
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="p-1.5 rounded transition-colors hover:bg-[#252525] hover:text-[#d4af37] disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-inherit disabled:cursor-not-allowed cursor-pointer"
    >
      {children}
    </button>
  );
}

function TextButton({ id, title, onClick, children }: { id: string; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      id={id}
      type="button"
      title={title}
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-serif font-bold uppercase tracking-wider text-zinc-400 hover:bg-[#252525] hover:text-[#d4af37] cursor-pointer transition-colors"
    >
      {children}
    </button>
  );
}
