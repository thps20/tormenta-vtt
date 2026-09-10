import { newId } from "./ids";
import { cellAt, cellCenter, cellToPoint, effectiveCellSize } from "./grid";
import {
  describeTemplateChange,
  pointInTemplate,
  presetConeAngle,
  presetLineWidth,
  type GridConfig,
  type SystemDefinition,
  type Template,
  type TemplateChangeAction,
  type TemplateShape,
} from "@tormenta-vtt/shared";

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

/** Inverso de `unitToPixels` — tamanho ao vivo do rascunho ao arrastar (§5 do plano) e o resumo do
 *  Ctrl+Z local do jogador (`store/templateHistory.ts`). */
export function pixelsToUnit(px: number, def: SystemDefinition, cellSizePx: number): number {
  const unitsPerCell = def.grid?.cellSize ?? 1;
  return (px / cellSizePx) * unitsPerCell;
}

/** Tamanho (raio/comprimento/lado) do gabarito, em pixels — um campo por forma. */
export function templateSizePx(t: Template): number {
  return t.shape === "circle" ? t.r : t.shape === "square" ? t.side : t.length;
}

/** "cone 9 m" — rótulo forma+tamanho de um `Template` do mapa (pixels), pro resumo do Ctrl+Z local
 *  do jogador (o do GM é o mesmo texto, montado do lado do servidor a partir do banco — ver
 *  `apps/server/src/socket/templates.ts`). Arredonda a 1 casa, mesmo critério dos dois lados. */
export function templateAreaLabel(def: SystemDefinition, template: Template, cellSizePx: number): string {
  const shapeLabel = (def.templates?.shapeLabels[template.shape] ?? template.shape).toLowerCase();
  const size = Math.round(pixelsToUnit(templateSizePx(template), def, cellSizePx) * 10) / 10;
  return def.grid?.unit ? `${shapeLabel} ${size} ${def.grid.unit}` : `${shapeLabel} ${size}`;
}

/** "colocar área (cone 9 m)" — atalho que já monta o rótulo a partir do Template (pixels), pro
 *  Ctrl+Z local do jogador. */
export function describeTemplateAreaChange(action: TemplateChangeAction, def: SystemDefinition, template: Template, cellSizePx: number): string {
  return describeTemplateChange(action, templateAreaLabel(def, template, cellSizePx));
}

/** Meia célula do sistema (0,75 m em T20, metade de 1,5) — passo de arredondamento do tamanho ao
 *  arrastar pra criar um gabarito círculo/cone (docs/plano-gabaritos.md §5/§7), quando o snap está
 *  ligado — a regra do centro decide as células, não precisa de célula inteira. Nunca arredonda pra
 *  0 (um gabarito precisa de algum tamanho). */
export function roundToHalfCell(sizeUnits: number, def: SystemDefinition): number {
  const half = (def.grid?.cellSize ?? 1) / 2;
  return Math.max(half, Math.round(sizeUnits / half) * half);
}

/** Arredonda um ângulo (radianos) pro múltiplo de `stepDegrees` mais perto — direção do arrasto de
 *  cone (15°, docs/plano-gabaritos.md §7/§8) quando o snap está ligado. */
export function roundAngleToStep(radians: number, stepDegrees: number): number {
  const step = (stepDegrees * Math.PI) / 180;
  return Math.round(radians / step) * step;
}

/** `radians` é múltiplo de `stepDegrees`, com folga pra ponto flutuante — teste (não arredondamento,
 *  ver `roundAngleToStep`) usado pra decidir como desenhar um gabarito (TemplateLayer.tsx, §9). */
function isAngleMultipleOf(radians: number, stepDegrees: number): boolean {
  const step = (stepDegrees * Math.PI) / 180;
  const n = radians / step;
  return Math.abs(n - Math.round(n)) < 1e-6;
}

/**
 * A forma lisa (círculo/retângulo/setor do Konva) já é exatamente a união das células que o
 * gabarito cobre, ponta a ponta — sem precisar desenhar célula por célula (docs/plano-gabaritos.md
 * §9). Verdade pro quadrado sempre (sempre reto, nunca gira) e pra linha só quando a direção é
 * múltiplo de 90° (no eixo do grid); linha diagonal e círculo/cone não entram aqui.
 */
