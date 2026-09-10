import type { DiagonalRule, SystemDefinition } from "../schemas/system.js";

/**
 * Medição de distância no grid (régua). Funções puras: recebem o deslocamento
 * em CÉLULAS (o web converte pixels → células com o cellSize da cena) e a
 * regra de diagonais vem do JSON do sistema, nunca do código.
 */

/** Custo de um passo de (dx, dy) células e quantas diagonais ele soma (regra 1-2-1). */
export interface StepMeasure {
  cells: number;
  diagonals: number;
}

/**
 * Custo de (dx, dy) células, sabendo quantas diagonais JÁ foram contadas antes no mesmo turno
 * (`diagonalsBefore`, regra 1-2-1 do d20): a regra "alternating" olha só o TOTAL de diagonais
 * andadas pra saber quais delas custam dobrado, então precisa desse acumulado — senão seis passos
 * diagonais avulsos de 1 célula custariam 6 células em vez de 9 (docs/plano-movimento.md §1.3).
 * Nas outras regras `diagonals` não é usado (devolvido só pra a chamada seguinte acumular certo,
 * caso o sistema troque de regra no meio do caminho — não acontece hoje, mas não custa ser exato).
 */
export function measureCellsFrom(dx: number, dy: number, rule: DiagonalRule, diagonalsBefore: number): StepMeasure {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const d = Math.min(ax, ay);
  switch (rule) {
    case "euclidean":
      return { cells: Math.sqrt(ax * ax + ay * ay), diagonals: diagonalsBefore + d };
    case "manhattan":
      return { cells: ax + ay, diagonals: diagonalsBefore + d };
    case "chebyshev":
      return { cells: Math.max(ax, ay), diagonals: diagonalsBefore + d };
    case "alternating": {
      // Cada passo diagonal alterna custo 1 e 2: o segundo, quarto... diagonal (contando desde o
      // início do turno) custa dobrado. floor(total/2) - floor(antes/2) isola só o QUE ESTE passo
      // acrescenta ao total de diagonais "caras" já pagas.
      const totalDiagonals = diagonalsBefore + d;
      const cells = Math.max(ax, ay) + Math.floor(totalDiagonals / 2) - Math.floor(diagonalsBefore / 2);
      return { cells, diagonals: totalDiagonals };
    }
  }
}

/** Quantas células "custa" um deslocamento de (dx, dy) células segundo a regra, sem histórico de
 *  diagonais anteriores (régua e gabaritos: cada medição é independente). */
export function measureCells(dx: number, dy: number, rule: DiagonalRule): number {
  return measureCellsFrom(dx, dy, rule, 0).cells;
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
