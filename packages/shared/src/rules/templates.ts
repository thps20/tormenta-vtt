import type { Template } from "../schemas/template.js";
import type { SystemDefinition, TemplatesDef } from "../schemas/system.js";
import type { Activation } from "../schemas/character.js";

/**
 * Gabaritos de área de efeito (docs/plano-gabaritos.md). Geometria pura, em pixels do mapa —
 * quem converte metros do JSON do sistema para pixels da cena é `apps/web/src/lib/templates.ts`
 * (mesma divisão de `rules/measure.ts`, abstrato, vs. `apps/web/src/lib/grid.ts`, pixels da cena).
 */

interface Point {
  x: number;
  y: number;
}

/** Diferença angular normalizada para (-π, π] — evita o salto de -π/π perto de "atrás" do cone. */
function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * Ponto dentro do gabarito? Usado tanto para selecionar um gabarito por clique (geometria, não
 * hit do Konva — mesmo motivo de sempre neste projeto, docs/debug-condicoes.md) quanto para achar
 * quem está "dentro" (ver `tokensInTemplate`).
 */
export function pointInTemplate(point: Point, template: Template): boolean {
  const dx = point.x - template.x;
  const dy = point.y - template.y;
  switch (template.shape) {
    case "circle":
      return dx * dx + dy * dy <= template.r * template.r;
    case "square": {
      // Frame local do quadrado: desgira o ponto pela rotação, origem = centro.
      const cos = Math.cos(-template.rotation);
      const sin = Math.sin(-template.rotation);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      const half = template.side / 2;
      return Math.abs(lx) <= half && Math.abs(ly) <= half;
    }
    case "line": {
      // Frame local da linha: origem = ponta, eixo x = direção (rotation), comprimento em x, largura em y.
      const cos = Math.cos(-template.rotation);
      const sin = Math.sin(-template.rotation);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      return lx >= 0 && lx <= template.length && Math.abs(ly) <= template.width / 2;
    }
    case "cone": {
      const dist = Math.hypot(dx, dy);
      if (dist > template.length) return false;
      if (dist === 0) return true; // a própria origem sempre conta
      const pointAngle = Math.atan2(dy, dx);
      const half = (template.angle * Math.PI) / 180 / 2;
      return Math.abs(angleDiff(pointAngle, template.rotation)) <= half;
    }
  }
}

/**
 * Centros das células ocupadas por um token, em pixels — um por célula (arredondado para cima na
 * contagem de células, mínimo 1×1). `cellSizePx` já é o lado efetivo da célula na cena (ver
 * `effectiveCellSize`, apps/web/src/lib/grid.ts): aqui não precisamos do offset do grid, só
 * subdividir o retângulo do próprio token.
 */
function tokenCellCenters(token: { x: number; y: number; width: number; height: number }, cellSizePx: number): Point[] {
  const cols = Math.max(1, Math.round(token.width / cellSizePx));
  const rows = Math.max(1, Math.round(token.height / cellSizePx));
  const cw = token.width / cols;
  const ch = token.height / rows;
  const centers: Point[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) centers.push({ x: token.x + (col + 0.5) * cw, y: token.y + (row + 0.5) * ch });
  }
  return centers;
}

/**
 * Tokens "dentro" do gabarito, pela regra do SPEC: conta se o CENTRO da célula está dentro; token
 * grande (mais de uma célula) conta se QUALQUER célula dele estiver dentro. Só destaque visual —
 * nenhuma automação de regra usa isto (dano/CD continuam manuais).
 */
export function tokensInTemplate<T extends { id: string; x: number; y: number; width: number; height: number }>(
  tokens: T[],
  template: Template,
  cellSizePx: number,
): Set<string> {
  const ids = new Set<string>();
  for (const token of tokens) {
    if (tokenCellCenters(token, cellSizePx).some((p) => pointInTemplate(p, template))) ids.add(token.id);
  }
  return ids;
}

export interface ParsedArea {
  shape: Template["shape"];
  /** Tamanho na unidade do `grid` do sistema (metros em T20) — ainda não convertido para pixels. */
  size: number;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Nome (sem acento) → forma. Várias palavras podem apontar para a mesma forma. */
const SHAPE_WORDS: Record<string, Template["shape"]> = {
  esfera: "circle",
  circulo: "circle",
  cone: "cone",
  linha: "line",
  raio: "line",
  quadrado: "square",
  cubo: "square",
};

/**
 * Casa um texto de área livre ("Esfera de 6 m", "Cone de 9 m") com uma forma+tamanho, para o botão
 * "Colocar área" do card de item (docs/plano-gabaritos.md). `null` sem match — a UI então abre a
 * ferramenta sem preset, como pedido; não tenta adivinhar quando a frase é composta ou ambígua
 * (mesmo princípio do importador do compêndio: nunca inferir, docs/plano-compendio.md).
 */
export function parseAreaText(text: string): ParsedArea | null {
  const norm = normalize(text);
  // "<forma> de N m" ("esfera de 6 m") ou "<forma> com N m" ("esfera com 6m de raio" — o "de raio"
  // sobra depois do match e é ignorado, mesma lógica de sempre: casa o começo, nunca infere o resto).
  const match = norm.match(/\b([a-z]+)\s+(?:de|com)\s+(\d+(?:[.,]\d+)?)\s*m\b/);
  if (!match) return null;
  const [, word, sizeText] = match;
  const shape = SHAPE_WORDS[word ?? ""];
  if (!shape) return null;
  const size = Number((sizeText ?? "").replace(",", "."));
  if (!Number.isFinite(size) || size <= 0) return null;
  return { shape, size };
}

/** Ângulo do cone (graus) — do preset, se declarado, senão o padrão do sistema. */
export function presetConeAngle(def: TemplatesDef, angle: number | undefined): number {
  return angle ?? def.coneAngle;
}

/** Largura da linha (unidade do grid) — do preset, se declarado, senão o padrão do sistema. */
export function presetLineWidth(def: TemplatesDef, width: number | undefined): number {
  return width ?? def.lineWidth;
}

/**
 * Rótulo legível de `Activation.area` ("Esfera 6 m" ou o texto livre) — card do chat, preview do
 * compêndio, ficha rápida (docs/plano-gabaritos.md §6). `null` sem área. Sem `def.templates` (o
 * sistema não declara a ferramenta, ou o dado foi importado antes de existir) cai no nome cru da
 * forma em vez de travar — só um item já existente ficando um pouco menos bonito, não um erro.
 */
export function formatArea(def: Pick<SystemDefinition, "templates" | "grid">, area: Activation["area"]): string | null {
  if (!area) return null;
  if (area.kind === "text") return area.text;
  const label = def.templates?.shapeLabels[area.shape] ?? area.shape;
  const unit = def.grid?.unit;
  return unit ? `${label} ${area.size} ${unit}` : `${label} ${area.size}`;
}

export type TemplateChangeAction = "colocar" | "mover" | "girar" | "apagar";

/**
 * "colocar área (cone 9 m)" — resumo de uma entrada de desfazer/refazer de gabarito, pro toast
 * (docs/plano-gabaritos.md §4). `areaLabel` já pronto (forma + tamanho): quem chama monta com o
 * rótulo do sistema e o tamanho convertido pra unidade dele — servidor (`services/history.ts`, a
 * partir de pixels + o grid do mapa) e cliente (`store/templateHistory.ts`, que já tem o tamanho em
 * metros da UI) convertem cada um do seu jeito, o texto final é o mesmo.
 */
export function describeTemplateChange(action: TemplateChangeAction, areaLabel: string): string {
  return `${action} área (${areaLabel})`;
}