export function templateIsSolidBlock(t: Pick<Template, "shape" | "rotation">): boolean {
  return t.shape === "square" || (t.shape === "line" && isAngleMultipleOf(t.rotation, 90));
}

/**
 * Linha na diagonal (múltiplo de 45°, mas não de 90° — eixo já é `templateIsSolidBlock`): as
 * células da escada só se tocam por um CANTO, nunca por uma aresta inteira, então não têm
 * fronteira compartilhada pra remover — cada célula com o próprio contorno já é o contorno externo
 * certo da escada (docs/plano-gabaritos.md §8/§9).
 */
export function templateIsDiagonalLine(t: Pick<Template, "shape" | "rotation">): boolean {
  return t.shape === "line" && !templateIsSolidBlock(t) && isAngleMultipleOf(t.rotation, 45);
}

/** Quantas células cabem num tamanho (unidade do sistema) — mínimo 1. Usado pro clique-sem-arrasto
 *  de quadrado/linha com grid ativo: o campo de tamanho da barra vira uma contagem de células
 *  (docs/plano-gabaritos.md §8), não um tamanho contínuo. */
export function cellsFromSizeUnits(sizeUnits: number, def: SystemDefinition): number {
  const cellUnits = def.grid?.cellSize ?? 1;
  return Math.max(1, Math.round(sizeUnits / cellUnits));
}

/**
 * Distância (pixels) entre o centro de uma célula e o centro da PRÓXIMA na mesma direção — igual à
 * célula em linha reta, `cellSize × √2` na diagonal (a distância real entre dois centros vizinhos
 * na diagonal é maior). O comprimento de uma linha ancorada em célula é `cells * cellStep`, nunca
 * `cells * cellSize` — senão a diagonal ficaria curta demais e perderia célula (docs/plano-gabaritos.md §8).
 */
export function cellStep(cellSizePx: number, direction: number): number {
  return cellSizePx / Math.max(Math.abs(Math.cos(direction)), Math.abs(Math.sin(direction)));
}

/** Quantas células o arrasto cobre (mínimo 1) — comprimento da linha ancorada em célula, em células
 *  inteiras (docs/plano-gabaritos.md §8), a partir da distância em pixels arrastada NAQUELA direção. */
export function cellCountFromPixels(distancePx: number, cellSizePx: number, direction: number): number {
  return Math.max(1, Math.round(distancePx / cellStep(cellSizePx, direction)));
}

/**
 * Quadrado ancorado na célula sob o cursor no mousedown (docs/plano-gabaritos.md §8): SEMPRE um
 * conjunto de n×n células inteiras, nunca geometria livre — a célula-âncora nunca fica de fora do
 * resultado (é sempre um dos 4 cantos do bloco final), `cells` (n) vem da distância Chebyshev até a
 * célula do ponteiro + 1, e o quadrante do arrasto decide pra qual lado o quadrado cresce.
 */
export function squareFromAnchorCell(
  anchorCell: { col: number; row: number },
  pointerCell: { col: number; row: number },
  grid: GridConfig,
): { x: number; y: number; side: number; cells: number } {
  const cells = Math.max(Math.abs(pointerCell.col - anchorCell.col), Math.abs(pointerCell.row - anchorCell.row)) + 1;
  const minCol = pointerCell.col >= anchorCell.col ? anchorCell.col : anchorCell.col - cells + 1;
  const minRow = pointerCell.row >= anchorCell.row ? anchorCell.row : anchorCell.row - cells + 1;
  const topLeft = cellToPoint({ col: minCol, row: minRow }, grid);
  const side = effectiveCellSize(grid) * cells;
  return { x: topLeft.x + side / 2, y: topLeft.y + side / 2, side, cells };
}

