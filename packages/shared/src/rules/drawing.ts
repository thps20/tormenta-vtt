/**
 * Regras puras dos traços de desenho livre (SPEC §9.17): hit-test de seleção por clique (geometria,
 * não o hit canvas do Konva — mesmo motivo documentado em `docs/debug-condicoes.md` pra pino e
 * gabarito), bounding box (caixa de seleção, alças de redimensionar) e a suavização da caneta.
 * Usadas pelo cliente (VttCanvas) e testadas aqui sem depender de canvas nenhum.
 */
import { distanceToPolyline, distanceToSegment, type Point } from "../geometry.js";
import type { Drawing } from "../schemas/drawing.js";

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Largura/altura estimadas de um rótulo de texto — aproximação suficiente pra seleção por caixa
 *  (não mede a fonte de verdade; a UI que sabe a fonte real cuida da posição exata do texto). */
function textBoundsSize(d: Extract<Drawing, { kind: "text" }>): { width: number; height: number } {
  return { width: Math.max(1, d.text.length) * d.strokeWidth * 0.6, height: d.strokeWidth * 1.4 };
}

/** Caixa envolvente de um traço, em pixels do mapa. */
export function drawingBounds(d: Drawing): Bounds {
  switch (d.kind) {
    case "pen": {
      const xs = d.points.filter((_, i) => i % 2 === 0);
      const ys = d.points.filter((_, i) => i % 2 === 1);
      return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    }
    case "line":
    case "arrow":
      return { minX: Math.min(d.x1, d.x2), minY: Math.min(d.y1, d.y2), maxX: Math.max(d.x1, d.x2), maxY: Math.max(d.y1, d.y2) };
    case "rect":
      return { minX: d.x, minY: d.y, maxX: d.x + d.width, maxY: d.y + d.height };
    case "ellipse":
      return { minX: d.cx - d.rx, minY: d.cy - d.ry, maxX: d.cx + d.rx, maxY: d.cy + d.ry };
    case "text": {
      const { width, height } = textBoundsSize(d);
      return { minX: d.x, minY: d.y, maxX: d.x + width, maxY: d.y + height };
    }
  }
}

/**
 * O ponto `p` está sobre este traço, com uma tolerância em pixels de TELA (o chamador já divide
 * por `stageScale`)? A tolerância cresce com a espessura do traço, pra caber num clique impreciso
 * num traço fino. Formas fechadas (rect/ellipse) contam como "hit" em qualquer ponto de dentro,
 * preenchidas ou não — clique simples, sem exigir acertar só a borda.
 */
export function hitTestDrawing(d: Drawing, p: Point, tolerancePx: number): boolean {
  const tol = tolerancePx + d.strokeWidth / 2;
  switch (d.kind) {
    case "pen":
      return distanceToPolyline(d.points, p) <= tol;
    case "line":
    case "arrow":
      return distanceToSegment(d.x1, d.y1, d.x2, d.y2, p) <= tol;
    case "rect":
      return p.x >= d.x - tol && p.x <= d.x + d.width + tol && p.y >= d.y - tol && p.y <= d.y + d.height + tol;
    case "ellipse": {
      const rx = d.rx + tol;
      const ry = d.ry + tol;
      const dx = (p.x - d.cx) / rx;
      const dy = (p.y - d.cy) / ry;
      return dx * dx + dy * dy <= 1;
    }
    case "text": {
      const { width, height } = textBoundsSize(d);
      return p.x >= d.x - tol && p.x <= d.x + width + tol && p.y >= d.y - tol && p.y <= d.y + height + tol;
    }
  }
}

/**
 * Douglas-Peucker: reduz uma polilinha achatada mantendo o formato dentro de `epsilonPx`. Aplicado
 * no `mouseup` do traço de caneta, depois da decimação ao vivo (que só limita o volume durante o
 * arrasto) — é a "suavização" pedida (menos pontos gravados, sem perder o traço visualmente).
 * Entrada com menos de 3 pontos volta sem mudança (nada a simplificar).
 */
export function smoothPenPoints(points: number[], epsilonPx: number): number[] {
  const n = points.length / 2;
  if (n < 3) return points;

  const keep = new Array<boolean>(n).fill(false);
  keep[0] = true;
  keep[n - 1] = true;

  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length > 0) {
    const next = stack.pop();
    if (!next) break;
    const [start, end] = next;
    if (end <= start + 1) continue;
    const ax = points[start * 2] ?? 0;
    const ay = points[start * 2 + 1] ?? 0;
    const bx = points[end * 2] ?? 0;
    const by = points[end * 2 + 1] ?? 0;
    let worst = -1;
    let worstDist = 0;
    for (let i = start + 1; i < end; i++) {
      const d = distanceToSegment(ax, ay, bx, by, { x: points[i * 2] ?? 0, y: points[i * 2 + 1] ?? 0 });
      if (d > worstDist) {
        worstDist = d;
        worst = i;
      }
    }
    if (worst !== -1 && worstDist > epsilonPx) {
      keep[worst] = true;
      stack.push([start, worst], [worst, end]);
    }
  }

  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (keep[i]) out.push(points[i * 2] ?? 0, points[i * 2 + 1] ?? 0);
  }
  return out;
}

/** Dono do traço (jogador só move/apaga os próprios; GM, todos — a checagem de GM é de quem chama). */
export function drawingOwnedBy(d: Drawing, participantId: string): boolean {
  return d.ownerId === participantId;
}

/** Quem pode ver um traço: GM sempre; jogador só se `visible` (GM marcou "todos") e o mapa do
 *  traço é o ATIVO da sala — mesma regra de `pinVisibleTo`. */
export function drawingVisibleTo(d: Pick<Drawing, "visible" | "sceneId">, viewer: { role: "gm" | "player" }, activeSceneId: string | null): boolean {
  if (viewer.role === "gm") return true;
  return d.visible && d.sceneId === activeSceneId;
}
