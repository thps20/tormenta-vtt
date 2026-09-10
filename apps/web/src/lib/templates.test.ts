import { describe, expect, it } from "vitest";
import { getSystemDefinition, type GridConfig } from "@tormenta-vtt/shared";
import {
  cellsFromSizeUnits,
  describeTemplateAreaChange,
  newLineFromAnchorCell,
  newSquareFromAnchorCell,
  pixelsToUnit,
  roundAngleToStep,
  roundToHalfCell,
  templateAreaLabel,
  templateCoveredCells,
  templateIsDiagonalLine,
  templateIsSolidBlock,
  unitToPixels,
} from "./templates";

const def = getSystemDefinition("tormenta20"); // grid.cellSize = 1.5, unit = "m"

describe("unitToPixels / pixelsToUnit (docs/plano-gabaritos.md §5)", () => {
  it("são inversas", () => {
    const px = unitToPixels(9, def, 100);
    expect(pixelsToUnit(px, def, 100)).toBeCloseTo(9);
  });
});

describe("roundToHalfCell", () => {
  it("arredonda pro múltiplo de meia célula mais perto (0,75 m em T20)", () => {
    expect(roundToHalfCell(1.0, def)).toBeCloseTo(0.75);
    expect(roundToHalfCell(1.2, def)).toBeCloseTo(1.5);
    expect(roundToHalfCell(6.4, def)).toBeCloseTo(6.75);
  });

  it("nunca arredonda pra 0 (um gabarito precisa de tamanho)", () => {
    expect(roundToHalfCell(0, def)).toBeCloseTo(0.75);
    expect(roundToHalfCell(0.1, def)).toBeCloseTo(0.75);
  });
});

describe("roundAngleToStep (docs/plano-gabaritos.md §7/§8)", () => {
  const deg = (r: number) => (r * 180) / Math.PI;

  it("cone: passos de 15°", () => {
    expect(deg(roundAngleToStep((10 * Math.PI) / 180, 15))).toBeCloseTo(15);
    expect(deg(roundAngleToStep((7 * Math.PI) / 180, 15))).toBeCloseTo(0);
  });

  it("linha: passos de 45° (só eixos e diagonais, pra percorrer células inteiras)", () => {
    expect(deg(roundAngleToStep((40 * Math.PI) / 180, 45))).toBeCloseTo(45);
    expect(deg(roundAngleToStep((20 * Math.PI) / 180, 45))).toBeCloseTo(0);
    expect(deg(roundAngleToStep((50 * Math.PI) / 180, 45))).toBeCloseTo(45);
  });
});

describe("cellsFromSizeUnits (clique-sem-arrasto de quadrado/linha com grid ativo)", () => {
  it("converte o campo de tamanho (metros) em contagem de células (1,5 m em T20)", () => {
    expect(cellsFromSizeUnits(1.5, def)).toBe(1);
    expect(cellsFromSizeUnits(3, def)).toBe(2);
    expect(cellsFromSizeUnits(0.1, def)).toBe(1); // nunca menos de 1
  });
});

describe("quadrado/linha ancorados em célula — SEMPRE conjunto de células inteiras (docs/plano-gabaritos.md §8)", () => {
  const grid: GridConfig = { type: "square", cellSize: 50, offsetX: 0, offsetY: 0, color: "#000", snap: true };
  const cellsOf = (t: Parameters<typeof templateCoveredCells>[0]) => templateCoveredCells(t, grid);
  const cellRect = (col: number, row: number) => ({ x: col * 50, y: row * 50 });

  it("quadrado 2×2 ancorado em (3,4), arrastando pra baixo-direita, cobre (3..4, 4..5)", () => {
    const t = newSquareFromAnchorCell({ col: 3, row: 4 }, { col: 4, row: 5 }, grid, "p1");
    const cells = cellsOf(t);
    expect(cells).toHaveLength(4);
    expect(cells).toEqual(
      expect.arrayContaining([cellRect(3, 4), cellRect(4, 4), cellRect(3, 5), cellRect(4, 5)]),
    );
  });

  it("quadrado 1 célula: exatamente a célula clicada, não 4 pela metade", () => {
    const t = newSquareFromAnchorCell({ col: 3, row: 4 }, { col: 3, row: 4 }, grid, "p1");
    expect(cellsOf(t)).toEqual([cellRect(3, 4)]);
  });

  it("arrasto pra cima/esquerda inverte a âncora sem sair da célula clicada", () => {
    // Âncora (3,4), ponteiro em (2,3): n = max(|2-3|,|3-4|)+1 = 2, cresce pra cima/esquerda —
    // a célula (3,4) continua coberta, agora como o canto INFERIOR-DIREITO do bloco.
    const t = newSquareFromAnchorCell({ col: 3, row: 4 }, { col: 2, row: 3 }, grid, "p1");
    const cells = cellsOf(t);
    expect(cells).toHaveLength(4);
    expect(cells).toEqual(expect.arrayContaining([cellRect(2, 3), cellRect(3, 3), cellRect(2, 4), cellRect(3, 4)]));
  });

  it("linha horizontal de 6 células a partir de (3,4) cobre exatamente (3..8, 4)", () => {
    const t = newLineFromAnchorCell({ col: 3, row: 4 }, 0, 6, grid, "p1");
    const cells = cellsOf(t);
    expect(cells).toHaveLength(6);
    expect(cells).toEqual(expect.arrayContaining([3, 4, 5, 6, 7, 8].map((col) => cellRect(col, 4))));
    // Nunca centrada numa linha do grid: a linha ocupa a FILEIRA (4), não meia célula da 3 e meia da 4.
    expect(cells).not.toContainEqual(cellRect(3, 3));
    expect(cells).not.toContainEqual(cellRect(3, 5));
  });

  it("linha vertical de 3 células a partir de (3,4) cobre exatamente (3, 4..6)", () => {
    const t = newLineFromAnchorCell({ col: 3, row: 4 }, Math.PI / 2, 3, grid, "p1");
    expect(cellsOf(t)).toEqual(expect.arrayContaining([4, 5, 6].map((row) => cellRect(3, row))));
  });

  it("linha diagonal (45°) de 3 células a partir de (3,4) cobre a escada (3,4)→(4,5)→(5,6)", () => {
    const t = newLineFromAnchorCell({ col: 3, row: 4 }, Math.PI / 4, 3, grid, "p1");
    const cells = cellsOf(t);
    expect(cells).toHaveLength(3);
    expect(cells).toEqual(expect.arrayContaining([cellRect(3, 4), cellRect(4, 5), cellRect(5, 6)]));
    // Não é um retângulo girado cobrindo os vizinhos fora da diagonal.
    expect(cells).not.toContainEqual(cellRect(4, 4));
    expect(cells).not.toContainEqual(cellRect(3, 5));
  });
});

