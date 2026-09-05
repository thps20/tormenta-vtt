import { describe, expect, it } from "vitest";
import { DiceParseError, parseFormula } from "./parser.js";
import { roll } from "./roller.js";

/** RNG que devolve valores fixos em sequência (repete o último). */
function seq(values: number[]) {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)] ?? 0;
    i++;
    return v;
  };
}

describe("parseFormula", () => {
  it("aceita um dado simples", () => {
    expect(parseFormula("1d20").terms).toEqual([{ kind: "dice", sign: 1, count: 1, sides: 20 }]);
  });

  it("count é opcional (d6 == 1d6)", () => {
    expect(parseFormula("d6").terms[0]).toMatchObject({ count: 1, sides: 6 });
  });

  it("aceita vários termos com espaços e sinais", () => {
    const p = parseFormula("2d6 + 3 - 1d4 - 2");
    expect(p.normalized).toBe("2d6+3-1d4-2");
    expect(p.terms).toEqual([
      { kind: "dice", sign: 1, count: 2, sides: 6 },
      { kind: "constant", sign: 1, value: 3 },
      { kind: "dice", sign: -1, count: 1, sides: 4 },
      { kind: "constant", sign: -1, value: 2 },
    ]);
  });

  it("aceita kh/kl", () => {
    expect(parseFormula("2d20kh1").terms[0]).toMatchObject({ keep: { mode: "highest", n: 1 } });
    expect(parseFormula("4d6KL3").terms[0]).toMatchObject({ keep: { mode: "lowest", n: 3 } });
  });

  it("rejeita fórmulas inválidas", () => {
    for (const bad of ["", "abc", "1d", "d", "5", "1d20+", "+", "1d20++3", "2d6 3", "1d20kh3", "1d20kh0"]) {
      expect(() => parseFormula(bad), bad).toThrow(DiceParseError);
    }
  });

  it("respeita os limites", () => {
    expect(() => parseFormula("101d6")).toThrow(DiceParseError);
    expect(() => parseFormula("1d1001")).toThrow(DiceParseError);
    expect(() => parseFormula("1d1")).toThrow(DiceParseError);
    expect(() => parseFormula("1d6+".repeat(60) + "1")).toThrow(DiceParseError);
    expect(parseFormula("100d1000")).toBeTruthy();
  });
});

describe("roll", () => {
  it("soma dados e modificador", () => {
    // rng 0.5 em d6 => floor(3)+1 = 4
    const r = roll("2d6+3", seq([0.5, 0.99]));
    expect(r.groups[0]?.rolls).toEqual([4, 6]);
    expect(r.modifier).toBe(3);
    expect(r.total).toBe(13);
  });

  it("subtrai termos negativos", () => {
    const r = roll("1d20-1d4-2", seq([0.0, 0.99]));
    expect(r.groups[0]?.rolls).toEqual([1]);
    expect(r.groups[1]?.rolls).toEqual([4]);
    expect(r.groups[1]?.subtotal).toBe(-4);
    expect(r.modifier).toBe(-2);
    expect(r.total).toBe(1 - 4 - 2);
  });

  it("kh1 mantém o maior e registra o descartado", () => {
    const r = roll("2d20kh1", seq([0.1, 0.9]));
    expect(r.groups[0]?.rolls).toEqual([19]);
    expect(r.groups[0]?.dropped).toEqual([3]);
    expect(r.total).toBe(19);
  });

  it("kl2 mantém os dois menores", () => {
    const r = roll("3d6kl2", seq([0.99, 0.0, 0.5]));
    expect(r.groups[0]?.rolls).toEqual([1, 4]);
    expect(r.groups[0]?.dropped).toEqual([6]);
  });

  it("resultados ficam dentro de [1, lados] com Math.random", () => {
    for (let i = 0; i < 200; i++) {
      const r = roll("3d6");
      for (const v of r.groups[0]?.rolls ?? []) {
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(6);
      }
    }
  });
});
