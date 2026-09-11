import { describe, expect, it } from "vitest";
import { calibrateFromRect } from "./gridCalibration";

describe("calibrateFromRect (docs/plano-grid.md, Parte B)", () => {
  it("1 célula exata: cellSize = lado do retângulo, offset = canto módulo cellSize", () => {
    expect(calibrateFromRect({ x: 12, y: 5, side: 70 }, 1)).toEqual({ cellSize: 70, offsetX: 12, offsetY: 5 });
  });

  it("N células (mais precisão): cellSize = lado / N", () => {
    // 731 px cobrindo 10 células -> 73,1 px por célula.
    expect(calibrateFromRect({ x: 0, y: 0, side: 731 }, 10)).toEqual({ cellSize: 73.1, offsetX: 0, offsetY: 0 });
  });

  it("offset negativo é normalizado pra [0, cellSize)", () => {
    expect(calibrateFromRect({ x: -10, y: -5, side: 70 }, 1)).toEqual({ cellSize: 70, offsetX: 60, offsetY: 65 });
  });

  it("offset maior que a célula é normalizado (módulo)", () => {
    expect(calibrateFromRect({ x: 85, y: 140, side: 70 }, 1)).toEqual({ cellSize: 70, offsetX: 15, offsetY: 0 });
  });

  it("nunca sai de [8, 1000] (mesmo limite de GridConfigSchema.cellSize)", () => {
    expect(calibrateFromRect({ x: 0, y: 0, side: 2 }, 1).cellSize).toBe(8);
    expect(calibrateFromRect({ x: 0, y: 0, side: 5000 }, 1).cellSize).toBe(1000);
  });

  it("arredonda pra 1 casa decimal", () => {
    // 100 / 3 = 33,333... -> 33,3.
    expect(calibrateFromRect({ x: 0, y: 0, side: 100 }, 3).cellSize).toBe(33.3);
  });
});
