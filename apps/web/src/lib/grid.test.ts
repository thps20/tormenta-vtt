import { describe, expect, it } from "vitest";
import { cellAt, cellRect, cellToPoint, clampToMap, effectiveCellSize, gridLines, normalizeOffset, sizeTokens, snapToCellCenter, snapToGrid, snapToVertexOrCenter, tokensInBox } from "./grid";
import type { GridConfig, Token } from "@tormenta-vtt/shared";

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

  // Passo por teclado (docs/plano-movimento.md §3.1, useTokenMoveShortcuts): delta de uma célula
  // (ou 5 com Shift), snap ao grid, clamp na borda do mapa — mesma composição que o hook usa.
  it("passo por teclado: uma célula com snap, e o clamp segura na borda do mapa", () => {
    const map = { width: 200, height: 200 };
    const size = { width: 40, height: 40 };
    const step = effectiveCellSize(grid); // 50
    const raw = { x: 60 + step, y: 50 }; // um passo pra direita
    const snapped = snapToGrid(raw.x, raw.y, grid);
    expect(clampToMap(snapped.x, snapped.y, size, map)).toEqual({ x: 110, y: 50 });

    // Perto da borda direita: o passo estouraria o mapa, o clamp trava no limite.
    const nearEdge = { x: 60 + step * 3, y: 50 }; // 210, além de map.width - size.width = 160
    const snappedEdge = snapToGrid(nearEdge.x, nearEdge.y, grid);
    expect(clampToMap(snappedEdge.x, snappedEdge.y, size, map)).toEqual({ x: 160, y: 50 });
  });

  it("passo por teclado com Shift (5 células) e grid none: sem snap, passo fixo de 70px", () => {
    const noneGrid: GridConfig = { ...grid, type: "none" };
    const step = effectiveCellSize(noneGrid) * 5; // 350
    const raw = { x: 100 + step, y: 100 };
    expect(snapToGrid(raw.x, raw.y, noneGrid)).toEqual(raw); // grid "none": sem snap
    expect(clampToMap(raw.x, raw.y, { width: 20, height: 20 }, { width: 2000, height: 2000 })).toEqual(raw);
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

  it("cellRect lê cells direto (fonte da verdade, docs/plano-grid.md)", () => {
    expect(cellRect({ x: 60, y: 50, cells: 2 }, grid)).toEqual({ col: 1, row: 1, cells: 2 });
    expect(cellRect({ x: 10, y: 0, cells: 1 }, grid)).toEqual({ col: 0, row: 0, cells: 1 });
  });

  it("sizeTokens deriva width/height de cells × cellSize do grid (nunca gravado)", () => {
    const tokens = [{ cells: 1 }, { cells: 2 }] as Token[];
    expect(sizeTokens(tokens, grid).map((t) => ({ width: t.width, height: t.height }))).toEqual([
      { width: 50, height: 50 },
      { width: 100, height: 100 },
    ]);
    // grid "none": célula virtual de 70px.
    expect(sizeTokens([{ cells: 1 } as Token], { ...grid, type: "none" })[0]).toMatchObject({ width: 70, height: 70 });
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
