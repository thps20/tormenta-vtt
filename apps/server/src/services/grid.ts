import type { CellRect, FogConfig, GridConfig, Scene } from "@tormenta-vtt/shared";

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

/**
 * `fog` + o `cellSizePx` do mapa: junto é o que basta pra decidir se um token é visível (a régua
 * olha o CENTRO do token, que depende de `cells` — docs/plano-grid.md). Empacota os dois porque as
 * funções de visibilidade (`services/visibility.ts`, `broadcastToken`, `maybeReemitCombatForToken`)
 * antes recebiam só `fog`; com `cells` como fonte do tamanho, passaram a precisar também do
 * `cellSize` do mapa DAQUELE token — sempre os dois juntos, nunca um sem o outro.
 */
export interface SceneGeometry {
  fog: FogConfig;
  cellSizePx: number;
}

/** Geometria da cena, a partir da cena inteira (mesmo padrão de `toScene(...).fog` que já se usava). */
export function sceneGeometry(scene: Pick<Scene, "grid" | "fog">): SceneGeometry {
  return { fog: scene.fog, cellSizePx: effectiveCellSize(scene.grid) };
}

/** Retângulo em células ocupado por um token existente (pra findFreeCells não empilhar em cima). */
export function cellRect(token: { x: number; y: number; cells: number }, grid: GridConfig): CellRect {
  return { ...cellAt(token, grid), cells: token.cells };
}

/**
 * Posição de um token depois de uma troca de grid na MESMA cena (`scene:updateGrid`,
 * docs/plano-mapas.md/docs/plano-grid.md): mantém a mesma célula (col/row, recalculada com o grid
 * novo) — sem isso, mudar `cellSize`/offset deixaria os tokens existentes desalinhados do grid
 * novo. `cells` (fonte da verdade do tamanho, docs/plano-grid.md) nunca muda aqui: o tamanho em
 * pixels já é sempre `cells × cellSize do grid ATUAL`, então trocar de grid nunca precisa
 * recalcular tamanho nenhum — só reencaixar a posição. Devolve o MESMO objeto de entrada (mesma
 * referência) quando nada muda — quem chama usa isso pra decidir se vale a pena escrever/emitir
 * esse token.
 */
export function resnapTokenPosition<T extends { x: number; y: number }>(token: T, fromGrid: GridConfig, toGrid: GridConfig): T {
  const point = cellToPoint(cellAt(token, fromGrid), toGrid);
  if (point.x === token.x && point.y === token.y) return token;
  return { ...token, ...point };
}
