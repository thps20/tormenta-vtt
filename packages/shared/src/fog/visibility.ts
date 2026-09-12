/**
 * Geometria da névoa manual. Funções puras usadas pelo cliente (esconder tokens
 * alheios, cursor) e pelo servidor (não enviar tokens ocultos a quem não pode ver).
 * Tudo em pixels do mapa.
 */
import { distanceToPolyline, pointInPolygon, type Point } from "../geometry.js";
import type { FogConfig, FogShape } from "../schemas/fog.js";

export type { Point };
// Reexportadas para não quebrar quem já importava daqui (fog/visibility.test.ts) — a implementação
// mora em `../geometry.js`, compartilhada com os traços de desenho livre (rules/drawing.ts).
export { distanceToPolyline, pointInPolygon };

/** Um ponto está revelado? Parte de `base`; a ÚLTIMA shape que contém o ponto decide. */
export function isPointRevealed(fog: Pick<FogConfig, "enabled" | "base" | "shapes">, p: Point): boolean {
  if (!fog.enabled) return true;
  let revealed = fog.base === "revealed";
  for (const shape of fog.shapes) {
    if (shapeContains(shape, p)) revealed = shape.mode === "reveal";
  }
  return revealed;
}

/**
 * Centro de um token (a regra de visibilidade olha só o centro, não a área). `cellSizePx` é o
 * `effectiveCellSize` do grid do MAPA do token (docs/plano-grid.md: `cells` é a fonte do tamanho,
 * o pixel é sempre derivado) — quem chama já resolveu isso.
 */
export function tokenCenter(t: { x: number; y: number; cells: number }, cellSizePx: number): Point {
  const half = (t.cells * cellSizePx) / 2;
  return { x: t.x + half, y: t.y + half };
}

export function shapeContains(shape: FogShape, p: Point): boolean {
  switch (shape.kind) {
    case "circle": {
      const dx = p.x - shape.cx;
      const dy = p.y - shape.cy;
      return dx * dx + dy * dy <= shape.r * shape.r;
    }
    case "rect":
      return p.x >= shape.x && p.x <= shape.x + shape.width && p.y >= shape.y && p.y <= shape.y + shape.height;
    case "polygon":
      return pointInPolygon(shape.points, p);
    case "stroke":
      return distanceToPolyline(shape.points, p) <= shape.width / 2;
  }
}
