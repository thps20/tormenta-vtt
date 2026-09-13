import React from "react";
import { Shape } from "react-konva";
import type { GridConfig } from "@tormenta-vtt/shared";
import { normalizeOffset } from "../lib/grid";
import type { ResolvedGridAppearance } from "../lib/gridAppearance";

interface GridLayerProps {
  grid: GridConfig;
  map: { width: number; height: number };
  appearance: ResolvedGridAppearance;
  /** Retângulo visível do MAPA (pixels do mapa, não de tela) — calculado pelo `VttCanvas` a partir
   *  de pan/zoom atuais. */
  viewport: { x: number; y: number; width: number; height: number };
  stageScale: number;
}

/**
 * Desenha o grid (docs/SPEC.md §9.21) num único nó Konva com `sceneFunc` de canvas puro, em vez de
 * uma `<Line>` por linha (ou um nó por marca, no estilo "cruzamentos") — um mapa grande com célula
 * pequena vira facilmente milhares de nós Konva, cada um com custo próprio de reconciliação e
 * hit-graph, mesmo com `listening={false}`. Só a faixa visível (`viewport`) entra no laço de
 * desenho, então o custo fica proporcional à TELA, não ao mapa inteiro.
 */
export const GridLayer: React.FC<GridLayerProps> = ({ grid, map, appearance, viewport, stageScale }) => {
  if (!appearance.visible || grid.type === "none") return null;

  const left = Math.max(0, viewport.x);
  const top = Math.max(0, viewport.y);
  const right = Math.min(map.width, viewport.x + viewport.width);
  const bottom = Math.min(map.height, viewport.y + viewport.height);
  if (right <= left || bottom <= top) return null;

  const { cellSize } = grid;
  const ox = normalizeOffset(grid.offsetX, cellSize);
  const oy = normalizeOffset(grid.offsetY, cellSize);
  // Primeira linha/coluna dentro (ou na borda) do retângulo visível — evita percorrer desde o canto
  // do mapa a cada frame quando o usuário deu zoom/pan pra longe da origem.
  const firstX = ox + Math.ceil((left - ox) / cellSize) * cellSize;
  const firstY = oy + Math.ceil((top - oy) / cellSize) * cellSize;

  return (
    <Shape
      listening={false}
      sceneFunc={(ctx) => {
        ctx.save();
        ctx.globalAlpha = appearance.opacity;
        ctx.strokeStyle = appearance.color;
        // Espessura constante em pixels de TELA: o Stage já escala o contexto por `stageScale`, então
        // dividir aqui cancela esse escalonamento (mesma convenção de outros traços de overlay do
        // canvas, ex. a caixa de seleção).
        ctx.lineWidth = appearance.thickness / stageScale;
        ctx.setLineDash(appearance.style === "dashed" ? [6 / stageScale, 5 / stageScale] : []);

        if (appearance.style === "crosses") {
          const half = Math.max(2, appearance.thickness * 1.5) / stageScale;
          for (let x = firstX; x <= right; x += cellSize) {
            for (let y = firstY; y <= bottom; y += cellSize) {
              ctx.beginPath();
              ctx.moveTo(x - half, y);
              ctx.lineTo(x + half, y);
              ctx.moveTo(x, y - half);
              ctx.lineTo(x, y + half);
              ctx.stroke();
            }
          }
        } else {
          for (let x = firstX; x <= right; x += cellSize) {
            ctx.beginPath();
            ctx.moveTo(x, top);
            ctx.lineTo(x, bottom);
            ctx.stroke();
          }
          for (let y = firstY; y <= bottom; y += cellSize) {
            ctx.beginPath();
            ctx.moveTo(left, y);
            ctx.lineTo(right, y);
            ctx.stroke();
          }
        }
        ctx.restore();
      }}
    />
  );
};
