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
 * Posições (em CÉLULAS inteiras, offsets dentro de uma célula cheia) que um token de `cells < 1`
 * pode ocupar sem sair dela — 0.5 dá um grid 2×2 de meias-células ((0,0), (0.5,0), (0,0.5),
 * (0.5,0.5)): até 4 Minúsculos dividindo a mesma célula (docs/plano-grid.md). `cells >= 1` nunca
 * chama isto (`findFreeCells` só usa um único offset [0,0] nesse caso — token normal não subdivide
 * célula nenhuma).
 */
function subCellSlots(cells: number): Array<[number, number]> {
  const slots: Array<[number, number]> = [];
  for (let row = 0; row < 1; row += cells) {
    for (let col = 0; col < 1; col += cells) slots.push([col, row]);
  }
  return slots;
}

/**
 * `count` posições livres a partir da célula `start`, andando em espiral (anéis de raio Chebyshev
 * crescente) e pulando células ocupadas por `occupied` — inclusive as já escolhidas nesta mesma
 * chamada, então duas cópias nunca caem uma sobre a outra. Cada CÉLULA candidata é grudada dentro
 * de `bounds` antes de checar ocupação (mesmo comportamento de "não deixar o token sair do mapa"
 * que o botão de novo token já tinha). Token de meia célula (`cells: 0.5`, Minúsculo): antes de
 * passar pra próxima célula do anel, tenta as 4 meias-células DENTRO da célula candidata
 * (`subCellSlots`) — sem isso, duas cópias soltas juntas cairiam uma na célula do lado em vez de
 * dividir a mesma, o que era o objetivo de suportar `cells` fracionário. Devolve menos que `count`
 * só se estourar `maxRadius` (padrão 12).
 */
export function findFreeCells(opts: {
  start: { col: number; row: number };
  /** Lado do token em células: inteiro >= 1 (ex.: Grande em T20 = 2), ou 0.5 (Minúsculo, meia célula). */
  cells: number;
  count: number;
  occupied: CellRect[];
  bounds: { cols: number; rows: number };
  maxRadius?: number;
}): { col: number; row: number }[] {
  const { start, cells, count, bounds } = opts;
  // Pra célula fracionária, a espiral ainda anda em células INTEIRAS (maxCol reserva 1 célula
  // cheia); os slots de meia-célula ficam por conta de `subCellSlots` dentro de cada candidata.
  const cellStep = cells < 1 ? 1 : cells;
  const maxCol = Math.max(0, bounds.cols - cellStep);
  const maxRow = Math.max(0, bounds.rows - cellStep);
  const clamp = (col: number, row: number) => ({
    col: Math.min(Math.max(0, col), maxCol),
    row: Math.min(Math.max(0, row), maxRow),
  });
  const slots = cells < 1 ? subCellSlots(cells) : ([[0, 0]] as Array<[number, number]>);

  const taken = [...opts.occupied];
  const result: { col: number; row: number }[] = [];
  for (const [dCol, dRow] of spiralOffsets(opts.maxRadius ?? 12)) {
    if (result.length >= count) break;
    const cellPoint = clamp(start.col + dCol, start.row + dRow);
    for (const [sCol, sRow] of slots) {
      if (result.length >= count) break;
      const point = { col: cellPoint.col + sCol, row: cellPoint.row + sRow };
      const rect: CellRect = { ...point, cells };
      if (taken.some((t) => overlaps(t, rect))) continue;
      result.push(point);
      taken.push(rect);
    }
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
 * Tamanho em pixels de um token de `cells` células de lado, no grid com `cellSizePx` px por
 * célula (`effectiveCellSize`, web/server — inclusive o virtual de 70px do grid "none"). Com
 * `Token.cells` como fonte da verdade (docs/plano-grid.md), isto é a ÚNICA conta de célula→pixel
 * de tamanho: como não se grava pixel nenhum, não existe mais "converter tamanho ao trocar de
 * grid" — o tamanho já é sempre `cells × cellSize do grid ATUAL`, recalculado on-the-fly em quem
 * precisa (canvas, espiral de posicionamento, névoa).
 */
export function tokenPixelSize(cells: number, cellSizePx: number): { width: number; height: number } {
  const side = cells * cellSizePx;
  return { width: side, height: side };
}

/**
 * Inverso de `tokenPixelSize`: quantas células um lado de `px` pixels ocupa nesse grid — arredonda
 * (um token quase-mas-não-exatamente 2 células continua sendo 2), mínimo 1 (nunca deixa um token
 * "desaparecer"). Usada no backfill da migration de `Token.cells` e ao redimensionar pelo
 * Transformer (o arrasto solta um pixel, o servidor só aceita células inteiras).
 */
export function cellsFromPixels(px: number, cellSizePx: number): number {
  return Math.max(1, Math.round(px / cellSizePx));
}

/**
 * Normaliza um `tokenCells` de sistema (pode ser fracionário, ex.: Minúsculo = 0,5) para um
 * `Token.cells` válido (`TokenSchema`: inteiro >= 1, ou exatamente 0.5) — usada ao soltar uma
 * criatura do compêndio (servidor e fantasma no cliente, mesma regra nos dois pra cair igual).
 * Valores de até meia célula viram meia célula (o único tamanho fracionário suportado hoje); os
 * demais arredondam pro inteiro mais próximo, mínimo 1.
 */
export function normalizeTokenCells(raw: number): number {
  if (raw <= 0.75) return 0.5;
  return Math.max(1, Math.round(raw));
}
