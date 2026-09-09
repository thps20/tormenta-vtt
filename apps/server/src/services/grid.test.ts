import { describe, expect, it } from "vitest";
import type { GridConfig } from "@tormenta-vtt/shared";
import { cellAt, cellRect, cellToPoint, effectiveCellSize, resnapToken } from "./grid.js";

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

describe("resnapToken (scene:updateGrid reencaixa/redimensiona tokens ao trocar cellSize/offset, docs/plano-mapas.md)", () => {
  const grid70: GridConfig = { type: "square", cellSize: 70, offsetX: 0, offsetY: 0, color: "#000", snap: true };
  const grid100: GridConfig = { type: "square", cellSize: 100, offsetX: 0, offsetY: 0, color: "#000", snap: true };

  it("cellSize 70 -> 100: token 1x1 mantém a célula e cresce pro tamanho da célula nova", () => {
    const token = { x: 70, y: 140, width: 70, height: 70 };
    expect(resnapToken(token, grid70, grid100)).toEqual({ x: 100, y: 200, width: 100, height: 100 });
  });

  it("cellSize 100 -> 70: token 1x1 mantém a célula e encolhe pro tamanho da célula nova", () => {
    const token = { x: 100, y: 200, width: 100, height: 100 };
    expect(resnapToken(token, grid100, grid70)).toEqual({ x: 70, y: 140, width: 70, height: 70 });
  });

  it("token 2x2 preserva as 2 células nos dois sentidos", () => {
    const token = { x: 0, y: 0, width: 140, height: 140 };
    expect(resnapToken(token, grid70, grid100)).toEqual({ x: 0, y: 0, width: 200, height: 200 });
  });

  it("só offset muda (mesmo cellSize): reencaixa a posição, tamanho fica igual", () => {
    const shifted: GridConfig = { ...grid70, offsetX: 20, offsetY: 20 };
    const token = { x: 70, y: 70, width: 70, height: 70 };
    expect(resnapToken(token, grid70, shifted)).toEqual({ x: 90, y: 90, width: 70, height: 70 });
  });

  it("grid \"none\" (célula virtual de 70px) <-> grid square: idem sem GridConfig especial", () => {
    const none: GridConfig = { ...grid70, type: "none" };
    const token = { x: 70, y: 70, width: 70, height: 70 };
    expect(resnapToken(token, none, grid100)).toEqual({ x: 100, y: 100, width: 100, height: 100 });
  });

  it("nada muda (mesmo grid nos dois lados): devolve a MESMA referência, sem objeto novo", () => {
    const token = { x: 70, y: 140, width: 70, height: 70 };
    expect(resnapToken(token, grid70, grid70)).toBe(token);
  });
});
