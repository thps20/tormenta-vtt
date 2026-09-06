import type { DiagonalRule, SystemDefinition } from "../schemas/system.js";

/**
 * Medição de distância no grid (régua). Funções puras: recebem o deslocamento
 * em CÉLULAS (o web converte pixels → células com o cellSize da cena) e a
 * regra de diagonais vem do JSON do sistema, nunca do código.
 */

/** Quantas células "custa" um deslocamento de (dx, dy) células segundo a regra. */
export function measureCells(dx: number, dy: number, rule: DiagonalRule): number {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  switch (rule) {
    case "euclidean":
      return Math.sqrt(ax * ax + ay * ay);
    case "manhattan":
      return ax + ay;
    case "chebyshev":
      return Math.max(ax, ay);
    case "alternating": {
      // Cada passo diagonal alterna custo 1 e 2: o segundo, quarto... diagonal custa dobrado.
      const diagonals = Math.min(ax, ay);
      return Math.max(ax, ay) + Math.floor(diagonals / 2);
    }
  }
}

export interface Distance {
  /** Células contadas pela regra do sistema. */
  cells: number;
  /** Distância na unidade do jogo (cells × grid.cellSize). null se o sistema não declara `grid`. */
  value: number | null;
  unit: string | null;
}

/** Distância de (dx, dy) células conforme o `grid` do sistema. Sem `grid`, usa a regra chebyshev e devolve só as células. */
export function measureDistance(def: Pick<SystemDefinition, "grid">, dx: number, dy: number): Distance {
  const grid = def.grid;
  const cells = measureCells(dx, dy, grid?.diagonals ?? "chebyshev");
  if (!grid) return { cells, value: null, unit: null };
  return { cells, value: cells * grid.cellSize, unit: grid.unit };
}
