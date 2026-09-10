import React from "react";
import { Circle, Group, Line, Rect, Text, Wedge } from "react-konva";
import type { Template } from "@tormenta-vtt/shared";

const RAD_TO_DEG = 180 / Math.PI;

const FILL = "rgba(212, 175, 55, 0.18)";
const FILL_SELECTED = "rgba(212, 175, 55, 0.32)";
const STROKE = "#d4af37";

export interface TemplateLayerProps {
  /** Gabaritos de verdade da cena (docs/plano-gabaritos.md). */
  templates: Template[];
  /** Preview durante a colocação (cone/linha ainda girando até o 2º clique). */
  draft: Template | null;
  selectedId: string | null;
  /** templateId -> quantos tokens estão dentro (rótulo "N alvos"). */
  targetCounts: Record<string, number>;
  /** Ponto do handle de rotação do selecionado (null = sem handle, ex.: círculo não gira). */
  rotateHandle: { x: number; y: number } | null;
  /** Tokens a destacar (dentro de algum gabarito), já em pixels do mapa. */
  highlightedTokens: Array<{ id: string; x: number; y: number; width: number; height: number }>;
  stageScale: number;
}

/** Ponto de referência do rótulo "N alvos": centro (círculo/quadrado) ou meio do eixo (cone/linha). */
function labelPoint(t: Template): { x: number; y: number } {
  if (t.shape === "circle" || t.shape === "square") return { x: t.x, y: t.y };
  return { x: t.x + Math.cos(t.rotation) * (t.length / 2), y: t.y + Math.sin(t.rotation) * (t.length / 2) };
}

function TemplateShapeNode({ t, selected, stageScale }: { t: Template; selected: boolean; stageScale: number }) {
  const fill = selected ? FILL_SELECTED : FILL;
  const strokeWidth = (selected ? 2.5 : 1.5) / stageScale;
  const common = { fill, stroke: STROKE, strokeWidth, listening: false as const };
  switch (t.shape) {
    case "circle":
      return <Circle x={t.x} y={t.y} radius={t.r} {...common} />;
    case "square":
      return (
        <Rect
          x={t.x}
          y={t.y}
          width={t.side}
          height={t.side}
          offsetX={t.side / 2}
          offsetY={t.side / 2}
          rotation={t.rotation * RAD_TO_DEG}
          {...common}
        />
      );
    case "line":
      return <Rect x={t.x} y={t.y} width={t.length} height={t.width} offsetY={t.width / 2} rotation={t.rotation * RAD_TO_DEG} {...common} />;
    case "cone":
      return <Wedge x={t.x} y={t.y} radius={t.length} angle={t.angle} rotation={t.rotation * RAD_TO_DEG - t.angle / 2} {...common} />;
  }
}

/** Gabaritos de área de efeito: shapes + rótulo de alvos + handle de rotação + destaque nos tokens
 *  atingidos. Só desenho (`listening={false}`) — toda interação é feita por geometria em VttCanvas
 *  (mesmo motivo de sempre neste projeto: canvas de hit do Konva embaralhado, docs/debug-condicoes.md). */
export const TemplateLayer: React.FC<TemplateLayerProps> = ({ templates, draft, selectedId, targetCounts, rotateHandle, highlightedTokens, stageScale }) => (
  <>
    {templates.map((t) => (
      <Group key={t.id}>
        <TemplateShapeNode t={t} selected={t.id === selectedId} stageScale={stageScale} />
        {(targetCounts[t.id] ?? 0) > 0 && (
          <Group x={labelPoint(t).x} y={labelPoint(t).y} scaleX={1 / stageScale} scaleY={1 / stageScale} listening={false}>
            <Text
              text={`${targetCounts[t.id]} ${targetCounts[t.id] === 1 ? "alvo" : "alvos"}`}
              fontSize={12}
              fontStyle="bold"
              fill="#fff8e1"
              offsetX={20}
              offsetY={6}
              shadowColor="#000"
              shadowBlur={3}
              shadowOpacity={0.9}
            />
          </Group>
        )}
      </Group>
    ))}
    {draft && <TemplateShapeNode t={draft} selected={false} stageScale={stageScale} />}
    {rotateHandle &&
      selectedId &&
      (() => {
        const t = templates.find((x) => x.id === selectedId);
        if (!t) return null;
        return (
          <Group listening={false}>
            <Line points={[t.x, t.y, rotateHandle.x, rotateHandle.y]} stroke={STROKE} strokeWidth={1 / stageScale} dash={[4 / stageScale, 3 / stageScale]} />
            <Circle x={rotateHandle.x} y={rotateHandle.y} radius={6 / stageScale} fill="#101418" stroke={STROKE} strokeWidth={2 / stageScale} />
          </Group>
        );
      })()}
    {highlightedTokens.map((tk) => (
      <Circle
        key={tk.id}
        x={tk.x + tk.width / 2}
        y={tk.y + tk.height / 2}
        radius={Math.min(tk.width, tk.height) / 2 + 4 / stageScale}
        stroke="#f87171"
        strokeWidth={2.5 / stageScale}
        listening={false}
      />
    ))}
  </>
);
