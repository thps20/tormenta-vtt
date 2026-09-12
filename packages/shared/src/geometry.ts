/**
 * Geometria pura em pixels, compartilhada por qualquer feature que precise de distância a um
 * segmento/polilinha ou "ponto dentro de um polígono" — hoje a névoa (`fog/visibility.ts`, traço de
 * pincel) e os traços de desenho livre (`rules/drawing.ts`, hit-test de seleção). Extraído de
 * `fog/visibility.ts` para não duplicar: as duas features desenham a mesma forma de traço
 * (polilinha achatada `[x1,y1,x2,y2,...]` com largura).
 */

export interface Point {
  x: number;
  y: number;
}

/** Menor distância do ponto `p` ao segmento AB. */
export function distanceToSegment(ax: number, ay: number, bx: number, by: number, p: Point): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  // Segmento degenerado (dois pontos iguais): distância ao ponto.
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * abx + (p.y - ay) * aby) / len2));
  return Math.hypot(p.x - (ax + abx * t), p.y - (ay + aby * t));
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
