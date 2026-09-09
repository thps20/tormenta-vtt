import { describe, expect, it } from "vitest";
import type { GridConfig } from "@tormenta-vtt/shared";
import { cellAt, cellRect, cellToPoint, effectiveCellSize } from "./grid.js";

const grid: GridConfig = { type: "square", cellSize: 50, offsetX: 10, offsetY: 0, color: "#000", snap: true };

describe("grid (servidor)", () => {
  it("effectiveCellSize: cellSize do grid, ou 70 fixo pra grid none", () => {
    expect(effectiveCellSize(grid)).toBe(50);
    expect(effectiveCellSize({ ...grid, type: "none" })).toBe(70);
  });

  it("cellAt/cellToPoint fazem o caminho de ida e volta", () => {
    expect(cellAt({ x: 65, y: 60 }, grid)).toEqual({ col: 1, row: 1 });
    expect(cellToPoint({ col: 1, row: 1 }, grid)).toEqual({ x: 60, y: 50 });
  });

  it("grid none usa célula virtual de 70px, sem offset", () => {
    expect(cellAt({ x: 72, y: 26 }, { ...grid, type: "none" })).toEqual({ col: 1, row: 0 });
  });

  it("cellRect arredonda o lado do token pra células (mínimo 1)", () => {
    expect(cellRect({ x: 60, y: 50, width: 100 }, grid)).toEqual({ col: 1, row: 1, cells: 2 });
    expect(cellRect({ x: 10, y: 0, width: 10 }, grid)).toEqual({ col: 0, row: 0, cells: 1 });
  });
});
