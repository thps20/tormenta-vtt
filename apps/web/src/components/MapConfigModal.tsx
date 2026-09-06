import React, { useState, useEffect, useRef } from "react";
import { Settings, Upload, Image as ImageIcon, X, Check, RotateCcw, Sliders, Grid, Eye, EyeOff, Palette, Magnet } from "lucide-react";
import type { GridConfig, Scene } from "@tormenta-vtt/shared";
import { assetUrl, uploadImage } from "../lib/api";
import { normalizeOffset } from "../lib/grid";
import { useImage } from "../lib/useImage";
import { toast } from "../store/ui";
import { DEFAULT_MAP } from "./VttCanvas";

export interface MapConfigResult {
  map: { mapUrl: string | null; mapWidth: number | null; mapHeight: number | null };
  grid: GridConfig;
}

interface MapConfigModalProps {
  isOpen: boolean;
  scene: Scene;
  onSave: (result: MapConfigResult) => void;
  onClose: () => void;
}

const GRID_COLOR_PRESETS = [
  { name: "Ouro Antigo", hex: "#d4af37" },
  { name: "Pedra Sóbria", hex: "#78716c" },
  { name: "Branco Névoa", hex: "#ffffff" },
  { name: "Sombra Ébano", hex: "#000000" },
  { name: "Carmim Real", hex: "#dc2626" },
  { name: "Arcano Azul", hex: "#38bdf8" },
];

/** Cor + opacidade -> "#rrggbbaa" (formato usado no GridConfig; o Konva aceita). */
function toHex8(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex.slice(0, 7)}${a}`;
}

/** Lê "#rgb", "#rrggbb", "#rrggbbaa" ou "rgba(...)" -> { hex, opacity }. */
function parseColor(colorStr: string): { hex: string; opacity: number } {
  const fallback = { hex: "#d4af37", opacity: 0.35 };
  const rgba = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(colorStr);
  if (rgba) {
    const [, r = "0", g = "0", b = "0", a] = rgba;
    const toH = (v: string) => Number(v).toString(16).padStart(2, "0");
    return { hex: `#${toH(r)}${toH(g)}${toH(b)}`, opacity: a !== undefined ? Number(a) : 1 };
  }
  if (colorStr.startsWith("#")) {
    let h = colorStr.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    if (h.length === 6) return { hex: `#${h}`, opacity: 1 };
    if (h.length === 8) return { hex: `#${h.slice(0, 6)}`, opacity: parseInt(h.slice(6, 8), 16) / 255 };
  }
  return fallback;
}

/**
 * Modal do GM: imagem do mapa (upload real) + grid. Só chama onSave ao
 * confirmar; o pai emite scene:setMap e scene:updateGrid.
 */
