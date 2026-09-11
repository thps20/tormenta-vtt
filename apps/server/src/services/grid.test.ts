import { describe, expect, it } from "vitest";
import type { GridConfig } from "@tormenta-vtt/shared";
import { cellAt, cellRect, cellToPoint, effectiveCellSize, resnapTokenPosition } from "./grid.js";

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

  it("cellRect lê cells direto (fonte da verdade, docs/plano-grid.md)", () => {
    expect(cellRect({ x: 60, y: 50, cells: 2 }, grid)).toEqual({ col: 1, row: 1, cells: 2 });
    expect(cellRect({ x: 10, y: 0, cells: 1 }, grid)).toEqual({ col: 0, row: 0, cells: 1 });
  });
});

describe("resnapTokenPosition (scene:updateGrid reencaixa a posição dos tokens ao trocar cellSize/offset, docs/plano-mapas.md/docs/plano-grid.md)", () => {
  const grid70: GridConfig = { type: "square", cellSize: 70, offsetX: 0, offsetY: 0, color: "#000", snap: true };
  const grid100: GridConfig = { type: "square", cellSize: 100, offsetX: 0, offsetY: 0, color: "#000", snap: true };

  it("cellSize 70 -> 100: token mantém a célula (posição recalculada, tamanho nunca muda)", () => {
    const token = { x: 70, y: 140 };
    expect(resnapTokenPosition(token, grid70, grid100)).toEqual({ x: 100, y: 200 });
  });

  it("cellSize 100 -> 70: token mantém a célula, posição encolhe pro tamanho da célula nova", () => {
    const token = { x: 100, y: 200 };
    expect(resnapTokenPosition(token, grid100, grid70)).toEqual({ x: 70, y: 140 });
  });

  it("só offset muda (mesmo cellSize): reencaixa a posição", () => {
    const shifted: GridConfig = { ...grid70, offsetX: 20, offsetY: 20 };
    const token = { x: 70, y: 70 };
    expect(resnapTokenPosition(token, grid70, shifted)).toEqual({ x: 90, y: 90 });
  });

  it("grid \"none\" (célula virtual de 70px) <-> grid square: idem sem GridConfig especial", () => {
    const none: GridConfig = { ...grid70, type: "none" };
    const token = { x: 70, y: 70 };
    expect(resnapTokenPosition(token, none, grid100)).toEqual({ x: 100, y: 100 });
  });

  it("nada muda (mesmo grid nos dois lados): devolve a MESMA referência, sem objeto novo", () => {
    const token = { x: 70, y: 140 };
    expect(resnapTokenPosition(token, grid70, grid70)).toBe(token);
  });
});
