import type { Point } from "../geometry.js";

/**
 * Cast — mesa física e câmera da tela de exibição (docs/plano-cast.md §2, §4). Tudo puro: o web só
 * mede a tela/lê o que o Mestre está olhando e chama isto; o servidor não entra aqui (é preferência
 * 100% do cliente da tela, como o modo imersivo — nada de regra de sistema).
 *
 * Convenção: `center`/pontos de foco estão SEMPRE em pixels do MAPA; `viewport`/`pxPerCm` estão em
 * pixels de TELA (CSS px do container, já na ORIENTAÇÃO DO MAPA — ver `rotatedViewport`).
 */

export interface Viewport {
  width: number;
  height: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export interface CameraView {
  center: Point;
  /** Pixels de tela por pixel do mapa. */
  zoom: number;
}

// --- Escala física (calibração) ---------------------------------------------

/** Pixels de TELA por centímetro projetado, a partir da largura total da projeção. */
export function pxPerCmFromWidth(screenWidthPx: number, projectedWidthCm: number): number {
  if (screenWidthPx <= 0 || projectedWidthCm <= 0) throw new RangeError("pxPerCmFromWidth: parâmetros precisam ser positivos");
  return screenWidthPx / projectedWidthCm;
}

/** Mesma coisa, medida arrastando duas alças sobre uma fita métrica real (mais preciso com bordas cortadas). */
export function pxPerCmFromRuler(a: Point, b: Point, cm: number): number {
  if (cm <= 0) throw new RangeError("pxPerCmFromRuler: cm precisa ser positivo");
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  if (dist === 0) throw new RangeError("pxPerCmFromRuler: os dois pontos precisam ser diferentes");
  return dist / cm;
}

/**
 * Zoom do Stage para que 1 célula do grid meça exatamente `cellCm` na projeção. `cellSizePx` é o
 * tamanho da célula do MAPA ATUAL em pixels (`effectiveCellSize(scene.grid)`, web/shared) — muda
 * por mapa, então este zoom é recalculado a cada troca de cena.
 */
export function tabletopZoom(opts: { pxPerCm: number; cellCm: number; cellSizePx: number }): number {
  const { pxPerCm, cellCm, cellSizePx } = opts;
  if (pxPerCm <= 0 || cellCm <= 0 || cellSizePx <= 0) throw new RangeError("tabletopZoom: parâmetros precisam ser positivos");
  return (pxPerCm * cellCm) / cellSizePx;
}

/** Dimensões do container em "orientação do mapa": 90°/270° trocam largura e altura (a imagem gira por CSS). */
export function rotatedViewport(viewport: Viewport, rotation: 0 | 90 | 180 | 270): Viewport {
  return rotation === 90 || rotation === 270 ? { width: viewport.height, height: viewport.width } : viewport;
}

/** Arredonda o centro para a célula mais próxima: na mesa física, o pan não pode "escorregar" entre células. */
export function snapCenterToCells(center: Point, cellSizePx: number): Point {
  if (cellSizePx <= 0) return center;
  return { x: Math.round(center.x / cellSizePx) * cellSizePx, y: Math.round(center.y / cellSizePx) * cellSizePx };
}

// --- Câmera -------------------------------------------------------------------

/** Retângulo (pixels do mapa) que envolve todos os pontos, com uma margem — ou `null` sem pontos. */
export function boundsOfPoints(points: Point[], padding = 0): Rect | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX - padding, y: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
}

/** Zoom que faz `bounds` caber inteiro em `viewport` (contido, não cortado). Lado zero conta como 1px. */
function fitZoom(bounds: Rect, viewport: Viewport): number {
  return Math.min(viewport.width / Math.max(bounds.width, 1), viewport.height / Math.max(bounds.height, 1));
}

/**
 * Modo "seguir o Mestre" (docs/plano-cast.md §4.1): mesmo centro que ele está olhando; zoom que
 * CONTÉM a área que ele vê (fora da mesa física) ou o zoom travado (na mesa física — só o pan
 * acompanha, o zoom nunca muda).
 */
export function followCamera(view: { center: Point; viewWidth: number; viewHeight: number }, viewport: Viewport, lockedZoom?: number): CameraView {
  const zoom = lockedZoom ?? Math.min(viewport.width / Math.max(view.viewWidth, 1), viewport.height / Math.max(view.viewHeight, 1));
  return { center: view.center, zoom };
}

/**
 * Modo "automático" (docs/plano-cast.md §4.1): enquadra `focus` (o que TEM que estar visível — o
 * combatente da vez + gabaritos dele em combate, ou os tokens dos jogadores fora dele) com
 * `context` como reforço best-effort (tokens dos jogadores, incluídos na conta do zoom quando
 * cabem). Devolve `null` quando nada muda — a zona morta central evita recalcular a cada frame por
 * uma oscilação mínima.
 *
 * Zoom travado (mesa física): quando o foco não cabe inteiro na tela nesse zoom, prioriza só o
 * PRIMEIRO ponto de `focus` (convenção: o combatente da vez vem primeiro) em vez de afastar.
 */
export function autoCamera(opts: {
  focus: Point[];
  context?: Point[];
  viewport: Viewport;
  current: CameraView;
  lockedZoom?: number;
  /** Fração central da tela que não dispara recálculo (0–1). Padrão 0.7. */
  deadZone?: number;
  /** Margem (pixels do mapa) ao redor do que está sendo enquadrado. Padrão 80. */
  margin?: number;
}): CameraView | null {
  const { focus, context = [], viewport, current, lockedZoom, deadZone = 0.7, margin = 80 } = opts;
  const primaryPoints = focus.length > 0 ? focus : context;
  if (primaryPoints.length === 0) return null;

  const combinedBounds = boundsOfPoints([...focus, ...context], margin) ?? boundsOfPoints(primaryPoints, margin)!;
  const targetZoom = lockedZoom ?? fitZoom(combinedBounds, viewport);

  let bounds = boundsOfPoints(primaryPoints, margin)!;
  if (lockedZoom !== undefined && (bounds.width * targetZoom > viewport.width || bounds.height * targetZoom > viewport.height)) {
    const primary = primaryPoints[0]!;
    bounds = { x: primary.x, y: primary.y, width: 0, height: 0 };
  }
  const targetCenter = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };

  // Zona morta em pixels do MAPA na escala ATUAL: o mesmo tamanho de tela em qualquer zoom.
  const deadHalfW = (viewport.width * deadZone) / 2 / current.zoom;
  const deadHalfH = (viewport.height * deadZone) / 2 / current.zoom;
  const withinDeadZone = Math.abs(targetCenter.x - current.center.x) <= deadHalfW && Math.abs(targetCenter.y - current.center.y) <= deadHalfH;
  const zoomChanged = lockedZoom === undefined && Math.abs(targetZoom - current.zoom) / current.zoom > 0.12;
  if (withinDeadZone && !zoomChanged) return null;

  return { center: targetCenter, zoom: targetZoom };
}
