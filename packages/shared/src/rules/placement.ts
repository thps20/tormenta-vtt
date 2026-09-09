/**
 * Posicionamento de tokens no grid: onde cair uma cópia nova sem empilhar em cima de outro token
 * (espiral a partir de uma célula) e como numerar cópias em lote ("Goblin 1", "Goblin 2"...).
 * Tudo em CÉLULAS, não em pixels — a conversão célula/pixel é do web (lib/grid.ts), porque só ele
 * conhece GridConfig; aqui a régua é só "quantas células um lado ocupa".
 */

/** Área ocupada por um token em células: `cells` é o lado do quadrado (2 = token 2x2). */
export interface CellRect {
  col: number;
  row: number;
  cells: number;
}

function overlaps(a: CellRect, b: CellRect): boolean {
  return a.col < b.col + b.cells && b.col < a.col + a.cells && a.row < b.row + b.cells && b.row < a.row + a.cells;
}

/** Deslocamentos (dCol, dRow) em espiral: o centro primeiro, depois os anéis de raio Chebyshev 1, 2, 3... */
function spiralOffsets(maxRadius: number): Array<[number, number]> {
  const offsets: Array<[number, number]> = [[0, 0]];
  for (let r = 1; r <= maxRadius; r++) {
    for (let dCol = -r; dCol <= r; dCol++) {
      for (let dRow = -r; dRow <= r; dRow++) {
        if (Math.max(Math.abs(dCol), Math.abs(dRow)) === r) offsets.push([dCol, dRow]);
      }
    }
  }
  return offsets;
}

/**
 * `count` posições livres a partir da célula `start`, andando em espiral (anéis de raio Chebyshev
 * crescente) e pulando células ocupadas por `occupied` — inclusive as já escolhidas nesta mesma
 * chamada, então duas cópias nunca caem uma sobre a outra. Cada candidata é grudada dentro de
 * `bounds` antes de checar ocupação (mesmo comportamento de "não deixar o token sair do mapa" que
 * o botão de novo token já tinha). Devolve menos que `count` só se estourar `maxRadius` (padrão 12).
 */
export function findFreeCells(opts: {
  start: { col: number; row: number };
  /** Lado do token em células (>= 1; ex.: Grande em T20 = 2). */
  cells: number;
  count: number;
  occupied: CellRect[];
  bounds: { cols: number; rows: number };
  maxRadius?: number;
}): { col: number; row: number }[] {
  const { start, cells, count, bounds } = opts;
  const maxCol = Math.max(0, bounds.cols - cells);
  const maxRow = Math.max(0, bounds.rows - cells);
  const clamp = (col: number, row: number) => ({
    col: Math.min(Math.max(0, col), maxCol),
    row: Math.min(Math.max(0, row), maxRow),
  });

  const taken = [...opts.occupied];
  const result: { col: number; row: number }[] = [];
  for (const [dCol, dRow] of spiralOffsets(opts.maxRadius ?? 12)) {
    if (result.length >= count) break;
    const point = clamp(start.col + dCol, start.row + dRow);
    const rect: CellRect = { ...point, cells };
    if (taken.some((t) => overlaps(t, rect))) continue;
    result.push(point);
    taken.push(rect);
  }
  return result;
}

/**
 * Nomes numerados para `count` cópias de `base`, continuando a numeração dos tokens já na cena
 * (`existing`, os NOMES atuais — não só os desta espécie): "Goblin" sozinho conta como "Goblin 1"
 * pra esse efeito. `count = 1` sem nenhum nome (nem "base" nem "base N") em `existing` devolve o
 * nome sem número, como uma criatura solta sozinha na mesa vazia.
 */
export function numberedNames(base: string, count: number, existing: string[]): string[] {
  const numbered = new RegExp(`^${escapeRegExp(base)} (\\d+)$`);
  let max = 0;
  let hasMatch = false;
  for (const name of existing) {
    if (name === base) {
      hasMatch = true;
      max = Math.max(max, 1);
      continue;
    }
    const m = numbered.exec(name);
    if (m) {
      hasMatch = true;
      max = Math.max(max, Number(m[1]));
    }
  }
  if (count === 1 && !hasMatch) return [base];
  return Array.from({ length: count }, (_, i) => `${base} ${max + i + 1}`);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Redimensionar entre grids -----------------------------------------------------------------

/**
 * Tamanho (pixels) equivalente ao trocar de um grid com `fromCellSize` px por célula para outro
 * com `toCellSize`: primeiro descobre o lado em células na origem (arredondando — um token
 * quase-mas-não-exatamente 2 células continua sendo 2x2, mesma conta de `cellRect` em cada app),
 * depois multiplica pelo cellSize novo. Mínimo 1 célula por eixo (nunca deixa um token
 * "desaparecer"). Recebe só números (não `GridConfig`, que só o web/servidor conhecem — ver
 * comentário no topo do arquivo): quem chama já resolveu `effectiveCellSize` dos dois grids
 * (inclusive o virtual de 70px do grid "none"). Usada ao mover um token entre mapas com grid
 * diferente (`scene:activate`/`scene:delete`) e ao editar `cellSize`/offset de um mapa
 * (`scene:updateGrid`) — os dois lugares que, sem isso, deixariam um token menor/maior que a
 * célula ao trocar de grid.
 */
export function convertSizeToCellSize(
  size: { width: number; height: number },
  fromCellSize: number,
  toCellSize: number,
): { width: number; height: number } {
  const cellsW = Math.max(1, Math.round(size.width / fromCellSize));
  const cellsH = Math.max(1, Math.round(size.height / fromCellSize));
  return { width: cellsW * toCellSize, height: cellsH * toCellSize };
}
