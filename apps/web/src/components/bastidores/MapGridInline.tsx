import React, { useRef, useState } from "react";
import { Crosshair, Eye, EyeOff, Image as ImageIcon, Magnet, Palette, Upload, X } from "lucide-react";
import type { GridConfig, Scene, SystemDefinition } from "@tormenta-vtt/shared";
import { uploadImage } from "../../lib/api";
import { toast } from "../../store/ui";
import { GridCalibrator } from "../GridCalibrator";
import { DEFAULT_MAP } from "../VttCanvas";
import { MOTION, pressedClass } from "../MapBar";

/** Presets do bloco "Escala" (docs/SPEC.md §3.2): quanto vale 1 célula neste mapa. */
const SCALE_PRESETS: { label: string; value: number; unit: string }[] = [
  { label: "1,5 m", value: 1.5, unit: "m" },
  { label: "15 m", value: 15, unit: "m" },
  { label: "100 m", value: 100, unit: "m" },
  { label: "1 km", value: 1, unit: "km" },
];

const GRID_COLOR_PRESETS = [
  { name: "Ouro Antigo", hex: "#d4af37" },
  { name: "Pedra Sóbria", hex: "#78716c" },
  { name: "Branco Névoa", hex: "#ffffff" },
  { name: "Sombra Ébano", hex: "#000000" },
  { name: "Carmim Real", hex: "#dc2626" },
  { name: "Arcano Azul", hex: "#38bdf8" },
];

/** Arredonda pra 1 casa decimal (GridConfig.cellSize/offsetX/offsetY, docs/plano-grid.md D6). */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Cor + opacidade -> "#rrggbbaa" (formato usado no GridConfig; o Konva aceita). */
export function toHex8(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex.slice(0, 7)}${a}`;
}

/** Lê "#rgb", "#rrggbb", "#rrggbbaa" ou "rgba(...)" -> { hex, opacity }. */
export function parseColor(colorStr: string): { hex: string; opacity: number } {
  const fallback = { hex: "#d4af37", opacity: 0.35 };
  const rgba = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(colorStr);
  if (rgba) {
    const [, r = "0", g = "0", b = "0", a] = rgba;
    const toH = (v: string) => Number(v).toString(16).padStart(2, "0");
    return { hex: `#${toH(r)}${toH(g)}${toH(b)}`, opacity: a !== undefined ? Number(a) : 1 };
  }
  if (colorStr.startsWith("#")) {
    let h = colorStr.slice(1);
    if (h.length === 3)
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    if (h.length === 6) return { hex: `#${h}`, opacity: 1 };
    if (h.length === 8) return { hex: `#${h.slice(0, 6)}`, opacity: parseInt(h.slice(6, 8), 16) / 255 };
  }
  return fallback;
}

interface MapGridInlineProps {
  /** Mapa que o GM está vendo — é ele que esta seção configura. */
  scene: Scene;
  /** Pra rotular/ativar o bloco "Escala" (sistema sem `grid` não mostra o bloco, §3.2). */
  systemDef: SystemDefinition | null;
  onSetMap: (map: { mapUrl: string | null; mapWidth: number | null; mapHeight: number | null }) => void;
  onUpdateGrid: (patch: Partial<GridConfig>) => void;
}

/**
 * Imagem do mapa + grid + escala + calibração, INLINE nos Bastidores (docs/SPEC.md §9.29) — era o
 * `MapConfigModal`, um modal largo com "Salvar"/"Cancelar" e um preview em canvas próprio.
 *
 * Aqui não há preview nem botão Salvar: **o mapa atrás é o preview**. Cada controle aplica na hora
 * (`scene:updateGrid`/`scene:setMap`), e o estado exibido vem sempre da cena — mexer no controle e
 * ver o grid mudar no mapa é o ponto de tirar isto do modal. Controles contínuos (tamanho da célula,
 * deslocamentos, opacidade) só emitem ao SOLTAR (`onChange` do range dispara a cada pixel
 * arrastado); o valor enquanto arrasta fica num estado local de rascunho.
 */
