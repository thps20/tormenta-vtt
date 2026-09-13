import { describe, expect, it } from "vitest";
import { measureCells, measureDistance, measurePath } from "./measure.js";
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

describe("measurePath (régua com vértices, docs/SPEC.md §3.2)", () => {
  const t20 = getSystemDefinition("tormenta20");

  it("um único trecho: segments tem 1 item igual ao total", () => {
    const { segments, total } = measurePath(t20, [{ x: 0, y: 0 }, { x: 3, y: 3 }]);
    expect(segments).toEqual([{ cells: 4, value: 6, unit: "m" }]);
    expect(total).toEqual({ cells: 4, value: 6, unit: "m" });
  });

  it("dois trechos retos: soma simples (sem diagonal)", () => {
    const { segments, total } = measurePath(t20, [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 5 }]);
    expect(segments).toEqual([
      { cells: 2, value: 3, unit: "m" },
      { cells: 5, value: 7.5, unit: "m" },
    ]);
    expect(total).toEqual({ cells: 7, value: 10.5, unit: "m" });
  });

  it("diagonais acumulam ENTRE trechos (regra 1-2-1) — não reseta a cada vértice travado", () => {
    // Cada trecho é 1 célula diagonal isolada; travar vértices no meio não pode fazer as 6
    // diagonais custarem 6 células (barato demais) — tem que bater com measureCellsFrom acumulado.
    const points = Array.from({ length: 7 }, (_, i) => ({ x: i, y: i }));
    const { segments, total } = measurePath(t20, points);
    expect(segments).toHaveLength(6);
    expect(segments.map((s) => s.cells)).toEqual([1, 2, 1, 2, 1, 2]);
    expect(total.cells).toBe(9); // igual a measureCells(6, 6, "alternating")
  });

  it("sem grid no sistema: só células, value/unit null", () => {
    const { segments, total } = measurePath({ grid: undefined }, [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 3, y: 0 }]);
    expect(segments.every((s) => s.value === null && s.unit === null)).toBe(true);
    expect(total).toEqual({ cells: 4 + 4, value: null, unit: null }); // chebyshev: max(3,4)=4, depois max(0,4)=4
  });

  it("1 ponto só: nenhum trecho, total zero", () => {
    const { segments, total } = measurePath(t20, [{ x: 5, y: 5 }]);
    expect(segments).toEqual([]);
    expect(total).toEqual({ cells: 0, value: 0, unit: "m" });
  });
});
