import { describe, expect, it } from "vitest";
import { clampToMap, gridLines, normalizeOffset, snapToGrid } from "./grid";
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
});
