import React from "react";
import { CloudFog, Eye, EyeOff, Hexagon, Paintbrush, Power, Square, SunMedium, Undo2 } from "lucide-react";
import { BarCount, BarDivider, BarIconButton, BarSegmented, BarTextButton, BarToggle, FLOAT_SURFACE } from "./MapBar";
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
 * toggle "Fog ativo" da cena. Só chama ações; o estado vem das stores. Visual nas peças
 * compartilhadas de `MapBar.tsx`.
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
      className={`absolute top-4 left-[4.25rem] z-10 flex flex-wrap items-center gap-1 p-1 max-w-[calc(100%-5.25rem)] ${FLOAT_SURFACE}`}
    >
      <BarSegmented items={MODES} value={fogMode} onChange={onFogMode} idPrefix="fog-mode" />
      <BarDivider />
      <BarSegmented items={SHAPES} value={fogShape} onChange={onFogShape} idPrefix="fog-shape" />
      {fogShape === "brush" && (
        <label className="flex items-center gap-1.5 px-1.5 font-data text-12 text-text-muted" title="Tamanho do pincel">
          <input
            id="fog-brush-size"
            type="range"
            min={FOG_BRUSH_MIN}
            max={FOG_BRUSH_MAX}
            step={10}
            value={brushSize}
            onChange={(e) => onBrushSize(Number(e.target.value))}
            className="focus-ring w-16 accent-text cursor-pointer"
          />
          <span className="min-w-10 text-right tabular-nums whitespace-nowrap">{brushLabel}</span>
        </label>
      )}
      <BarDivider />
      <BarIconButton id="fog-undo" title="Desfazer último (Ctrl+Z)" disabled={shapeCount === 0} onClick={() => onOp({ type: "removeLast" })}>
        <Undo2 className="w-4 h-4" />
      </BarIconButton>
      <BarTextButton id="fog-reveal-all" title="Limpa todas as formas e deixa o mapa inteiro visível" onClick={() => onOp({ type: "revealAll" })}>
        <SunMedium className="w-3.5 h-3.5" />
        Revelar tudo
      </BarTextButton>
      <BarTextButton id="fog-hide-all" title="Limpa todas as formas e cobre o mapa inteiro" onClick={() => onOp({ type: "hideAll" })}>
        <CloudFog className="w-3.5 h-3.5" />
        Ocultar tudo
      </BarTextButton>
      <BarDivider />
      <BarToggle
        id="fog-enabled"
        pressed={fog.enabled}
        title={fog.enabled ? "Névoa ativa neste mapa (clique para desligar)" : "Névoa desligada neste mapa (clique para ligar)"}
        onClick={() => onOp({ type: "setEnabled", enabled: !fog.enabled })}
      >
        <Power className="w-3.5 h-3.5" />
        Fog {fog.enabled ? "ativo" : "inativo"}
      </BarToggle>
      <BarCount warn={shapeCount > FOG_SHAPES_WARN} title="Formas de névoa neste mapa">
        {shapeCount} {shapeCount === 1 ? "forma" : "formas"}
      </BarCount>
    </div>
  );
};
