import { describe, expect, it } from "vitest";
import { cellAt, cellRect, cellToPoint, clampToMap, effectiveCellSize, gridLines, normalizeOffset, snapToCellCenter, snapToGrid, snapToVertexOrCenter, tokensInBox } from "./grid";
import type { GridConfig } from "@tormenta-vtt/shared";

const grid: GridConfig = { type: "square", cellSize: 50, offsetX: 10, offsetY: 0, color: "#000", snap: true };

describe("grid", () => {
  it("normaliza offsets negativos e maiores que a célula", () => {
    expect(normalizeOffset(-10, 50)).toBe(40);
    expect(normalizeOffset(120, 50)).toBe(20);
  });

  it("snap alinha à célula mais próxima respeitando o offset", () => {
    expect(snapToGrid(72, 26, grid)).toEqual({ x: 60, y: 50 });
    expect(snapToGrid(86, 24, grid)).toEqual({ x: 110, y: 0 });
  });

  it("snap não faz nada com grid none", () => {
    expect(snapToGrid(72, 26, { ...grid, type: "none" })).toEqual({ x: 72, y: 26 });
  });

  it("snapToCellCenter vai ao centro da célula que contém o ponto", () => {
    // offsetX 10: células em [10,60), [60,110)... centros em 35, 85...
    expect(snapToCellCenter(12, 49, grid)).toEqual({ x: 35, y: 25 });
    expect(snapToCellCenter(59, 51, grid)).toEqual({ x: 35, y: 75 });
    expect(snapToCellCenter(12, 49, { ...grid, type: "none" })).toEqual({ x: 12, y: 49 });
  });

  it("snapToVertexOrCenter escolhe o mais perto entre vértice e centro (docs/plano-gabaritos.md §5)", () => {
    expect(snapToVertexOrCenter(12, 2, grid)).toEqual(snapToGrid(12, 2, grid)); // perto do vértice (10,0)
    expect(snapToVertexOrCenter(35, 25, grid)).toEqual(snapToCellCenter(35, 25, grid)); // exatamente no centro
    expect(snapToVertexOrCenter(12, 49, { ...grid, type: "none" })).toEqual({ x: 12, y: 49 });
  });

  it("clamp segura o token dentro do mapa", () => {
    expect(clampToMap(-5, 990, { width: 50, height: 50 }, { width: 1000, height: 1000 })).toEqual({ x: 0, y: 950 });
  });

  it("gera linhas verticais e horizontais", () => {
    const lines = gridLines({ ...grid, offsetX: 0 }, { width: 100, height: 50 });
    expect(lines).toHaveLength(3 + 2);
  });

  it("effectiveCellSize: cellSize do grid quadrado, ou 70 fixo pra grid none", () => {
    expect(effectiveCellSize(grid)).toBe(50);
    expect(effectiveCellSize({ ...grid, type: "none" })).toBe(70);
  });

  it("cellAt/cellToPoint fazem o caminho de ida e volta (grid quadrado)", () => {
    expect(cellAt({ x: 10, y: 0 }, grid)).toEqual({ col: 0, row: 0 });
    expect(cellAt({ x: 65, y: 60 }, grid)).toEqual({ col: 1, row: 1 });
    expect(cellToPoint({ col: 1, row: 1 }, grid)).toEqual({ x: 60, y: 50 });
    expect(cellToPoint(cellAt({ x: 72, y: 26 }, grid), grid)).toEqual({ x: 60, y: 0 });
  });

  it("cellAt com grid none usa célula virtual de 70px, sem offset", () => {
    expect(cellAt({ x: 72, y: 26 }, { ...grid, type: "none" })).toEqual({ col: 1, row: 0 });
  });

  it("cellRect arredonda o lado do token pra células (mínimo 1)", () => {
    expect(cellRect({ x: 60, y: 50, width: 100 }, grid)).toEqual({ col: 1, row: 1, cells: 2 });
    // width bem menor que uma célula ainda ocupa 1 (nunca 0).
    expect(cellRect({ x: 10, y: 0, width: 10 }, grid)).toEqual({ col: 0, row: 0, cells: 1 });
  });

  it("seleção em caixa pega tokens pelo centro, em qualquer direção do arraste", () => {
    const tokens = [
      { id: "a", x: 0, y: 0, width: 50, height: 50 }, // centro 25,25
      { id: "b", x: 100, y: 100, width: 50, height: 50 }, // centro 125,125
      { id: "c", x: 300, y: 0, width: 50, height: 50 }, // centro 325,25
    ];
    expect(tokensInBox(tokens, { x1: 10, y1: 10, x2: 200, y2: 200 }).map((t) => t.id)).toEqual(["a", "b"]);
    expect(tokensInBox(tokens, { x1: 200, y1: 200, x2: 10, y2: 10 }).map((t) => t.id)).toEqual(["a", "b"]);
    // Só encostar na borda do token, sem cobrir o centro, não seleciona.
    expect(tokensInBox(tokens, { x1: 0, y1: 0, x2: 20, y2: 20 })).toEqual([]);
  });
});
