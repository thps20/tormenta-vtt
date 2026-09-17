import React, { useState } from "react";
import { Minus, Plus, Ruler, X } from "lucide-react";
import { pxPerCmFromRuler, pxPerCmFromWidth, type TabletopPrefs } from "@tormenta-vtt/shared";
import { FLOAT_SURFACE, MOTION } from "../MapBar";

interface CalibrationPanelProps {
  prefs: TabletopPrefs;
  onChange: (next: TabletopPrefs) => void;
  onClose: () => void;
  screenSize: { width: number; height: number };
}

const ROTATIONS = [0, 90, 180, 270] as const;
const CORNERS: { key: TabletopPrefs["turnIndicatorCorner"]; label: string }[] = [
  { key: "top-left", label: "Superior esq." },
  { key: "top-right", label: "Superior dir." },
  { key: "bottom-left", label: "Inferior esq." },
  { key: "bottom-right", label: "Inferior dir." },
  { key: "off", label: "Desligado" },
];

const inputClass = "w-20 bg-surface-2 border border-border rounded-ui px-2 py-1 text-12 text-text font-data tabular-nums";
const sectionLabel = "text-11 font-ui font-semibold text-text-muted uppercase tracking-wide";

/**
 * Painel de calibração da tela de exibição (docs/plano-cast.md §3.3) — só existe aqui, nunca no
 * cliente normal. Preferência 100% LOCAL desta tela (`lib/tabletopPrefs.ts`), guardada a cada
 * mudança por quem monta (`DisplayPage`). Um canto discreto ou a tecla C abrem/fecham.
 */
