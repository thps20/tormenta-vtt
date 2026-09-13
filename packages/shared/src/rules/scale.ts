import type { SystemGridDef } from "../schemas/system.js";

/**
 * Escala por mapa (docs/SPEC.md §3.2): os dois campos que `Scene.grid` pode sobrescrever do grid
 * do SISTEMA. `unitsPerCell` é o equivalente, por mapa, de `SystemGridDef.cellSize`; não confundir
 * com `GridConfig.cellSize`, que é pixels da imagem.
 */
export interface MapGridScale {
  unitsPerCell?: number;
  unit?: string;
}

/**
 * Aplica a escala do MAPA por cima do grid do SISTEMA: toda conta de célula → distância (régua,
 * gabaritos, orçamento de deslocamento) passa a usar o valor do mapa quando ele define um; sem
 * override, o sistema continua sendo o padrão (docs/SPEC.md §3.2). `diagonals` nunca muda por
 * mapa — é regra de contagem, não escala. Nenhuma função pura existente muda de assinatura: cada
 * call site só troca o `def`/`systemDef` que já tinha em mãos pelo resultado desta função antes de
 * chamá-las (measureDistance, stepCost, unitToPixels...).
 *
 * Sistema sem `grid`: devolve `def` como está (nada pra escalar — a régua/gabaritos/deslocamento já
 * ficam desligados nesse caso, com ou sem override do mapa). Sem nenhum override no mapa: devolve a
 * MESMA referência (identidade), pra não invalidar memos que dependem do resultado à toa.
 */
export function withMapScale<T extends { grid?: SystemGridDef }>(def: T, mapGrid: MapGridScale): T {
  if (!def.grid) return def;
  if (mapGrid.unitsPerCell === undefined && mapGrid.unit === undefined) return def;
  return { ...def, grid: { ...def.grid, cellSize: mapGrid.unitsPerCell ?? def.grid.cellSize, unit: mapGrid.unit ?? def.grid.unit } };
}
