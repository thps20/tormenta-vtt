import type { GridConfig } from "@tormenta-vtt/shared";

/**
 * Conversões célula <-> pixel. Funções puras (sem React, sem Konva) para
 * serem fáceis de testar. Tokens ficam em pixels do mapa; o grid só é
 * uma "régua" por cima.
 */

/** Offset normalizado para [0, cellSize) — evita linhas começando fora da imagem. */
export function normalizeOffset(offset: number, cellSize: number): number {
  return ((offset % cellSize) + cellSize) % cellSize;
}

/** Alinha o canto superior esquerdo de um token à célula mais próxima. */
export function snapToGrid(x: number, y: number, grid: GridConfig): { x: number; y: number } {
  if (grid.type === "none") return { x, y };
  const ox = normalizeOffset(grid.offsetX, grid.cellSize);
  const oy = normalizeOffset(grid.offsetY, grid.cellSize);
  return {
    x: Math.round((x - ox) / grid.cellSize) * grid.cellSize + ox,
    y: Math.round((y - oy) / grid.cellSize) * grid.cellSize + oy,
  };
}

/** Mantém o token dentro dos limites do mapa. */
export function clampToMap(
  x: number,
  y: number,
  size: { width: number; height: number },
  map: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, map.width - size.width)),
    y: Math.max(0, Math.min(y, map.height - size.height)),
  };
}

/** Linhas do grid (em pixels do mapa) para o canvas desenhar. */
export function gridLines(grid: GridConfig, map: { width: number; height: number }): number[][] {
  if (grid.type === "none") return [];
  const lines: number[][] = [];
  const ox = normalizeOffset(grid.offsetX, grid.cellSize);
  const oy = normalizeOffset(grid.offsetY, grid.cellSize);
  for (let x = ox; x <= map.width; x += grid.cellSize) lines.push([x, 0, x, map.height]);
  for (let y = oy; y <= map.height; y += grid.cellSize) lines.push([0, y, map.width, y]);
  return lines;
}
