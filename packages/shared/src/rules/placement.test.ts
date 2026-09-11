import { describe, expect, it } from "vitest";
import { cellsFromPixels, findFreeCells, numberedNames, tokenPixelSize } from "./placement.js";

const bounds = { cols: 20, rows: 20 };

describe("findFreeCells", () => {
  it("célula de destino livre: cai exatamente nela", () => {
    const result = findFreeCells({ start: { col: 5, row: 5 }, cells: 1, count: 1, occupied: [], bounds });
    expect(result).toEqual([{ col: 5, row: 5 }]);
  });

  it("célula ocupada por token 1x1 empurra pra vizinha (primeiro anel)", () => {
    const occupied = [{ col: 5, row: 5, cells: 1 }];
    const [result] = findFreeCells({ start: { col: 5, row: 5 }, cells: 1, count: 1, occupied, bounds });
    expect(result).toBeDefined();
    expect(result).not.toEqual({ col: 5, row: 5 });
    // Distância Chebyshev 1 do centro (primeiro anel, não pulou direto pra longe).
    expect(Math.max(Math.abs(result!.col - 5), Math.abs(result!.row - 5))).toBe(1);
  });

  it("token 2x2 pula qualquer célula tocada por outro token, mesmo um 1x1 só no canto", () => {
    // Token 1x1 em (6,6) toca o canto inferior-direito de um 2x2 que nascesse em (5,5) (ocupa 5-6,5-6).
    const occupied = [{ col: 6, row: 6, cells: 1 }];
    const [result] = findFreeCells({ start: { col: 5, row: 5 }, cells: 2, count: 1, occupied, bounds });
    expect(result).toBeDefined();
    const overlapsCorner = result!.col <= 6 && result!.col + 1 >= 6 && result!.row <= 6 && result!.row + 1 >= 6;
    expect(overlapsCorner).toBe(false);
  });

  it("N cópias não se sobrepõem entre si", () => {
    const result = findFreeCells({ start: { col: 10, row: 10 }, cells: 1, count: 6, occupied: [], bounds });
    expect(result).toHaveLength(6);
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        const overlap = result[i]!.col === result[j]!.col && result[i]!.row === result[j]!.row;
        expect(overlap).toBe(false);
      }
    }
  });

  it("respeita os limites do mapa (nunca sai de bounds)", () => {
    const result = findFreeCells({ start: { col: 0, row: 0 }, cells: 2, count: 5, occupied: [], bounds: { cols: 3, rows: 3 } });
    expect(result.length).toBeGreaterThan(0);
    for (const p of result) {
      expect(p.col).toBeGreaterThanOrEqual(0);
      expect(p.row).toBeGreaterThanOrEqual(0);
      expect(p.col + 2).toBeLessThanOrEqual(3);
      expect(p.row + 2).toBeLessThanOrEqual(3);
    }
  });

  it("é determinístico: mesma entrada, mesma saída (fantasma e servidor concordam)", () => {
    const occupied = [{ col: 5, row: 5, cells: 1 }, { col: 6, row: 5, cells: 1 }];
    const opts = { start: { col: 5, row: 5 }, cells: 1, count: 3, occupied, bounds };
    expect(findFreeCells(opts)).toEqual(findFreeCells(opts));
  });

  it("devolve menos que count se estourar maxRadius", () => {
    // maxRadius 0: só a própria célula de partida, que já está ocupada.
    const occupied = [{ col: 5, row: 5, cells: 1 }];
    const result = findFreeCells({ start: { col: 5, row: 5 }, cells: 1, count: 3, occupied, bounds, maxRadius: 0 });
    expect(result).toEqual([]);
  });
});

describe("numberedNames", () => {
  it("count = 1 sem homônimo: sem número", () => {
    expect(numberedNames("Goblin", 1, [])).toEqual(["Goblin"]);
    expect(numberedNames("Goblin", 1, ["Orc", "Bandido"])).toEqual(["Goblin"]);
  });

  it("count = 1 com \"Goblin\" na cena: \"Goblin 2\"", () => {
    expect(numberedNames("Goblin", 1, ["Goblin"])).toEqual(["Goblin 2"]);
  });

  it("count = 3 a partir de \"Goblin 2\": \"Goblin 3\"..\"Goblin 5\"", () => {
    expect(numberedNames("Goblin", 3, ["Goblin 2"])).toEqual(["Goblin 3", "Goblin 4", "Goblin 5"]);
  });

  it("sem nenhum homônimo, count > 1 começa em 1", () => {
    expect(numberedNames("Goblin", 3, [])).toEqual(["Goblin 1", "Goblin 2", "Goblin 3"]);
  });

  it("ignora nomes de outras criaturas e pega o maior número já usado", () => {
    expect(numberedNames("Goblin", 1, ["Orc 1", "Goblin 4", "Goblin 2"])).toEqual(["Goblin 5"]);
  });
});

describe("tokenPixelSize (docs/plano-grid.md — Token.cells é a fonte da verdade do tamanho)", () => {
  it("token 1x1 num grid de 70px", () => {
    expect(tokenPixelSize(1, 70)).toEqual({ width: 70, height: 70 });
  });

  it("token 2x2 num grid de 100px", () => {
    expect(tokenPixelSize(2, 100)).toEqual({ width: 200, height: 200 });
  });

  it("token 3x3 num grid de 70px", () => {
    expect(tokenPixelSize(3, 70)).toEqual({ width: 210, height: 210 });
  });
});

describe("cellsFromPixels (inverso de tokenPixelSize — backfill da migration e resize pelo Transformer)", () => {
  it("140px num grid de 70px: 2 células", () => {
    expect(cellsFromPixels(140, 70)).toBe(2);
  });

  it("100px num grid de 70px: arredonda pra 1", () => {
    expect(cellsFromPixels(100, 70)).toBe(1);
  });

  it("nunca arredonda pra 0 célula: um valor bem menor que uma célula continua com pelo menos 1", () => {
    expect(cellsFromPixels(10, 70)).toBe(1);
  });

  it("arredonda pro inteiro mais próximo (quase-mas-não-exatamente 2 células continua 2)", () => {
    expect(cellsFromPixels(145, 70)).toBe(2);
  });

  it("ida e volta: cellsFromPixels(tokenPixelSize(n, c).width, c) === n", () => {
    for (const [n, c] of [[1, 70], [2, 100], [3, 70], [6, 50]] as const) {
      expect(cellsFromPixels(tokenPixelSize(n, c).width, c)).toBe(n);
    }
  });
});
