import { describe, expect, it } from "vitest";
import { measureCellsFrom } from "./measure.js";
import { computeMovementBudget, EMPTY_MOVEMENT, applyStep, fitsInBudget, movementBase, movementRemaining, stepCost, type MovementState } from "./movement.js";
import { getSystemDefinition } from "../systems.js";

const t20 = getSystemDefinition("tormenta20");

describe("measureCellsFrom", () => {
  it("euclidean/manhattan/chebyshev: ignora o histórico de diagonais", () => {
    expect(measureCellsFrom(3, 4, "euclidean", 0)).toEqual({ cells: 5, diagonals: 3 });
    expect(measureCellsFrom(3, 4, "manhattan", 2)).toEqual({ cells: 7, diagonals: 5 });
    expect(measureCellsFrom(3, 4, "chebyshev", 2)).toEqual({ cells: 4, diagonals: 5 });
  });

  it("alternating: diagonalsBefore = 0, cada segunda diagonal custa dobrado", () => {
    expect(measureCellsFrom(1, 1, "alternating", 0)).toEqual({ cells: 1, diagonals: 1 });
    expect(measureCellsFrom(2, 2, "alternating", 0)).toEqual({ cells: 3, diagonals: 2 });
  });

  it("alternating: diagonalsBefore = 1 (já andou uma diagonal barata) — a próxima já custa dobrado", () => {
    // 1 diagonal avulsa (barata) + mais 1 diagonal agora: essa 2ª já é a "cara".
    expect(measureCellsFrom(1, 1, "alternating", 1)).toEqual({ cells: 2, diagonals: 2 });
  });

  it("alternating: diagonalsBefore = 2 — próximas duas diagonais avulsas custam 1 e 2, igual do zero", () => {
    expect(measureCellsFrom(1, 1, "alternating", 2)).toEqual({ cells: 1, diagonals: 3 });
    expect(measureCellsFrom(1, 1, "alternating", 3)).toEqual({ cells: 2, diagonals: 4 });
  });

  it("seis passos diagonais de 1 célula custam o mesmo total que um passo diagonal de 6", () => {
    let diagonalsBefore = 0;
    let total = 0;
    for (let i = 0; i < 6; i++) {
      const m = measureCellsFrom(1, 1, "alternating", diagonalsBefore);
      total += m.cells;
      diagonalsBefore = m.diagonals;
    }
    expect(total).toBe(measureCellsFrom(6, 6, "alternating", 0).cells);
    expect(total).toBe(9); // 1+2+1+2+1+2
  });
});

describe("computeMovementBudget", () => {
  it("lista vazia = base", () => {
    expect(computeMovementBudget(9, [])).toBe(9);
  });

  it("ordem set → add → multiply → block", () => {
    expect(computeMovementBudget(9, [{ kind: "add", value: 3 }])).toBe(12);
    expect(computeMovementBudget(9, [{ kind: "set", value: 6 }, { kind: "add", value: 3 }])).toBe(9);
    expect(computeMovementBudget(9, [{ kind: "add", value: 3 }, { kind: "multiply", value: 0.5 }])).toBe(6);
    expect(computeMovementBudget(9, [{ kind: "add", value: 3 }, { kind: "block" }])).toBe(0);
  });

  it("nunca fica negativo", () => {
    expect(computeMovementBudget(9, [{ kind: "add", value: -100 }])).toBe(0);
  });
});

describe("movementBase", () => {
  it("sem movement no sistema: null", () => {
    expect(movementBase({ movement: undefined, grid: t20.grid }, {})).toBeNull();
  });

  it("override do GM > derived da ficha > movement.default", () => {
    expect(movementBase(t20, { override: 15, derived: { movement: 6 } })).toBe(15);
    expect(movementBase(t20, { derived: { movement: 6 } })).toBe(6);
    expect(movementBase(t20, {})).toBe(9); // sem ficha (token solto): movement.default
    expect(movementBase(t20, { override: null, derived: { movement: 6 } })).toBe(6); // override null = "segue a ficha"
  });
});

describe("stepCost / applyStep / fitsInBudget", () => {
  it("acumula gasto e diagonais entre passos do mesmo turno", () => {
    let state: MovementState = EMPTY_MOVEMENT;
    // 1 célula diagonal: 1,5 m (regra alternating, cellSize 1,5).
    const step1 = stepCost(t20, state, 1, 1);
    expect(step1).toEqual({ cost: 1.5, diagonals: 1 });
    state = applyStep(t20, state, 1, 1);
    expect(state).toEqual({ used: 1.5, diagonals: 1 });

    // 2ª diagonal do turno: custa dobrado (3 m).
    const step2 = stepCost(t20, state, 1, 1);
    expect(step2).toEqual({ cost: 3, diagonals: 2 });
    state = applyStep(t20, state, 1, 1);
    expect(state.used).toBe(4.5);
  });

  it("fitsInBudget: cabe exatamente (com epsilon), não cabe por pouco, orçamento 0", () => {
    const state: MovementState = { used: 7.5, diagonals: 0 };
    expect(fitsInBudget(t20, 9, state, 1, 0)).toBe(true); // 7,5 + 1,5 = 9 (exato)
    expect(fitsInBudget(t20, 9, state, 2, 0)).toBe(false); // 7,5 + 3 = 10,5
    expect(fitsInBudget(t20, 0, EMPTY_MOVEMENT, 1, 0)).toBe(false);
  });

  it("movementRemaining nunca é negativo", () => {
    expect(movementRemaining(9, { used: 12, diagonals: 0 })).toBe(0);
    expect(movementRemaining(9, { used: 3, diagonals: 0 })).toBe(6);
  });
});