export const MapConfigModal: React.FC<MapConfigModalProps> = ({ isOpen, scene, onSave, onClose }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const [mapUrl, setMapUrl] = useState<string | null>(scene.mapUrl);
  const [mapWidth, setMapWidth] = useState<number>(scene.mapWidth ?? DEFAULT_MAP.width);
  const [mapHeight, setMapHeight] = useState<number>(scene.mapHeight ?? DEFAULT_MAP.height);
  const [gridType, setGridType] = useState<GridConfig["type"]>(scene.grid.type);
  const [cellSize, setCellSize] = useState<number>(scene.grid.cellSize);
  const [offsetX, setOffsetX] = useState<number>(scene.grid.offsetX);
  const [offsetY, setOffsetY] = useState<number>(scene.grid.offsetY);
  const [gridHexColor, setGridHexColor] = useState<string>(parseColor(scene.grid.color).hex);
  const [gridOpacity, setGridOpacity] = useState<number>(parseColor(scene.grid.color).opacity);
  const [snap, setSnap] = useState<boolean>(scene.grid.snap);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const previewImage = useImage(assetUrl(mapUrl));

  // Recarrega o formulário a partir da cena sempre que o modal abre.
  useEffect(() => {
    if (!isOpen) return;
    setMapUrl(scene.mapUrl);
    setMapWidth(scene.mapWidth ?? DEFAULT_MAP.width);
    setMapHeight(scene.mapHeight ?? DEFAULT_MAP.height);
    setGridType(scene.grid.type);
    setCellSize(scene.grid.cellSize);
    setOffsetX(scene.grid.offsetX);
    setOffsetY(scene.grid.offsetY);
    const c = parseColor(scene.grid.color);
    setGridHexColor(c.hex);
    setGridOpacity(c.opacity);
    setSnap(scene.grid.snap);
  }, [isOpen, scene]);

  // Esc fecha.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const processImageFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      // Upload de verdade: o servidor devolve a URL e as dimensões.
      const res = await uploadImage(file);
      setMapUrl(res.url);
      setMapWidth(res.width);
      setMapHeight(res.height);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Falha no upload");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleRemoveImage = () => {
    setMapUrl(null);
    setMapWidth(DEFAULT_MAP.width);
    setMapHeight(DEFAULT_MAP.height);
  };

  // Preview: imagem (ou fundo escuro) + grid + token de exemplo.
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const cw = canvas.width;
    const ch = canvas.height;
    ctx.clearRect(0, 0, cw, ch);

    if (previewImage) ctx.drawImage(previewImage, 0, 0, cw, ch);
    else {
      ctx.fillStyle = "#121212";
      ctx.fillRect(0, 0, cw, ch);
      ctx.strokeStyle = "#2d2417";
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, cw - 2, ch - 2);
    }

    if (gridType !== "square" || cellSize <= 0) return;
    const scaleX = cw / mapWidth;
    const scaleY = ch / mapHeight;
    const cellW = cellSize * scaleX;
    const cellH = cellSize * scaleY;
    const ox = normalizeOffset(offsetX, cellSize) * scaleX;
    const oy = normalizeOffset(offsetY, cellSize) * scaleY;

    ctx.strokeStyle = toHex8(gridHexColor, gridOpacity);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ox; x <= cw; x += cellW) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ch);
    }
    for (let y = oy; y <= ch; y += cellH) {
      ctx.moveTo(0, y);
      ctx.lineTo(cw, y);
    }
    ctx.stroke();

    // Token de exemplo (1x1) para dar noção de escala.
    const cx = ox + cellW * 2.5;
    const cy = oy + cellH * 2.5;
    const radius = Math.min(cellW, cellH) * 0.42;
    if (cx + radius <= cw && cy + radius <= ch) {
      ctx.fillStyle = "#1a1a1a";
      ctx.strokeStyle = "#d4af37";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#d4af37";
      ctx.font = "bold 10px serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("1x1", cx, cy);
    }
  }, [previewImage, gridType, cellSize, offsetX, offsetY, gridHexColor, gridOpacity, mapWidth, mapHeight]);

  const handleSave = () => {
    onSave({
      map: { mapUrl, mapWidth: mapUrl ? mapWidth : null, mapHeight: mapUrl ? mapHeight : null },
      grid: {
        type: gridType,
        cellSize: Math.max(8, Math.min(1000, Math.round(cellSize))),
        offsetX: Math.round(offsetX),
        offsetY: Math.round(offsetY),
        color: toHex8(gridHexColor, gridOpacity),
        snap,
      },
    });
    onClose();
  };

  if (!isOpen) return null;

  const numberInput = "w-16 bg-[#141414] border border-[#2d2417] rounded px-2 py-0.5 text-right font-mono text-xs text-zinc-200 focus:outline-none focus:border-[#d4af37]";

  return (
    <div
      id="map-config-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div id="map-config-modal-dialog" className="w-full max-w-5xl bg-[#141414] border border-[#2d2417] rounded shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-[#1a1a1a] border-b border-[#2d2417] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded border border-[#d4af37] bg-[#252525] flex items-center justify-center text-[#d4af37]">
              <Settings className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-serif font-bold text-zinc-100 tracking-wide">Configurar Mapa e Grid</h2>
              <p className="text-[11px] text-zinc-400">Cena: {scene.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100 p-1.5 rounded hover:bg-[#252525] cursor-pointer" title="Fechar (Esc)">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Preview + upload */}
          <div className="lg:col-span-7 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-serif font-bold text-zinc-200">
                <Grid className="w-3.5 h-3.5 text-[#d4af37]" />
                <span>Preview do Grid</span>
              </div>
              <span className="text-[10px] font-mono text-zinc-400 bg-[#1a1a1a] px-2 py-0.5 rounded border border-[#2d2417]">
                {mapWidth} × {mapHeight} px
              </span>
            </div>

            <div className="relative rounded bg-[#0c0c0c] border border-[#2d2417] p-2 flex items-center justify-center overflow-hidden shadow-inner">
              <canvas ref={previewCanvasRef} width={560} height={Math.round((560 * mapHeight) / mapWidth) || 385} className="w-full h-auto max-h-[360px] object-contain rounded border border-[#1f1f1f] bg-black" />
              {gridType === "none" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none">
                  <span className="px-3 py-1.5 rounded bg-[#1a1a1a] border border-[#2d2417] text-xs font-serif text-zinc-300">Grid Oculto</span>
                </div>
              )}
            </div>

            <div className="mt-2 pt-3 border-t border-[#2d2417] space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-serif font-medium text-zinc-300 flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-[#d4af37]" />
                  Imagem do Mapa
                </label>
                {mapUrl && (
                  <button type="button" onClick={handleRemoveImage} className="text-[11px] text-zinc-400 hover:text-red-400 flex items-center gap-1 cursor-pointer">
                    <RotateCcw className="w-3 h-3" />
                    Remover imagem
                  </button>
                )}
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void processImageFile(f);
                }}
                onClick={() => !uploading && fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded p-3 text-center cursor-pointer transition-colors ${
                  isDragging ? "border-[#d4af37] bg-[#2d2417]/40" : "border-[#2d2417] hover:border-[#3d3d3d] bg-[#1a1a1a]/60"
                }`}
              >
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
                <div className="flex items-center justify-center gap-2">
                  <Upload className="w-4 h-4 text-[#d4af37]" />
                  <span className="text-xs font-serif text-zinc-200">
                    {uploading ? "Enviando…" : mapUrl ? "Clique para substituir a imagem" : "Clique ou arraste um mapa (PNG, JPG, WebP, máx. 20 MB)"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Controles */}
          <div className="lg:col-span-5 flex flex-col gap-4 bg-[#1a1a1a] border border-[#2d2417] p-4 rounded">
            <div className="flex items-center justify-between pb-2 border-b border-[#2d2417]">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#d4af37]" />
                <h3 className="text-xs font-serif font-bold text-zinc-100 uppercase tracking-wider">Grid</h3>
              </div>
              <button
                type="button"
                id="btn-toggle-grid-type"
                onClick={() => setGridType(gridType === "square" ? "none" : "square")}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-serif font-bold cursor-pointer border ${
                  gridType === "square" ? "bg-[#2d2417] text-[#d4af37] border-[#d4af37]/50" : "bg-[#252525] text-zinc-400 border-[#3d3d3d]"
                }`}
              >
                {gridType === "square" ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                <span>{gridType === "square" ? "Quadrado" : "Sem grid"}</span>
              </button>
            </div>

            <Field label="Tamanho da célula" value={cellSize} min={8} max={1000} onChange={setCellSize} inputClass={`${numberInput} text-[#d4af37]`} sliderMin={20} sliderMax={200} />
            <Field label="Deslocamento X" value={offsetX} onChange={setOffsetX} inputClass={numberInput} sliderMin={0} sliderMax={cellSize} />
            <Field label="Deslocamento Y" value={offsetY} onChange={setOffsetY} inputClass={numberInput} sliderMin={0} sliderMax={cellSize} />

            <div className="flex justify-end">
              <button type="button" onClick={() => (setOffsetX(0), setOffsetY(0))} className="text-[10px] font-mono text-zinc-400 hover:text-[#d4af37] cursor-pointer">
                Zerar deslocamentos
              </button>
            </div>

            <div className="space-y-1.5 pt-1 border-t border-[#2d2417]">
              <div className="flex items-center justify-between">
                <label className="text-xs font-serif font-medium text-zinc-300 flex items-center gap-1">
                  <Palette className="w-3.5 h-3.5 text-[#d4af37]" />
                  Cor do Grid
                </label>
                <div className="flex items-center gap-1.5">
                  <input type="color" value={gridHexColor} onChange={(e) => setGridHexColor(e.target.value)} className="w-6 h-6 rounded border border-[#2d2417] cursor-pointer bg-transparent" />
                  <span className="font-mono text-[11px] text-zinc-400 uppercase">{gridHexColor}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                {GRID_COLOR_PRESETS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    title={p.name}
                    onClick={() => setGridHexColor(p.hex)}
                    className={`w-6 h-6 rounded border cursor-pointer flex items-center justify-center ${
                      gridHexColor.toLowerCase() === p.hex ? "border-[#d4af37] scale-110" : "border-[#3d3d3d] hover:border-zinc-400"
                    }`}
                    style={{ backgroundColor: p.hex }}
                  >
                    {gridHexColor.toLowerCase() === p.hex && <Check className={`w-3 h-3 ${p.hex === "#ffffff" ? "text-black" : "text-white"}`} />}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-serif font-medium text-zinc-300">Opacidade</label>
                <span className="font-mono text-xs font-bold text-[#d4af37]">{Math.round(gridOpacity * 100)}%</span>
              </div>
              <input type="range" min={5} max={100} value={Math.round(gridOpacity * 100)} onChange={(e) => setGridOpacity(Number(e.target.value) / 100)} className="w-full accent-[#d4af37] cursor-pointer" />
            </div>

            <div className="pt-2 border-t border-[#2d2417] flex items-center justify-between">
              <label htmlFor="toggle-snap-modal" className="text-xs font-serif text-zinc-300 flex items-center gap-1.5 cursor-pointer">
                <Magnet className="w-3.5 h-3.5 text-[#d4af37]" />
                <span>Alinhar tokens ao soltar (snap)</span>
              </label>
              <input id="toggle-snap-modal" type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} className="w-4 h-4 accent-[#d4af37] cursor-pointer" />
            </div>
          </div>
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-end gap-3 px-5 py-3.5 bg-[#1a1a1a] border-t border-[#2d2417] shrink-0">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded bg-[#252525] hover:bg-[#2e2e2e] border border-[#3d3d3d] text-zinc-300 hover:text-zinc-100 text-xs font-serif font-semibold cursor-pointer">
            Cancelar
          </button>
          <button
            type="button"
            id="btn-save-map-config"
            onClick={handleSave}
            disabled={uploading}
            className="px-5 py-2 rounded bg-[#d4af37] hover:bg-[#e0bc46] text-black font-serif font-bold text-xs tracking-wider uppercase flex items-center gap-1.5 shadow-lg cursor-pointer disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
};

function Field({
  label,
  value,
  min,
  max,
  onChange,
  inputClass,
  sliderMin,
  sliderMax,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
  inputClass: string;
  sliderMin: number;
  sliderMax: number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-serif font-medium text-zinc-300">{label}:</label>
        <div className="flex items-center gap-1">
          <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className={inputClass} />
          <span className="text-xs text-zinc-500 font-mono">px</span>
        </div>
      </div>
      <input type="range" min={sliderMin} max={sliderMax} value={Math.min(Math.max(value, sliderMin), sliderMax)} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[#d4af37] cursor-pointer" />
    </div>
  );
}
