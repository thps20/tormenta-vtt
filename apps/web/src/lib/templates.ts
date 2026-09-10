import { newId } from "./ids";
import { presetConeAngle, presetLineWidth, type SystemDefinition, type Template, type TemplateShape } from "@tormenta-vtt/shared";

/**
 * Ponte pixel↔metro para os gabaritos de área de efeito (docs/plano-gabaritos.md): a geometria em
 * si (`pointInTemplate`/`tokensInTemplate`) é pura em `packages/shared/src/rules/templates.ts`,
 * sem grid nenhum — quem converte a unidade do sistema (metros) para pixels da cena é este arquivo,
 * mesma divisão de `rules/measure.ts` (abstrato) vs. `apps/web/src/lib/grid.ts` (pixels da cena).
 */

/** Pixels da cena por unidade do sistema (metro em T20). Sem `def.grid`, 1 unidade = 1 célula. */
export function unitToPixels(value: number, def: SystemDefinition, cellSizePx: number): number {
  const unitsPerCell = def.grid?.cellSize ?? 1;
  return (value / unitsPerCell) * cellSizePx;
}

/** Preset ou campo de tamanho da barra: monta o gabarito NOVO na origem clicada, ainda sem rotação
 *  final (cone/linha ajustam `rotation` até o 2º clique — ver store/tools.ts `placing`). */
export function newTemplate(params: {
  shape: TemplateShape;
  origin: { x: number; y: number };
  /** Tamanho na unidade do sistema (metros) — raio/comprimento/lado conforme a forma. */
  sizeUnits: number;
  /** Só cone/linha: sobrescreve o padrão do sistema (`def.templates`), ex.: vindo de um preset. */
  angleOverride?: number;
  widthOverride?: number;
  ownerId: string;
  def: SystemDefinition;
  cellSizePx: number;
  label?: string;
  /** Cone/linha em colocação: rotação ao vivo (segue o mouse até o 2º clique). Ausente = 0. */
  rotationOverride?: number;
}): Template {
  const { shape, origin, sizeUnits, angleOverride, widthOverride, ownerId, def, cellSizePx, label = "", rotationOverride = 0 } = params;
  const sizePx = unitToPixels(sizeUnits, def, cellSizePx);
  const base = { id: newId(), ownerId, x: origin.x, y: origin.y, rotation: rotationOverride, label };
  switch (shape) {
    case "circle":
      return { ...base, shape, r: sizePx };
    case "square":
      return { ...base, shape, side: sizePx };
    case "line":
      return { ...base, shape, length: sizePx, width: unitToPixels(presetLineWidth(def.templates!, widthOverride), def, cellSizePx) };
    case "cone":
      return { ...base, shape, length: sizePx, angle: presetConeAngle(def.templates!, angleOverride) };
  }
}