/** `squareFromAnchorCell` + o resto dos campos do `Template`. */
export function newSquareFromAnchorCell(
  anchorCell: { col: number; row: number },
  pointerCell: { col: number; row: number },
  grid: GridConfig,
  ownerId: string,
  label = "",
): Template {
  const { x, y, side } = squareFromAnchorCell(anchorCell, pointerCell, grid);
  return { id: newId(), ownerId, x, y, rotation: 0, label, shape: "square", side };
}

/**
 * Ponta da linha ancorada numa célula, numa direção reta ou diagonal (docs/plano-gabaritos.md §8):
 * sai do CENTRO da célula-âncora até a borda (direção reta) ou o canto (diagonal) mais próximos
 * dessa direção — assim a linha ocupa 100% da célula (nunca fica centrada numa linha do grid, como
 * ficaria se a ponta fosse um vértice) e, na diagonal, o eixo dela atravessa exatamente o centro de
 * cada célula seguinte (a escada de células inteiras). `reach` é a distância padrão do centro até a
 * borda de um quadrado de lado `size` numa direção θ: `(size/2) / max(|cos θ|, |sin θ|)`.
 */
export function lineTipFromAnchorCell(anchorCell: { col: number; row: number }, direction: number, grid: GridConfig): { x: number; y: number } {
  const center = cellCenter(anchorCell, grid);
  const reach = cellStep(effectiveCellSize(grid), direction) / 2;
  return { x: center.x - Math.cos(direction) * reach, y: center.y - Math.sin(direction) * reach };
}

/** `lineTipFromAnchorCell` + o resto dos campos do `Template`. Comprimento = `cells * cellStep`
 *  (não `cells * cellSize` — ver `cellStep`). Largura sempre 1 célula (não `templates.lineWidth` —
 *  a regra aqui é célula inteira, independente do que o sistema configurar). */
export function newLineFromAnchorCell(anchorCell: { col: number; row: number }, direction: number, cells: number, grid: GridConfig, ownerId: string, label = ""): Template {
  const size = effectiveCellSize(grid);
  const tip = lineTipFromAnchorCell(anchorCell, direction, grid);
  const length = cellStep(size, direction) * Math.max(1, cells);
  return { id: newId(), ownerId, x: tip.x, y: tip.y, rotation: direction, label, shape: "line", length, width: size };
}

/** Guarda-corpo: gabarito gigante numa célula minúscula não trava o navegador pintando célula por
 *  célula (mesmo espírito do cap de gabaritos por mapa, `TEMPLATE_MAX_PER_SCENE`). */
const MAX_COVERED_CELLS = 4000;

/**
 * Cantos superior-esquerdos (pixels do mapa) das células cujo CENTRO cai dentro do gabarito — mesma
 * regra de `tokensInTemplate` (shared), pra desenhar o preenchimento por célula além do contorno
 * geométrico (docs/plano-gabaritos.md §5): todo mundo vê exatamente o mesmo resultado discreto, não
 * só a forma "lisa". Varre só a bounding box do gabarito (raio/comprimento/lado = maior distância
 * possível da origem); devolve pixels prontos (não col/row) pra quem desenha não precisar do grid de novo.
 */
export function templateCoveredCells(template: Template, grid: GridConfig): { x: number; y: number }[] {
  if (grid.type === "none") return [];
  const size = effectiveCellSize(grid);
  const reach = templateSizePx(template);
  const min = cellAt({ x: template.x - reach, y: template.y - reach }, grid);
  const max = cellAt({ x: template.x + reach, y: template.y + reach }, grid);
  const cells: { x: number; y: number }[] = [];
  outer: for (let row = min.row; row <= max.row; row++) {
    for (let col = min.col; col <= max.col; col++) {
      if (cells.length >= MAX_COVERED_CELLS) break outer;
      const corner = cellToPoint({ col, row }, grid);
      if (pointInTemplate({ x: corner.x + size / 2, y: corner.y + size / 2 }, template)) cells.push(corner);
    }
  }
  return cells;
}

/** Monta o gabarito NOVO na origem clicada, com o tamanho/rotação já resolvidos — do campo da barra
 *  (clique sem arrasto) ou do arrasto ao vivo (docs/plano-gabaritos.md §5, ver VttCanvas.tsx). */
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
