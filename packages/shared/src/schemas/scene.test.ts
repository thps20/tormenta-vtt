import { describe, expect, it } from "vitest";
import { GridConfigSchema } from "./scene.js";

describe("GridConfigSchema (escala por mapa: unitsPerCell/unit)", () => {
  it("parse({}) não define unitsPerCell/unit — mapa sem override cai no padrão do sistema", () => {
    const grid = GridConfigSchema.parse({});
    expect(grid.unitsPerCell).toBeUndefined();
    expect(grid.unit).toBeUndefined();
  });

  it("aceita unitsPerCell e unit, resto com os defaults de sempre", () => {
    const grid = GridConfigSchema.parse({ unitsPerCell: 15, unit: "km" });
    expect(grid.unitsPerCell).toBe(15);
    expect(grid.unit).toBe("km");
    expect(grid.type).toBe("square");
    expect(grid.cellSize).toBe(70);
  });

  it("rejeita unitsPerCell zero ou negativo", () => {
    expect(() => GridConfigSchema.parse({ unitsPerCell: 0 })).toThrow();
    expect(() => GridConfigSchema.parse({ unitsPerCell: -1 })).toThrow();
  });

  it("rejeita unit vazio ou maior que 8 caracteres", () => {
    expect(() => GridConfigSchema.parse({ unit: "" })).toThrow();
    expect(() => GridConfigSchema.parse({ unit: "123456789" })).toThrow();
  });

  it("GridConfigSchema.partial() (payload de scene:updateGrid) aceita patch só com os campos novos", () => {
    const patch = GridConfigSchema.partial().parse({ unitsPerCell: 100 });
    expect(patch).toEqual({ unitsPerCell: 100 });
  });
});
