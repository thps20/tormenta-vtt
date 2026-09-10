import React from "react";
import { Circle, Square, Slice, Triangle } from "lucide-react";
import type { TemplatePreset, TemplateShape } from "@tormenta-vtt/shared";

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
 * Padrão visual de FogToolbar.tsx: só chama ações, o estado vem das stores.
 */
export const TemplateToolbar: React.FC<TemplateToolbarProps> = ({ shape, size, unit, presets, onShape, onSize, onPreset }) => (
  <div
    id="template-toolbar"
    role="toolbar"
    aria-label="Ferramentas de área"
    className="absolute top-4 left-[4.25rem] z-10 flex items-center gap-1.5 p-1.5 rounded bg-[#1a1a1a] border border-[#2d2417] shadow-2xl text-zinc-300"
  >
    <div className="flex items-center gap-0.5">
      {SHAPES.map(({ value, label, Icon }) => (
        <button
          key={value}
          id={`template-shape-${value}`}
          type="button"
          aria-pressed={shape === value}
          title={label}
          onClick={() => onShape(value)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-serif font-bold uppercase tracking-wider cursor-pointer transition-colors ${
            shape === value ? "bg-[#2d2417] text-[#d4af37] border border-[#d4af37]/50" : "text-zinc-400 border border-transparent hover:bg-[#252525] hover:text-[#d4af37]"
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">{label}</span>
        </button>
      ))}
    </div>
    <div className="w-[1px] h-5 bg-[#2d2417] mx-0.5" />
    <label className="flex items-center gap-1.5 px-1.5 text-[10px] font-mono text-zinc-400" title="Tamanho (raio/comprimento/lado)">
      <input
        id="template-size"
        type="number"
        min={0.1}
        step={0.5}
        value={size}
        onChange={(e) => onSize(Number(e.target.value))}
        className="w-14 rounded bg-[#101010] border border-[#2d2417] px-1.5 py-0.5 text-zinc-200"
      />
      <span>{unit}</span>
    </label>
    {presets.length > 0 && (
      <>
        <div className="w-[1px] h-5 bg-[#2d2417] mx-0.5" />
        <select
          id="template-preset"
          aria-label="Preset de área"
          defaultValue=""
          onChange={(e) => {
            const preset = presets[Number(e.target.value)];
            if (preset) onPreset(preset);
            e.target.value = "";
          }}
          className="rounded bg-[#101010] border border-[#2d2417] px-1.5 py-1 text-[10px] text-zinc-300"
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