describe("templateIsSolidBlock / templateIsDiagonalLine (docs/plano-gabaritos.md §9 — como desenhar)", () => {
  const line = (rotationDeg: number) => ({ shape: "line" as const, rotation: (rotationDeg * Math.PI) / 180 });
  const square = { shape: "square" as const, rotation: 0 };
  const circle = { shape: "circle" as const, rotation: 0 };
  const cone = { shape: "cone" as const, rotation: (30 * Math.PI) / 180 };

  it("quadrado é sempre um bloco sólido (forma lisa = a união das células)", () => {
    expect(templateIsSolidBlock(square)).toBe(true);
    expect(templateIsDiagonalLine(square)).toBe(false);
  });

  it("linha no eixo (0/90/180/270°) é um bloco sólido", () => {
    for (const deg of [0, 90, 180, 270, -90]) {
      expect(templateIsSolidBlock(line(deg))).toBe(true);
      expect(templateIsDiagonalLine(line(deg))).toBe(false);
    }
  });

  it("linha na diagonal (45/135/225/315°) não é bloco sólido — é a escada", () => {
    for (const deg of [45, 135, 225, 315, -45]) {
      expect(templateIsSolidBlock(line(deg))).toBe(false);
      expect(templateIsDiagonalLine(line(deg))).toBe(true);
    }
  });

  it("linha livre (ângulo fora dos múltiplos de 45°) não é bloco nem escada — forma lisa + overlay", () => {
    expect(templateIsSolidBlock(line(30))).toBe(false);
    expect(templateIsDiagonalLine(line(30))).toBe(false);
  });

  it("círculo/cone nunca são bloco sólido nem escada", () => {
    expect(templateIsSolidBlock(circle)).toBe(false);
    expect(templateIsSolidBlock(cone)).toBe(false);
    expect(templateIsDiagonalLine(circle)).toBe(false);
    expect(templateIsDiagonalLine(cone)).toBe(false);
  });
});

describe("templateCoveredCells", () => {
  const grid: GridConfig = { type: "square", cellSize: 50, offsetX: 0, offsetY: 0, color: "#000", snap: true };

  it("círculo pequeno cobre só a célula do centro (regra do centro)", () => {
    const t = { id: "t1", ownerId: "p1", label: "", shape: "circle" as const, x: 25, y: 25, rotation: 0, r: 20 };
    expect(templateCoveredCells(t, grid)).toEqual([{ x: 0, y: 0 }]);
  });

  it("círculo maior cobre um bloco de células vizinhas", () => {
    const t = { id: "t1", ownerId: "p1", label: "", shape: "circle" as const, x: 50, y: 50, rotation: 0, r: 60 };
    const cells = templateCoveredCells(t, grid);
    // Célula (0,0): centro em (25,25), distância até (50,50) = √(25²+25²) ≈ 35.4 <= 60 → dentro.
    expect(cells).toContainEqual({ x: 0, y: 0 });
    // Célula (2,0): centro em (125,25), distância ≈ √(75²+25²) ≈ 79 > 60 → fora.
    expect(cells).not.toContainEqual({ x: 100, y: 0 });
  });

  it("grid 'none' não tem célula pra pintar", () => {
    const t = { id: "t1", ownerId: "p1", label: "", shape: "circle" as const, x: 25, y: 25, rotation: 0, r: 20 };
    expect(templateCoveredCells(t, { ...grid, type: "none" })).toEqual([]);
  });
});

describe("templateAreaLabel / describeTemplateAreaChange", () => {
  it("monta 'esfera 6 m' a partir do Template em pixels", () => {
    const cellSizePx = 100; // 100px por célula de 1,5 m
    const t = { id: "t1", ownerId: "p1", label: "", shape: "circle" as const, x: 0, y: 0, rotation: 0, r: unitToPixels(6, def, cellSizePx) };
    expect(templateAreaLabel(def, t, cellSizePx)).toBe("esfera 6 m");
    expect(describeTemplateAreaChange("colocar", def, t, cellSizePx)).toBe("colocar área (esfera 6 m)");
  });
});
