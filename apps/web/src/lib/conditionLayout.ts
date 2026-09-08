/**
 * Geometria dos marcadores de condição no token — função PURA, usada por dois caminhos:
 * o desenho (ConditionMarkers) e o hit do mouse (VttCanvas.conditionTooltipAtPointer).
 *
 * Por que o hit não usa o canvas de hit do Konva: `getIntersection` lê pixels com `getImageData`,
 * que navegadores/extensões com proteção anti-fingerprinting embaralham — o Konva simplesmente não
 * "vê" shape nenhuma sob o mouse e nem dispara mouseenter. É o mesmo motivo pelo qual a interação
 * com tokens virou geométrica (`tokenAtPointer`); ver docs/debug-token.md. Manter as duas contas
 * na MESMA função é o que garante que o que se desenha e o que se acerta com o mouse não divirjam.
 *
 * Coordenadas locais do token: origem no canto superior esquerdo da bounding box, `(0,0)` a
 * `(width, height)`, em pixels do MAPA. Ver o comentário de geometria em VttCanvas (ConditionMarkers).
 */

export const CONDITION_ICON_PCT = 0.22;
export const CONDITION_MIN_PX = 10;
export const CONDITION_MAX_PX = 24;
/** Teto de sempre (1 ou 2 colunas); além disso o resto vira um badge "+N". */
export const CONDITION_MAX_VISIBLE = 6;
/** Raio (em px de TELA) do contador que substitui a coluna quando o zoom está baixo demais. */
export const CONDITION_COUNTER_RADIUS = 9;

export type ConditionLayout =
  | { mode: "counter"; cx: number; cy: number; screenRadius: number }
  | { mode: "icons"; r: number; slots: { x: number; y: number }[]; visibleCount: number; hiddenCount: number };

export function conditionLayout(width: number, height: number, stageScale: number, count: number): ConditionLayout {
  const cellSide = Math.min(width, height);
  // Ícone ~22% do lado da célula, mas medido em px de TELA e preso a [MIN, MAX]; abaixo do mínimo
  // nem tenta desenhar a coluna (viraria ruído) e mostra só um contador de tamanho fixo.
  const rawScreenSize = cellSide * CONDITION_ICON_PCT * stageScale;
  if (rawScreenSize < CONDITION_MIN_PX) {
    const r = CONDITION_COUNTER_RADIUS / stageScale;
    return { mode: "counter", cx: width - r, cy: r, screenRadius: CONDITION_COUNTER_RADIUS };
  }

  const screenSize = Math.min(CONDITION_MAX_PX, Math.max(CONDITION_MIN_PX, rawScreenSize));
  // Cinto de segurança: token redimensionado bem menor que uma célula não pode estourar a bbox.
  const r = Math.min(screenSize / stageScale / 2, width / 2, height / 2);
  const gap = r * 0.4;
  const step = 2 * r + gap;

  // Quantos cabem numa coluna. A barra de vida desenha ACIMA da bbox (y=-12) e o nome ABAIXO
  // (y=height+4), então nenhum dos dois come altura de [0, height]: nada a reservar aqui.
  const rows = Math.max(1, Math.floor((height - 2 * r) / step) + 1);
  const maxSlots = Math.min(CONDITION_MAX_VISIBLE, 2 * rows);
  const visibleCount = count > maxSlots ? maxSlots - 1 : count;
  const hiddenCount = count - visibleCount;

  // Coluna 0 encostada na borda direita (x = width - r), de cima pra baixo; a 2ª nasce à esquerda.
  const total = visibleCount + (hiddenCount > 0 ? 1 : 0);
  const slots = Array.from({ length: total }, (_, i) => ({
    x: width - r - Math.floor(i / rows) * step,
    y: r + (i % rows) * step,
  }));

  return { mode: "icons", r, slots, visibleCount, hiddenCount };
}

/**
 * Índice do badge sob um ponto em coordenadas locais do token (px do mapa), ou null.
 * No modo contador o único alvo é o índice 0. O último da lista tem prioridade (é o desenhado por cima).
 */
export function conditionSlotAtPoint(layout: ConditionLayout, x: number, y: number, stageScale: number): number | null {
  if (layout.mode === "counter") {
    const r = layout.screenRadius / stageScale;
    return Math.hypot(x - layout.cx, y - layout.cy) <= r ? 0 : null;
  }
  for (let i = layout.slots.length - 1; i >= 0; i--) {
    const s = layout.slots[i];
    if (s && Math.hypot(x - s.x, y - s.y) <= layout.r) return i;
  }
  return null;
}

/** true se o slot é o badge "+N" (só existe quando há condições escondidas, e é sempre o último). */
export function isOverflowSlot(layout: ConditionLayout, index: number): boolean {
  return layout.mode === "icons" && layout.hiddenCount > 0 && index === layout.slots.length - 1;
}
