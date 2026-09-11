/**
 * Calibrar o grid pela imagem (docs/plano-grid.md, Parte B): o Mestre arrasta um retângulo sobre
 * uma (ou N) célula(s) do desenho e o app calcula `cellSize`/`offsetX`/`offsetY`. Função pura, sem
 * canvas nem React — fácil de testar; o componente (`GridCalibrator.tsx`) só resolve pixel de tela
 * -> pixel do mapa e chama isto.
 */
import { normalizeOffset } from "./grid";

/** Arredonda pra 1 casa decimal (mesma precisão de `GridConfigSchema.cellSize/offsetX/offsetY`). */
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

export interface CalibrationResult {
  cellSize: number;
  offsetX: number;
  offsetY: number;
}

/**
 * `rect` é o retângulo arrastado, em PIXELS DO MAPA (canto superior esquerdo + lado — sempre
 * quadrado, o componente já força isso no arrasto). `cellsCovered` é quantas células esse
 * retângulo cobre (1, ou mais pra ganhar precisão arrastando sobre várias). `cellSize` é sempre o
 * lado de UMA célula: `rect.side / cellsCovered`. `offsetX/Y` são o canto do retângulo módulo o
 * `cellSize` novo, normalizado pra `[0, cellSize)` (mesma convenção de `normalizeOffset`) — assim o
 * grid final passa exatamente pelas bordas da célula que o Mestre mirou, não importa onde na
 * imagem ela estava. Resultado grudado em `[8, 1000]` (mesmo limite de `GridConfigSchema.cellSize`).
 */
export function calibrateFromRect(rect: { x: number; y: number; side: number }, cellsCovered: number): CalibrationResult {
  const cellSize = Math.max(8, Math.min(1000, round1(rect.side / cellsCovered)));
  return {
    cellSize,
    offsetX: round1(normalizeOffset(rect.x, cellSize)),
    offsetY: round1(normalizeOffset(rect.y, cellSize)),
  };
}
