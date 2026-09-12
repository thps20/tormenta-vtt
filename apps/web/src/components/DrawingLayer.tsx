import React from "react";
import { Arrow, Ellipse, Group, Line, Rect, Text } from "react-konva";
import { drawingBounds, type Drawing } from "@tormenta-vtt/shared";

const SELECTION_STROKE = "#d4af37";

/** `#rrggbb` -> `rgba(r, g, b, alpha)` — preenchimento translúcido das formas fechadas (o traço em
 *  si sempre usa a cor cheia; Konva/canvas aceitam rgba() direto, sem depender de hex de 8 dígitos). */
function fillWithAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Um traço vira o nó Konva certo pro `kind`. Só desenho (`listening={false}` no chamador) — clique/
 *  seleção/arrasto são geometria pura em VttCanvas, mesmo motivo de sempre neste projeto (canvas de
 *  hit do Konva embaralhado, docs/debug-condicoes.md). */
function DrawingShapeNode({ d }: { d: Drawing }) {
  switch (d.kind) {
    case "pen":
      return <Line points={d.points} stroke={d.color} strokeWidth={d.strokeWidth} lineCap="round" lineJoin="round" listening={false} />;
    case "line":
      return <Line points={[d.x1, d.y1, d.x2, d.y2]} stroke={d.color} strokeWidth={d.strokeWidth} lineCap="round" listening={false} />;
    case "arrow":
      return (
        <Arrow
          points={[d.x1, d.y1, d.x2, d.y2]}
          stroke={d.color}
          fill={d.color}
          strokeWidth={d.strokeWidth}
          pointerLength={Math.max(8, d.strokeWidth * 2.5)}
          pointerWidth={Math.max(8, d.strokeWidth * 2.5)}
          lineCap="round"
          listening={false}
        />
      );
    case "rect":
      return (
        <Rect
          x={d.x}
          y={d.y}
          width={d.width}
          height={d.height}
          stroke={d.color}
          strokeWidth={d.strokeWidth}
          fill={d.filled ? fillWithAlpha(d.color, 0.35) : undefined}
          listening={false}
        />
      );
    case "ellipse":
      return (
        <Ellipse
          x={d.cx}
          y={d.cy}
          radiusX={d.rx}
          radiusY={d.ry}
          stroke={d.color}
          strokeWidth={d.strokeWidth}
          fill={d.filled ? fillWithAlpha(d.color, 0.35) : undefined}
          listening={false}
        />
      );
    case "text":
      return <Text x={d.x} y={d.y} text={d.text} fontSize={Math.max(10, d.strokeWidth * 2)} fill={d.color} listening={false} />;
  }
}

export interface DrawingLayerProps {
  drawings: Drawing[];
  /** Rascunho ao vivo, ainda não confirmado (mousemove antes do mouseup) — mesmo papel do `draft` de TemplateLayer. */
  draft: Drawing | null;
  selectedId: string | null;
  /** Alças de redimensionar do traço selecionado (vazio pra `pen`, que só move/apaga — SPEC §9.17). */
  resizeHandlePoints: Array<{ x: number; y: number }>;
  stageScale: number;
}

/** Desenho livre no mapa (SPEC §9.17): traços de verdade + rascunho em andamento + halo/alças do
 *  selecionado. Renderizado ABAIXO de qualquer token (a camada inteira entra antes das de token em
 *  VttCanvas) — um traço grosso nunca disputa o clique com um token por cima dele. */
export const DrawingLayer: React.FC<DrawingLayerProps> = ({ drawings, draft, selectedId, resizeHandlePoints, stageScale }) => (
  <>
    {drawings.map((d) => {
      const selected = d.id === selectedId;
      const bounds = selected ? drawingBounds(d) : null;
      return (
        <Group key={d.id}>
          <DrawingShapeNode d={d} />
          {bounds && (
            <Rect
              x={bounds.minX - 4 / stageScale}
              y={bounds.minY - 4 / stageScale}
              width={bounds.maxX - bounds.minX + 8 / stageScale}
              height={bounds.maxY - bounds.minY + 8 / stageScale}
              stroke={SELECTION_STROKE}
              strokeWidth={1.5 / stageScale}
              dash={[4 / stageScale, 3 / stageScale]}
              listening={false}
            />
          )}
        </Group>
      );
    })}
    {draft && <DrawingShapeNode d={draft} />}
    {selectedId &&
      resizeHandlePoints.map((p, i) => (
        <Rect
          key={i}
          x={p.x - 4 / stageScale}
          y={p.y - 4 / stageScale}
          width={8 / stageScale}
          height={8 / stageScale}
          fill="#101418"
          stroke={SELECTION_STROKE}
          strokeWidth={1.5 / stageScale}
          listening={false}
        />
      ))}
  </>
);
