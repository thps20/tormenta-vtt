import React, { useEffect, useRef, useState } from "react";
import { Check, Crosshair, Minus, Plus, X } from "lucide-react";
import { assetUrl } from "../lib/api";
import { useImage } from "../lib/useImage";
import { calibrateFromRect } from "../lib/gridCalibration";
import { gridLines } from "../lib/grid";
import type { GridConfig } from "@tormenta-vtt/shared";

export interface GridCalibratorResult {
  cellSize: number;
  offsetX: number;
  offsetY: number;
}

interface GridCalibratorProps {
  mapUrl: string | null;
  mapWidth: number;
  mapHeight: number;
  initial: GridCalibratorResult;
  gridColor: string;
  onApply: (result: GridCalibratorResult) => void;
  onClose: () => void;
}

const CANVAS_W = 760;
const CANVAS_H = 480;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

/**
 * "Calibrar pela imagem" (docs/plano-grid.md, Parte B): arrastar um retângulo sobre UMA célula do
 * desenho (ou várias, pra ganhar precisão) calcula `cellSize`/`offsetX`/`offsetY`. Zoom livre
 * (roda do mouse) e pan (botão do meio ou Espaço+arrasto); prévia do grid ao vivo sobre a imagem;
 * ajuste fino por teclado (setas ±1px, Shift ±0,1px; +/- no cellSize). Só calibração manual — não
 * detecta grid desenhado na imagem (decisão do plano).
 */
