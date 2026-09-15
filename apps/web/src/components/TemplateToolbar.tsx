import React from "react";
import { Circle, Square, Slice, Triangle } from "lucide-react";
import type { TemplatePreset, TemplateShape } from "@tormenta-vtt/shared";
import { BarDivider, BarSegmented, FLOAT_SURFACE, MOTION } from "./MapBar";

interface TemplateToolbarProps {
  shape: TemplateShape;
  /** Tamanho na unidade do sistema (metros em T20): raio/comprimento/lado conforme a forma. */
  size: number;
  unit: string;
  presets: TemplatePreset[];
  onShape: (shape: TemplateShape) => void;
  onSize: (size: number) => void;
  onPreset: (preset: TemplatePreset) => void;
}

const SHAPES: Array<{ value: TemplateShape; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { value: "circle", label: "Círculo", Icon: Circle },
  { value: "cone", label: "Cone", Icon: Triangle },
  { value: "line", label: "Linha", Icon: Slice },
  { value: "square", label: "Quadrado", Icon: Square },
];

/**
 * Painel secundário do modo Área (docs/plano-gabaritos.md), à direita da barra de ferramentas:
 * forma, tamanho (ângulo do cone e largura da linha vêm do padrão do sistema, ou do preset
 * escolhido — não são campos aqui, ver SystemDefinition.templates) e presets prontos do JSON.
 * Mesmas peças visuais de `MapBar.tsx` que a FogToolbar.tsx: só chama ações, o estado vem das stores.
 */
export const TemplateToolbar: React.FC<TemplateToolbarProps> = ({ shape, size, unit, presets, onShape, onSize, onPreset }) => (
  <div
    id="template-toolbar"
    role="toolbar"
    aria-label="Ferramentas de área"
    className={`absolute top-4 left-[4.25rem] z-10 flex flex-wrap items-center gap-1 p-1 max-w-[calc(100%-5.25rem)] ${FLOAT_SURFACE}`}
  >
    <BarSegmented items={SHAPES} value={shape} onChange={onShape} idPrefix="template-shape" />
    <BarDivider />
    <label className="flex items-center gap-1.5 px-1.5 text-12 text-text-muted" title="Tamanho (raio/comprimento/lado)">
      <input
        id="template-size"
        type="number"
        min={0.1}
        step={0.5}
        value={size}
        onChange={(e) => onSize(Number(e.target.value))}
        className={`focus-ring w-16 h-7 rounded-ui bg-bg border border-border hover:border-text-muted px-1.5 font-data text-13 tabular-nums text-text ${MOTION}`}
      />
      <span>{unit}</span>
    </label>
    {presets.length > 0 && (
      <>
        <BarDivider />
        <select
          id="template-preset"
          aria-label="Preset de área"
          defaultValue=""
          onChange={(e) => {
            const preset = presets[Number(e.target.value)];
            if (preset) onPreset(preset);
            e.target.value = "";
          }}
          className={`focus-ring h-7 max-w-40 rounded-ui bg-bg border border-border hover:border-text-muted px-1.5 text-13 text-text cursor-pointer ${MOTION}`}
        >
          <option value="" disabled>
            Presets…
          </option>
          {presets.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </select>
      </>
    )}
  </div>
);
