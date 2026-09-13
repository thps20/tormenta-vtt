import { describe, expect, it } from "vitest";
import { withMapScale } from "./scale.js";
import { measureDistance } from "./measure.js";
import { getSystemDefinition } from "../systems.js";

const t20 = getSystemDefinition("tormenta20");

describe("withMapScale", () => {
  it("sem override no mapa: devolve a MESMA referência (não invalida memos à toa)", () => {
    expect(withMapScale(t20, {})).toBe(t20);
  });

  it("override só de unitsPerCell: cellSize muda, unit e diagonals continuam do sistema", () => {
    const scaled = withMapScale(t20, { unitsPerCell: 15 });
    expect(scaled.grid).toEqual({ cellSize: 15, unit: "m", diagonals: "alternating" });
  });

  it("override só de unit: cellSize e diagonals continuam do sistema", () => {
    const scaled = withMapScale(t20, { unit: "km" });
    expect(scaled.grid).toEqual({ cellSize: 1.5, unit: "km", diagonals: "alternating" });
  });

  it("override dos dois", () => {
    const scaled = withMapScale(t20, { unitsPerCell: 1, unit: "km" });
    expect(scaled.grid).toEqual({ cellSize: 1, unit: "km", diagonals: "alternating" });
  });

  it("sistema sem grid: devolve def inalterado mesmo com override no mapa", () => {
    const def = { grid: undefined };
    expect(withMapScale(def, { unitsPerCell: 15, unit: "km" })).toBe(def);
  });

  it("integração: régua num mapa de escala diferente (measureDistance)", () => {
    const scaled = withMapScale(t20, { unitsPerCell: 15, unit: "km" });
    expect(measureDistance(scaled, 3, 3)).toEqual({ cells: 4, value: 60, unit: "km" });
  });
});