export const GridCalibrator: React.FC<GridCalibratorProps> = ({ mapUrl, mapWidth, mapHeight, initial, gridColor, onApply, onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const image = useImage(assetUrl(mapUrl));

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [cellSize, setCellSize] = useState(initial.cellSize);
  const [offsetX, setOffsetX] = useState(initial.offsetX);
  const [offsetY, setOffsetY] = useState(initial.offsetY);
  const [cellsCovered, setCellsCovered] = useState(1);
  const [spaceHeld, setSpaceHeld] = useState(false);

  const dragRef = useRef<{ startMap: { x: number; y: number } } | null>(null);
  const panRef = useRef<{ startScreen: { x: number; y: number }; startPan: { x: number; y: number } } | null>(null);
  const [dragRect, setDragRect] = useState<{ x: number; y: number; side: number } | null>(null);

  // Ajusta zoom/pan pra caber o mapa inteiro na primeira renderização.
  useEffect(() => {
    const fit = Math.min(CANVAS_W / mapWidth, CANVAS_H / mapHeight) * 0.92;
    setZoom(fit);
    setPan({ x: (CANVAS_W - mapWidth * fit) / 2, y: (CANVAS_H - mapHeight * fit) / 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapWidth, mapHeight]);

  const mapToScreen = (p: { x: number; y: number }) => ({ x: p.x * zoom + pan.x, y: p.y * zoom + pan.y });
  const screenToMap = (p: { x: number; y: number }) => ({ x: (p.x - pan.x) / zoom, y: (p.y - pan.y) / zoom });

  const pointerPos = (e: React.MouseEvent | MouseEvent): { x: number; y: number } | null => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // --- Desenho: imagem (ou fundo escuro) -> grid de prévia -> retângulo de calibração em andamento.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);
    if (image) ctx.drawImage(image, 0, 0, mapWidth, mapHeight);
    else {
      ctx.fillStyle = "#121212";
      ctx.fillRect(0, 0, mapWidth, mapHeight);
    }
    ctx.restore();

    const grid: GridConfig = { type: "square", cellSize, offsetX, offsetY, color: gridColor, snap: true };
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of gridLines(grid, { width: mapWidth, height: mapHeight })) {
      const p1 = mapToScreen({ x: x1 ?? 0, y: y1 ?? 0 });
      const p2 = mapToScreen({ x: x2 ?? 0, y: y2 ?? 0 });
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();

    if (dragRect) {
      const topLeft = mapToScreen({ x: dragRect.x, y: dragRect.y });
      const side = dragRect.side * zoom;
      ctx.strokeStyle = "#d4af37";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(topLeft.x, topLeft.y, side, side);
      ctx.setLineDash([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, zoom, pan, cellSize, offsetX, offsetY, gridColor, dragRect, mapWidth, mapHeight]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const p = pointerPos(e);
    if (!p) return;
    const before = screenToMap(p);
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    setZoom(next);
    setPan({ x: p.x - before.x * next, y: p.y - before.y * next });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const p = pointerPos(e);
    if (!p) return;
    if (e.button === 1 || spaceHeld) {
      panRef.current = { startScreen: p, startPan: pan };
      return;
    }
    if (e.button !== 0) return;
    dragRef.current = { startMap: screenToMap(p) };
    setDragRect({ x: screenToMap(p).x, y: screenToMap(p).y, side: 0 });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const p = pointerPos(e);
    if (!p) return;
    if (panRef.current) {
      const dx = p.x - panRef.current.startScreen.x;
      const dy = p.y - panRef.current.startScreen.y;
      setPan({ x: panRef.current.startPan.x + dx, y: panRef.current.startPan.y + dy });
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    const cur = screenToMap(p);
    // Sempre quadrado: o lado é o maior deslocamento, seguindo o sentido do arrasto.
    const dx = cur.x - drag.startMap.x;
    const dy = cur.y - drag.startMap.y;
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    setDragRect({ x: dx < 0 ? drag.startMap.x - side : drag.startMap.x, y: dy < 0 ? drag.startMap.y - side : drag.startMap.y, side });
  };

  const finishDrag = () => {
    panRef.current = null;
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !dragRect || dragRect.side < 4) {
      setDragRect(null);
      return;
    }
    const result = calibrateFromRect(dragRect, Math.max(1, cellsCovered));
    setCellSize(result.cellSize);
    setOffsetX(result.offsetX);
    setOffsetY(result.offsetY);
    setDragRect(null);
  };

  // Espaço segura pan (mesmo padrão do VttCanvas); setas fazem o ajuste fino quando não é um campo de texto.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement;
      if (e.code === "Space" && !typing) {
        e.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (typing) return;
      const fine = e.shiftKey ? 0.1 : 1;
      if (e.key === "ArrowLeft") { e.preventDefault(); setOffsetX((v) => round1(v - fine)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setOffsetX((v) => round1(v + fine)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setOffsetY((v) => round1(v - fine)); }
      else if (e.key === "ArrowDown") { e.preventDefault(); setOffsetY((v) => round1(v + fine)); }
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); setCellSize((v) => clampCell(round1(v + fine))); }
      else if (e.key === "-") { e.preventDefault(); setCellSize((v) => clampCell(round1(v - fine))); }
      else if (e.key === "Escape") onClose();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const numberInput = "w-20 bg-[#141414] border border-[#2d2417] rounded px-2 py-1 text-right font-mono text-xs text-zinc-200 focus:outline-none focus:border-[#d4af37]";

  return (
    <div id="grid-calibrator-backdrop" className="fixed inset-0 z-[60] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-4xl bg-[#141414] border border-[#2d2417] rounded shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 bg-[#1a1a1a] border-b border-[#2d2417]">
          <div className="flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-[#d4af37]" />
            <h2 className="text-sm font-serif font-bold text-zinc-100">Calibrar grid pela imagem</h2>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100 p-1 rounded hover:bg-[#252525] cursor-pointer" title="Fechar (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3">
          <p className="text-[11px] text-zinc-400">
            Arraste sobre uma célula do desenho (o retângulo é sempre quadrado). Pra mais precisão, arraste sobre várias células e informe
            quantas em <strong className="text-zinc-300">&ldquo;Cobre N células&rdquo;</strong> antes de arrastar. Roda do mouse: zoom; Espaço + arrasto (ou botão do
            meio): mover a vista. Setas ajustam a posição do grid (±1px, Shift ±0,1px); +/- ajustam o tamanho da célula.
          </p>

          <div
            ref={containerRef}
            className="relative rounded border border-[#2d2417] bg-black overflow-hidden self-center"
            style={{ width: CANVAS_W, height: CANVAS_H, cursor: spaceHeld ? "grab" : "crosshair" }}
          >
            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={finishDrag}
              onMouseLeave={finishDrag}
            />
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
              Cobre N células
              <input
                type="number"
                min={1}
                max={20}
                value={cellsCovered}
                onChange={(e) => setCellsCovered(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
                className={numberInput}
              />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
              Tamanho da célula (px)
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setCellSize((v) => clampCell(round1(v - 1)))} className="p-1 rounded bg-[#1a1a1a] border border-[#2d2417] text-zinc-400 hover:text-[#d4af37] cursor-pointer">
                  <Minus className="w-3 h-3" />
                </button>
                <input type="number" step={0.1} min={8} max={1000} value={cellSize} onChange={(e) => setCellSize(clampCell(Number(e.target.value)))} className={numberInput} />
                <button type="button" onClick={() => setCellSize((v) => clampCell(round1(v + 1)))} className="p-1 rounded bg-[#1a1a1a] border border-[#2d2417] text-zinc-400 hover:text-[#d4af37] cursor-pointer">
                  <Plus className="w-3 h-3" />
                </button>
              </div>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
              Deslocamento X
              <input type="number" step={0.1} value={offsetX} onChange={(e) => setOffsetX(Number(e.target.value))} className={numberInput} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-zinc-400">
              Deslocamento Y
              <input type="number" step={0.1} value={offsetY} onChange={(e) => setOffsetY(Number(e.target.value))} className={numberInput} />
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-3 bg-[#1a1a1a] border-t border-[#2d2417]">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded bg-[#252525] hover:bg-[#2e2e2e] border border-[#3d3d3d] text-zinc-300 text-xs font-serif font-semibold cursor-pointer">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onApply({ cellSize, offsetX, offsetY })}
            className="px-5 py-2 rounded bg-[#d4af37] hover:bg-[#e0bc46] text-black font-serif font-bold text-xs tracking-wider uppercase flex items-center gap-1.5 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            Aplicar
          </button>
        </div>
      </div>
    </div>
  );
};

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function clampCell(v: number): number {
  return Math.max(8, Math.min(1000, v));
}
