import { convertSizeToCellSize, type CellRect, type GridConfig } from "@tormenta-vtt/shared";

/**
 * Conversões célula <-> pixel do lado do SERVIDOR (mesma conta de apps/web/src/lib/grid.ts, que o
 * servidor não pode importar — apps diferentes). Usadas só por compendium:spawn-creature: o
 * servidor é a fonte da verdade de onde uma criatura cai, então ele roda a MESMA espiral
 * (rules/placement.ts, findFreeCells) que o fantasma no cliente, a partir de scene.grid.
 */

/** Lado de uma célula em pixels: cellSize do grid, ou 70 (grid "none"), como o botão de novo token assume. */
export function effectiveCellSize(grid: GridConfig): number {
  return grid.type === "square" ? grid.cellSize : 70;
}

function normalizeOffset(offset: number, cellSize: number): number {
  return ((offset % cellSize) + cellSize) % cellSize;
}

function effectiveOffset(grid: GridConfig, size: number): { ox: number; oy: number } {
  if (grid.type === "none") return { ox: 0, oy: 0 };
  return { ox: normalizeOffset(grid.offsetX, size), oy: normalizeOffset(grid.offsetY, size) };
}

/** Célula (linha/coluna) que contém o ponto. */
export function cellAt(point: { x: number; y: number }, grid: GridConfig): { col: number; row: number } {
  const size = effectiveCellSize(grid);
  const { ox, oy } = effectiveOffset(grid, size);
  return { col: Math.floor((point.x - ox) / size), row: Math.floor((point.y - oy) / size) };
}

/** Canto superior esquerdo (pixels do mapa) de uma célula. */
export function cellToPoint(cell: { col: number; row: number }, grid: GridConfig): { x: number; y: number } {
  const size = effectiveCellSize(grid);
  const { ox, oy } = effectiveOffset(grid, size);
  return { x: cell.col * size + ox, y: cell.row * size + oy };
}

/** Retângulo em células ocupado por um token existente (pra findFreeCells não empilhar em cima). */
export function cellRect(token: { x: number; y: number; width: number }, grid: GridConfig): CellRect {
  const size = effectiveCellSize(grid);
  return { ...cellAt(token, grid), cells: Math.max(1, Math.round(token.width / size)) };
}

/**
 * Posição e tamanho (pixels) de um token depois de uma troca de grid na MESMA cena
 * (`scene:updateGrid`, docs/plano-mapas.md): mantém a mesma célula (col/row, recalculada com o
 * grid novo) e o mesmo número de células de lado (`convertSizeToCellSize`, packages/shared) — sem
 * isso, mudar `cellSize`/offset deixaria os tokens existentes menores/maiores que a célula nova, ou
 * desalinhados dela. Devolve o MESMO objeto de entrada (mesma referência) quando nada muda — quem
 * chama usa isso pra decidir se vale a pena escrever/emitir esse token.
 */
export function resnapToken<T extends { x: number; y: number; width: number; height: number }>(
  token: T,
  fromGrid: GridConfig,
  toGrid: GridConfig,
): T {
  const point = cellToPoint(cellAt(token, fromGrid), toGrid);
  const size = convertSizeToCellSize(token, effectiveCellSize(fromGrid), effectiveCellSize(toGrid));
  if (point.x === token.x && point.y === token.y && size.width === token.width && size.height === token.height) return token;
  return { ...token, ...point, ...size };
}
