import { describe, expect, it } from "vitest";
import { clampToMap, gridLines, normalizeOffset, snapToGrid, tokensInBox } from "./grid";
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

  it("clamp segura o token dentro do mapa", () => {
    expect(clampToMap(-5, 990, { width: 50, height: 50 }, { width: 1000, height: 1000 })).toEqual({ x: 0, y: 950 });
  });

  it("gera linhas verticais e horizontais", () => {
    const lines = gridLines({ ...grid, offsetX: 0 }, { width: 100, height: 50 });
    expect(lines).toHaveLength(3 + 2);
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