export const CalibrationPanel: React.FC<CalibrationPanelProps> = ({ prefs, onChange, onClose, screenSize }) => {
  const [widthCm, setWidthCm] = useState(() => (prefs.pxPerCm > 0 ? Math.round(screenSize.width / prefs.pxPerCm) : 96));
  const [rulerCm, setRulerCm] = useState(30);
  const [measuring, setMeasuring] = useState(false);
  const [handles, setHandles] = useState<[{ x: number; y: number }, { x: number; y: number }]>([
    { x: screenSize.width / 2 - 150, y: screenSize.height / 2 },
    { x: screenSize.width / 2 + 150, y: screenSize.height / 2 },
  ]);
  const [draggingHandle, setDraggingHandle] = useState<0 | 1 | null>(null);

  const set = <K extends keyof TabletopPrefs>(key: K, value: TabletopPrefs[K]) => onChange({ ...prefs, [key]: value });

  const applyWidthCm = () => {
    if (widthCm > 0) set("pxPerCm", pxPerCmFromWidth(screenSize.width, widthCm));
  };
  const applyRuler = () => {
    if (rulerCm > 0) set("pxPerCm", pxPerCmFromRuler(handles[0], handles[1], rulerCm));
  };

  const nudge = (axis: "offsetX" | "offsetY", delta: number) => set(axis, prefs[axis] + delta);

  return (
    <>
      {measuring && (
        <div className="absolute inset-0 z-[210]">
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            <line x1={handles[0].x} y1={handles[0].y} x2={handles[1].x} y2={handles[1].y} stroke="#d4af37" strokeWidth={2} strokeDasharray="6 4" />
          </svg>
          {handles.map((h, i) => (
            <div
              key={i}
              className="absolute w-6 h-6 -ml-3 -mt-3 rounded-full bg-[#d4af37] border-2 border-black cursor-grab active:cursor-grabbing"
              style={{ left: h.x, top: h.y }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setDraggingHandle(i as 0 | 1);
              }}
              onPointerMove={(e) => {
                if (draggingHandle !== i) return;
                setHandles((prev) => {
                  const next = [...prev] as typeof prev;
                  next[i] = { x: e.clientX, y: e.clientY };
                  return next;
                });
              }}
              onPointerUp={() => setDraggingHandle(null)}
            />
          ))}
        </div>
      )}

      <div className={`absolute bottom-16 right-4 z-[220] w-72 p-3 flex flex-col gap-3 ${FLOAT_SURFACE} bg-surface-1`}>
        <div className="flex items-center justify-between">
          <span className="font-serif font-bold text-13 text-text">Calibração (tecla C)</span>
          <button type="button" onClick={onClose} className={`p-1 rounded-ui hover:bg-surface-2 text-text-muted hover:text-text cursor-pointer ${MOTION}`}>
            <X className="w-4 h-4" />
          </button>
        </div>

        <label className="flex items-center justify-between gap-2 text-12 text-text cursor-pointer">
          Modo mesa física
          <input type="checkbox" checked={prefs.enabled} onChange={(e) => set("enabled", e.target.checked)} className="cursor-pointer" />
        </label>

        {prefs.enabled && (
          <>
            <div className="flex flex-col gap-1.5 border-t border-border pt-2">
              <span className={sectionLabel}>Escala da projeção</span>
              <div className="flex items-center gap-1.5">
                <span className="text-12 text-text-muted flex-1">Largura total (cm)</span>
                <input
                  type="number"
                  min={1}
                  value={widthCm}
                  onChange={(e) => setWidthCm(Number(e.target.value))}
                  onBlur={applyWidthCm}
                  className={inputClass}
                />
              </div>
              <button
                type="button"
                onClick={() => setMeasuring((v) => !v)}
                className={`flex items-center justify-center gap-1.5 h-7 rounded-ui border border-border text-12 font-medium cursor-pointer ${MOTION} ${measuring ? "bg-[#2d2417] border-[#d4af37] text-[#d4af37]" : "bg-surface-2 text-text hover:border-text-muted"}`}
              >
                <Ruler className="w-3.5 h-3.5" />
                {measuring ? "Arraste as alças sobre a fita" : "Medir com régua"}
              </button>
              {measuring && (
                <div className="flex items-center gap-1.5">
                  <span className="text-12 text-text-muted flex-1">Distância entre alças (cm)</span>
                  <input
                    type="number"
                    min={1}
                    value={rulerCm}
                    onChange={(e) => setRulerCm(Number(e.target.value))}
                    onBlur={applyRuler}
                    className={inputClass}
                  />
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <span className="text-12 text-text-muted flex-1">Tamanho da célula (cm)</span>
                <input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={prefs.cellCm}
                  onChange={(e) => set("cellCm", Number(e.target.value))}
                  className={inputClass}
                />
              </div>
              {/* Quadrado de teste de 10cm (docs/plano-cast.md §3.3 item 4): confere com a régua real. */}
              {prefs.pxPerCm > 0 && (
                <div
                  className="border-2 border-[#d4af37] border-dashed"
                  style={{ width: prefs.pxPerCm * 10, height: prefs.pxPerCm * 10 }}
                  title="Quadrado de 10cm — confira com uma régua real"
                />
              )}
            </div>

            <div className="flex flex-col gap-1.5 border-t border-border pt-2">
              <span className={sectionLabel}>Rotação</span>
              <div className="flex gap-1">
                {ROTATIONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => set("rotation", r)}
                    className={`flex-1 h-7 rounded-ui border text-12 font-medium cursor-pointer ${MOTION} ${prefs.rotation === r ? "bg-[#2d2417] border-[#d4af37] text-[#d4af37]" : "bg-surface-2 border-border text-text hover:border-text-muted"}`}
                  >
                    {r}°
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1.5 border-t border-border pt-2">
              <span className={sectionLabel}>Ajuste fino (px de tela)</span>
              <div className="grid grid-cols-2 gap-1.5">
                {(
                  [
                    ["X", "offsetX", -1],
                    ["X", "offsetX", 1],
                    ["Y", "offsetY", -1],
                    ["Y", "offsetY", 1],
                  ] as const
                ).map(([axis, key, dir], i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => nudge(key, dir)}
                    className={`flex items-center justify-center gap-1 h-7 rounded-ui border border-border bg-surface-2 hover:border-text-muted text-12 text-text cursor-pointer ${MOTION}`}
                  >
                    {dir < 0 ? <Minus className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
                    {axis}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onChange({ ...prefs, offsetX: 0, offsetY: 0 })}
                className="text-11 text-text-muted hover:text-text underline self-start cursor-pointer"
              >
                Zerar offset
              </button>
            </div>
          </>
        )}

        <div className="flex flex-col gap-1.5 border-t border-border pt-2">
          <span className={sectionLabel}>Tamanho do texto</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.25}
            value={prefs.labelScale}
            onChange={(e) => set("labelScale", Number(e.target.value))}
            className="cursor-pointer"
          />
          <span className="text-11 text-text-muted font-data">{prefs.labelScale.toFixed(2)}×</span>
        </div>

        <div className="flex flex-col gap-1.5 border-t border-border pt-2">
          <span className={sectionLabel}>Indicador de turno</span>
          <select
            value={prefs.turnIndicatorCorner}
            onChange={(e) => set("turnIndicatorCorner", e.target.value as TabletopPrefs["turnIndicatorCorner"])}
            className="bg-surface-2 border border-border rounded-ui px-2 py-1 text-12 text-text cursor-pointer"
          >
            {CORNERS.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
};
