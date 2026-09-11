/**
 * Geometria da névoa manual. Funções puras usadas pelo cliente (esconder tokens
 * alheios, cursor) e pelo servidor (não enviar tokens ocultos a quem não pode ver).
 * Tudo em pixels do mapa.
 */
import type { FogConfig, FogShape } from "../schemas/fog.js";

export interface Point {
  x: number;
  y: number;
}

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

/** Ray casting clássico: conta quantas arestas um raio horizontal a partir do ponto cruza. Ímpar = dentro. */
export function pointInPolygon(points: number[], p: Point): boolean {
  const n = points.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = points[i * 2] ?? 0;
    const yi = points[i * 2 + 1] ?? 0;
    const xj = points[j * 2] ?? 0;
    const yj = points[j * 2 + 1] ?? 0;
    const crosses = yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Menor distância do ponto a qualquer segmento da polilinha (pontas redondas, como o pincel desenha). */
export function distanceToPolyline(points: number[], p: Point): number {
  const n = points.length / 2;
  if (n === 0) return Infinity;
  if (n === 1) return Math.hypot(p.x - (points[0] ?? 0), p.y - (points[1] ?? 0));
  let best = Infinity;
  for (let i = 0; i < n - 1; i++) {
    const d = distanceToSegment(points[i * 2] ?? 0, points[i * 2 + 1] ?? 0, points[i * 2 + 2] ?? 0, points[i * 2 + 3] ?? 0, p);
    if (d < best) best = d;
  }
  return best;
}

function distanceToSegment(ax: number, ay: number, bx: number, by: number, p: Point): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  // Segmento degenerado (dois pontos iguais): distância ao ponto.
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * abx + (p.y - ay) * aby) / len2));
  return Math.hypot(p.x - (ax + abx * t), p.y - (ay + aby * t));
}
