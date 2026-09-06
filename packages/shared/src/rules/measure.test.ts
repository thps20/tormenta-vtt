import { describe, expect, it } from "vitest";
import { measureCells, measureDistance } from "./measure.js";
import { getSystemDefinition } from "../systems.js";

describe("measureCells", () => {
  it("euclidean: linha reta", () => {
    expect(measureCells(3, 4, "euclidean")).toBe(5);
  });

  it("manhattan: só ortogonal", () => {
    expect(measureCells(3, 4, "manhattan")).toBe(7);
  });

  it("chebyshev: diagonal custa 1", () => {
    expect(measureCells(3, 4, "chebyshev")).toBe(4);
    expect(measureCells(-3, 3, "chebyshev")).toBe(3);
  });

  it("alternating: segundo diagonal custa dobrado (1-2-1)", () => {
    expect(measureCells(1, 1, "alternating")).toBe(1);
    expect(measureCells(2, 2, "alternating")).toBe(3);
    expect(measureCells(3, 3, "alternating")).toBe(4);
    expect(measureCells(4, 4, "alternating")).toBe(6);
    expect(measureCells(5, 0, "alternating")).toBe(5);
    expect(measureCells(2, 5, "alternating")).toBe(6);
  });

  it("ignora o sinal", () => {
    expect(measureCells(-2, -2, "alternating")).toBe(3);
  });
});

describe("measureDistance", () => {
  it("usa cellSize, unit e diagonals do sistema", () => {
    const def = { grid: { cellSize: 1.5, unit: "m", diagonals: "alternating" as const } };
    expect(measureDistance(def, 3, 3)).toEqual({ cells: 4, value: 6, unit: "m" });
  });

  it("sem grid no sistema devolve só células (chebyshev)", () => {
    expect(measureDistance({ grid: undefined }, 3, 4)).toEqual({ cells: 4, value: null, unit: null });
  });

  it("tormenta20: 3 células na diagonal = 6 m", () => {
    const d = measureDistance(getSystemDefinition("tormenta20"), 3, 3);
    expect(d).toEqual({ cells: 4, value: 6, unit: "m" });
  });
});
