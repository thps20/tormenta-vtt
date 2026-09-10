import React from "react";
import { Circle, Group, Line, Rect, Text, Wedge } from "react-konva";
import type { Template } from "@tormenta-vtt/shared";
import { templateIsDiagonalLine, templateIsSolidBlock } from "../lib/templates";

const RAD_TO_DEG = 180 / Math.PI;

const FILL = "rgba(212, 175, 55, 0.18)";
const FILL_SELECTED = "rgba(212, 175, 55, 0.32)";
const STROKE = "#d4af37";
const CELL_FILL = "rgba(212, 175, 55, 0.12)";

export interface TemplateLayerProps {
  /** Gabaritos de verdade da cena (docs/plano-gabaritos.md). */
  templates: Template[];
  /** Preview durante o clique-e-arrasto de criar (docs/plano-gabaritos.md §5). */
  draft: Template | null;
  /** Tamanho + contagem de alvos ao vivo, perto do rascunho ("6 m • 2 alvos"). */
  draftLabel: string | null;
  selectedId: string | null;
  /** templateId -> quantos tokens estão dentro (rótulo "N alvos"). */
  targetCounts: Record<string, number>;
  /** Ponto do handle de rotação do selecionado (null = sem handle, ex.: círculo não gira). */
  rotateHandle: { x: number; y: number } | null;
  /** Tokens a destacar (dentro de algum gabarito), já em pixels do mapa. */
  highlightedTokens: Array<{ id: string; x: number; y: number; width: number; height: number }>;
  /** Cantos das células cobertas por cada gabarito (docs/plano-gabaritos.md §5) — vazio com grid "none". */
  coveredCellsById: Record<string, Array<{ x: number; y: number }>>;
  /** Idem, do rascunho em andamento. */
  draftCoveredCells: Array<{ x: number; y: number }>;
  /** Lado da célula em pixels (mesmo valor pras duas listas acima). */
  cellSize: number;
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

/** Preenchimento por célula translúcido (overlay de círculo/cone, docs/plano-gabaritos.md §5) — mais
 *  fraco que o contorno geométrico pra não competir com ele visualmente, só reforça qual célula
 *  "conta" de verdade (regra do centro), o mesmo resultado que `tokensInTemplate` usa. */
function CellFill({ cells, cellSize }: { cells: Array<{ x: number; y: number }>; cellSize: number }) {
  return (
    <>
      {cells.map((c) => (
        <Rect key={`${c.x}:${c.y}`} x={c.x} y={c.y} width={cellSize} height={cellSize} fill={CELL_FILL} listening={false} />
      ))}
    </>
  );
}

/**
 * Linha diagonal ancorada em célula (a escada, docs/plano-gabaritos.md §8/§9): cada célula só toca
 * a vizinha por um CANTO, nunca por uma aresta inteira — então elas não têm fronteira compartilhada
 * pra remover; desenhar cada uma com seu próprio contorno JÁ é o contorno externo certo da escada
 * (sem retângulo geométrico girado por cima, que cortaria os degraus em vez de segui-los). Reusa
 * `coveredCells` (já é exatamente o conjunto de células da escada, por construção — ver
 * `newLineFromAnchorCell`, apps/web/src/lib/templates.ts).
 */
function CellBlock({ cells, cellSize, selected, stageScale }: { cells: Array<{ x: number; y: number }>; cellSize: number; selected: boolean; stageScale: number }) {
  const fill = selected ? FILL_SELECTED : FILL;
  const strokeWidth = (selected ? 2.5 : 1.5) / stageScale;
  return (
    <>
      {cells.map((c) => (
        <Rect key={`${c.x}:${c.y}`} x={c.x} y={c.y} width={cellSize} height={cellSize} fill={fill} stroke={STROKE} strokeWidth={strokeWidth} listening={false} />
      ))}
    </>
  );
}

/**
 * Corpo de um gabarito (docs/plano-gabaritos.md §9). Quadrado (sempre reto) e linha no EIXO (grid
 * ativo, múltiplo de 90°) são sempre um retângulo alinhado ao grid ponta a ponta — a forma lisa de
 * sempre (`TemplateShapeNode`) já É exatamente essa união de células, sem precisar desenhar célula
 * por célula (isso é o que criava a fronteira interna indesejada: cada célula com sua própria
 * borda, cortando a área ao meio). Sem overlay de célula por cima aqui — seria a MESMA área
 * duplicada, não informação nova. Linha na DIAGONAL (§8): as células só se tocam por um canto —
 * `CellBlock` (cada célula com seu contorno) já é o contorno externo certo, sem nada pra "unir".
 * Círculo/cone (e uma linha livre, não alinhada ao grid) continuam com a forma lisa + o overlay
 * sutil de célula por cima, mostrando a discretização ao lado do contorno geométrico.
 */
function TemplateBody({
  t,
  selected,
  stageScale,
  coveredCells,
  cellSize,
}: {
  t: Template;
  selected: boolean;
  stageScale: number;
  coveredCells: Array<{ x: number; y: number }>;
  cellSize: number;
}) {
  if (templateIsDiagonalLine(t) && coveredCells.length > 0) {
    return <CellBlock cells={coveredCells} cellSize={cellSize} selected={selected} stageScale={stageScale} />;
  }
  if (templateIsSolidBlock(t)) {
    return <TemplateShapeNode t={t} selected={selected} stageScale={stageScale} />;
  }
  return (
    <>
      <CellFill cells={coveredCells} cellSize={cellSize} />
      <TemplateShapeNode t={t} selected={selected} stageScale={stageScale} />
    </>
  );
}

/** Gabaritos de área de efeito: shapes + preenchimento por célula + rótulo de alvos + handle de
 *  rotação + destaque nos tokens atingidos. Só desenho (`listening={false}`) — toda interação é
 *  feita por geometria em VttCanvas (mesmo motivo de sempre neste projeto: canvas de hit do Konva
 *  embaralhado, docs/debug-condicoes.md). */
export const TemplateLayer: React.FC<TemplateLayerProps> = ({
  templates,
  draft,
  draftLabel,
  selectedId,
  targetCounts,
  rotateHandle,
  highlightedTokens,
  coveredCellsById,
  draftCoveredCells,
  cellSize,
  stageScale,
}) => (
  <>
    {templates.map((t) => (
      <Group key={t.id}>
        <TemplateBody t={t} selected={t.id === selectedId} stageScale={stageScale} coveredCells={coveredCellsById[t.id] ?? []} cellSize={cellSize} />
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
    {draft && (
      <Group>
        <TemplateBody t={draft} selected={false} stageScale={stageScale} coveredCells={draftCoveredCells} cellSize={cellSize} />
        {draftLabel && (
          <Group x={labelPoint(draft).x} y={labelPoint(draft).y} scaleX={1 / stageScale} scaleY={1 / stageScale} listening={false}>
            <Text
              text={draftLabel}
              fontSize={12}
              fontStyle="bold"
              fill="#fff8e1"
              offsetX={30}
              offsetY={6}
              shadowColor="#000"
              shadowBlur={3}
              shadowOpacity={0.9}
            />
          </Group>
        )}
      </Group>
    )}
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
