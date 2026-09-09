import { describe, expect, it } from "vitest";
import { convertSizeToCellSize, findFreeCells, numberedNames } from "./placement.js";

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

describe("convertSizeToCellSize (docs/plano-mapas.md — token não pode ficar menor/maior que a célula ao trocar de grid)", () => {
  it("token 1x1 de 70px (grid padrão) pra um grid de 100px: vira 100px, não fica menor que a célula", () => {
    expect(convertSizeToCellSize({ width: 70, height: 70 }, 70, 100)).toEqual({ width: 100, height: 100 });
  });

  it("token 1x1 de 100px pra um grid de 70px: vira 70px, não fica maior que a célula", () => {
    expect(convertSizeToCellSize({ width: 100, height: 100 }, 100, 70)).toEqual({ width: 70, height: 70 });
  });

  it("token 2x2 preserva as 2 células no grid novo", () => {
    expect(convertSizeToCellSize({ width: 140, height: 140 }, 70, 100)).toEqual({ width: 200, height: 200 });
  });

  it("largura e altura convertem independentes (token 1x2, não quadrado)", () => {
    expect(convertSizeToCellSize({ width: 70, height: 140 }, 70, 100)).toEqual({ width: 100, height: 200 });
  });

  it("grid \"none\" usa a célula virtual de 70px de cada lado (quem chama já resolveu effectiveCellSize)", () => {
    // Saindo de um mapa com grid "none" (70 virtual) pra um mapa square de 50: 70px -> 1 célula -> 50px.
    expect(convertSizeToCellSize({ width: 70, height: 70 }, 70, 50)).toEqual({ width: 50, height: 50 });
    // E o caminho contrário: mapa square de 50 (token 2x2 = 100px) pra um mapa "none" (70 virtual).
    expect(convertSizeToCellSize({ width: 100, height: 100 }, 50, 70)).toEqual({ width: 140, height: 140 });
  });

  it("nunca arredonda pra 0 célula: um token bem menor que uma célula continua com pelo menos 1", () => {
    expect(convertSizeToCellSize({ width: 10, height: 10 }, 70, 100)).toEqual({ width: 100, height: 100 });
  });

  it("arredonda pro inteiro mais próximo (token quase-mas-não-exatamente 2 células continua 2x2)", () => {
    expect(convertSizeToCellSize({ width: 145, height: 145 }, 70, 100)).toEqual({ width: 200, height: 200 });
  });
});