export const MapGridInline: React.FC<MapGridInlineProps> = ({ scene, systemDef, onSetMap, onUpdateGrid }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [calibratorOpen, setCalibratorOpen] = useState(false);
  /** Rascunho de um controle contínuo enquanto o dedo está no slider (null = mostra o da cena). */
  const [draft, setDraft] = useState<Partial<Record<"cellSize" | "offsetX" | "offsetY" | "opacity", number>>>({});

  const grid = scene.grid;
  const color = parseColor(grid.color);
  const cellSize = draft.cellSize ?? grid.cellSize;
  const offsetX = draft.offsetX ?? grid.offsetX;
  const offsetY = draft.offsetY ?? grid.offsetY;
  const opacity = draft.opacity ?? color.opacity;
  const scaleValue = grid.unitsPerCell ?? systemDef?.grid?.cellSize ?? 1;
  const scaleUnit = grid.unit ?? systemDef?.grid?.unit ?? "";

  const processImageFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const res = await uploadImage(file);
      onSetMap({ mapUrl: res.url, mapWidth: res.width, mapHeight: res.height });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Falha no upload");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const gridOn = grid.type === "square";

  return (
    <div className="flex flex-col gap-3 p-2.5 text-13">
      {/* --- Imagem do mapa ---------------------------------------------------------------- */}
      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <h4 className="flex items-center gap-1.5 font-title text-12 font-bold uppercase tracking-widest text-text-muted">
            <ImageIcon className="w-3.5 h-3.5" aria-hidden />
            Imagem
          </h4>
          {scene.mapUrl && (
            <button
              type="button"
              id="btn-map-image-remove"
              onClick={() => onSetMap({ mapUrl: null, mapWidth: null, mapHeight: null })}
              className="focus-ring flex items-center gap-1 px-1.5 py-0.5 rounded-ui text-12 text-text-muted hover:text-danger cursor-pointer"
            >
              <X className="w-3 h-3" />
              Remover
            </button>
          )}
        </div>
        <button
          type="button"
          id="btn-map-image-upload"
          onClick={() => !uploading && fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void processImageFile(f);
          }}
          className={`focus-ring flex items-center justify-center gap-2 rounded-ui border border-dashed border-border bg-bg/40 px-2 py-2.5 text-12 text-text-muted hover:border-accent hover:text-text cursor-pointer ${MOTION}`}
        >
          <Upload className="w-3.5 h-3.5" aria-hidden />
          {uploading ? "Enviando…" : scene.mapUrl ? "Trocar a imagem (clique ou arraste)" : "Enviar um mapa (PNG, JPG, WebP)"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png, image/jpeg, image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void processImageFile(f);
          }}
          className="hidden"
        />
        <span className="font-data text-12 text-text-muted">
          {scene.mapWidth ?? DEFAULT_MAP.width} × {scene.mapHeight ?? DEFAULT_MAP.height} px
        </span>
      </section>

      {/* --- Grid -------------------------------------------------------------------------- */}
      <section className="flex flex-col gap-2 pt-2 border-t border-border">
        <div className="flex items-center justify-between">
          <h4 className="font-title text-12 font-bold uppercase tracking-widest text-text-muted">Grid</h4>
          <button
            type="button"
            id="btn-toggle-grid-type"
            aria-pressed={gridOn}
            onClick={() => onUpdateGrid({ type: gridOn ? "none" : "square" })}
            className={`focus-ring flex items-center gap-1.5 h-7 px-2 rounded-ui border text-12 font-medium cursor-pointer ${MOTION} ${pressedClass(gridOn)}`}
          >
            {gridOn ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {gridOn ? "Quadrado" : "Sem grid"}
          </button>
        </div>

        <button
          type="button"
          id="btn-calibrate-grid"
          disabled={!scene.mapUrl}
          onClick={() => {
            if (!gridOn) onUpdateGrid({ type: "square" });
            setCalibratorOpen(true);
          }}
          title={scene.mapUrl ? "Arrastar um retângulo sobre uma célula do desenho" : "Envie uma imagem antes de calibrar"}
          className={`focus-ring flex items-center justify-center gap-1.5 h-8 px-2 rounded-ui border border-border bg-surface-1 hover:bg-surface-2 text-13 text-text cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${MOTION}`}
        >
          <Crosshair className="w-3.5 h-3.5 text-text-muted" />
          Calibrar pela imagem
        </button>

        <SliderField
          id="grid-cell-size"
          label="Tamanho da célula"
          value={cellSize}
          min={8}
          max={1000}
          sliderMin={20}
          sliderMax={200}
          onDraft={(v) => setDraft((d) => ({ ...d, cellSize: v }))}
          onCommit={(v) => {
            setDraft((d) => ({ ...d, cellSize: undefined }));
            onUpdateGrid({ cellSize: Math.max(8, Math.min(1000, round1(v))) });
          }}
        />
        <SliderField
          id="grid-offset-x"
          label="Deslocamento X"
          value={offsetX}
          sliderMin={0}
          sliderMax={Math.max(20, grid.cellSize)}
          onDraft={(v) => setDraft((d) => ({ ...d, offsetX: v }))}
          onCommit={(v) => {
            setDraft((d) => ({ ...d, offsetX: undefined }));
            onUpdateGrid({ offsetX: round1(v) });
          }}
        />
        <SliderField
          id="grid-offset-y"
          label="Deslocamento Y"
          value={offsetY}
          sliderMin={0}
          sliderMax={Math.max(20, grid.cellSize)}
          onDraft={(v) => setDraft((d) => ({ ...d, offsetY: v }))}
          onCommit={(v) => {
            setDraft((d) => ({ ...d, offsetY: undefined }));
            onUpdateGrid({ offsetY: round1(v) });
          }}
        />
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onUpdateGrid({ offsetX: 0, offsetY: 0 })}
            className="focus-ring px-1 rounded-ui font-data text-12 text-text-muted hover:text-text cursor-pointer"
          >
            Zerar deslocamentos
          </button>
        </div>

        {/* Cor + opacidade */}
        <div className="flex items-center justify-between pt-1">
          <h4 className="flex items-center gap-1.5 font-title text-12 font-bold uppercase tracking-widest text-text-muted">
            <Palette className="w-3.5 h-3.5" aria-hidden />
            Cor
          </h4>
          <input
            type="color"
            aria-label="Cor do grid"
            value={color.hex}
            onChange={(e) => onUpdateGrid({ color: toHex8(e.target.value, opacity) })}
            className="w-6 h-6 rounded-ui border border-border cursor-pointer bg-transparent"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {GRID_COLOR_PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              title={p.name}
              aria-label={p.name}
              aria-pressed={color.hex.toLowerCase() === p.hex}
              onClick={() => onUpdateGrid({ color: toHex8(p.hex, opacity) })}
              className={`focus-ring w-6 h-6 rounded-ui border cursor-pointer ${color.hex.toLowerCase() === p.hex ? "border-accent" : "border-border hover:border-text-muted"}`}
              style={{ backgroundColor: p.hex }}
            />
          ))}
        </div>
        <SliderField
          id="grid-opacity"
          label="Opacidade"
          value={Math.round(opacity * 100)}
          sliderMin={5}
          sliderMax={100}
          suffix="%"
          onDraft={(v) => setDraft((d) => ({ ...d, opacity: v / 100 }))}
          onCommit={(v) => {
            setDraft((d) => ({ ...d, opacity: undefined }));
            onUpdateGrid({ color: toHex8(color.hex, v / 100) });
          }}
        />

        <label className="flex items-center justify-between gap-2 pt-1 cursor-pointer">
          <span className="flex items-center gap-1.5 text-13 text-text">
            <Magnet className="w-3.5 h-3.5 text-text-muted" aria-hidden />
            Alinhar tokens ao soltar
          </span>
          <input id="toggle-snap-inline" type="checkbox" checked={grid.snap} onChange={(e) => onUpdateGrid({ snap: e.target.checked })} className="w-4 h-4 accent-text cursor-pointer" />
        </label>
      </section>

      {/* --- Escala ------------------------------------------------------------------------ */}
      {systemDef?.grid && (
        <section className="flex flex-col gap-1.5 pt-2 border-t border-border">
          <h4 className="font-title text-12 font-bold uppercase tracking-widest text-text-muted">Escala (1 célula)</h4>
          <div className="flex items-center gap-1.5 flex-wrap">
            {SCALE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                aria-pressed={Math.abs(scaleValue - p.value) < 0.001 && scaleUnit === p.unit}
                onClick={() => onUpdateGrid({ unitsPerCell: p.value, unit: p.unit })}
                className={`focus-ring h-7 px-2 rounded-ui border font-data text-12 cursor-pointer ${MOTION} ${pressedClass(Math.abs(scaleValue - p.value) < 0.001 && scaleUnit === p.unit)}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={0.01}
              step={0.1}
              aria-label="Valor da escala"
              defaultValue={scaleValue}
              key={`scale-${scene.id}-${scaleValue}`}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              onBlur={(e) => onUpdateGrid({ unitsPerCell: Math.max(0.01, round1(Number(e.target.value) || scaleValue)) })}
              className="focus-ring w-16 rounded-ui border border-border bg-bg px-2 py-0.5 text-right font-data text-12 text-text"
            />
            <input
              type="text"
              maxLength={8}
              aria-label="Unidade da escala"
              defaultValue={scaleUnit}
              key={`unit-${scene.id}-${scaleUnit}`}
              placeholder={systemDef.grid.unit}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              onBlur={(e) => onUpdateGrid({ unit: (e.target.value.trim() || systemDef.grid?.unit || "m").slice(0, 8) })}
              className="focus-ring w-16 rounded-ui border border-border bg-bg px-2 py-0.5 text-12 text-text"
            />
            <span className="text-12 text-text-muted">por célula</span>
          </div>
        </section>
      )}

      {calibratorOpen && (
        <GridCalibrator
          mapUrl={scene.mapUrl}
          mapWidth={scene.mapWidth ?? DEFAULT_MAP.width}
          mapHeight={scene.mapHeight ?? DEFAULT_MAP.height}
          initial={{ cellSize: grid.cellSize, offsetX: grid.offsetX, offsetY: grid.offsetY }}
          gridColor={grid.color}
          onApply={(result) => {
            // Sem "Salvar" intermediário (era assim no modal): aqui aplicar é o próprio resultado.
            onUpdateGrid({ type: "square", cellSize: result.cellSize, offsetX: result.offsetX, offsetY: result.offsetY });
            setCalibratorOpen(false);
          }}
          onClose={() => setCalibratorOpen(false)}
        />
      )}
    </div>
  );
};

/**
 * Número + slider de um valor contínuo. `onDraft` atualiza só o rascunho local (enquanto arrasta);
 * `onCommit` é quem emite pro servidor — ao soltar o mouse/teclado, ou ao sair do campo de número.
 */
const SliderField: React.FC<{
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  sliderMin: number;
  sliderMax: number;
  suffix?: string;
  onDraft: (v: number) => void;
  onCommit: (v: number) => void;
}> = ({ id, label, value, min, max, sliderMin, sliderMax, suffix = "px", onDraft, onCommit }) => (
  <div className="flex flex-col gap-1">
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={`${id}-number`} className="text-13 text-text">
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          id={`${id}-number`}
          type="number"
          min={min}
          max={max}
          value={Math.round(value * 10) / 10}
          onChange={(e) => onDraft(Number(e.target.value))}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          onBlur={(e) => onCommit(Number(e.target.value))}
          className="focus-ring w-16 rounded-ui border border-border bg-bg px-2 py-0.5 text-right font-data text-12 text-text"
        />
        <span className="font-data text-12 text-text-muted">{suffix}</span>
      </div>
    </div>
    <input
      id={`${id}-range`}
      type="range"
      aria-label={label}
      min={sliderMin}
      max={sliderMax}
      value={Math.min(Math.max(value, sliderMin), sliderMax)}
      onChange={(e) => onDraft(Number(e.target.value))}
      onPointerUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
      onKeyUp={(e) => onCommit(Number((e.target as HTMLInputElement).value))}
      className="w-full accent-text cursor-pointer"
    />
  </div>
);
