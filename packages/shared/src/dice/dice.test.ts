import { describe, expect, it } from "vitest";
import { DiceParseError, parseFormula } from "./parser.js";
import { evaluateConstant, roll } from "./roller.js";

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
    expect(parseFormula("1d20").root).toEqual({ kind: "dice", count: 1, sides: 20 });
  });

  it("count é opcional (d6 == 1d6)", () => {
    expect(parseFormula("d6").root).toMatchObject({ count: 1, sides: 6 });
  });

  it("normaliza espaços e maiúsculas", () => {
    expect(parseFormula("2D6 + 3 - 1d4 - 2").normalized).toBe("2d6+3-1d4-2");
  });

  it("monta a árvore com precedência de * e /", () => {
    const p = parseFormula("1d20 + 2 * 3");
    expect(p.root).toEqual({
      kind: "binary",
      op: "+",
      left: { kind: "dice", count: 1, sides: 20 },
      right: { kind: "binary", op: "*", left: { kind: "number", value: 2 }, right: { kind: "number", value: 3 } },
    });
  });

  it("aceita kh/kl", () => {
    expect(parseFormula("2d20kh1").root).toMatchObject({ keep: { mode: "highest", n: 1 } });
    expect(parseFormula("4d6KL3").root).toMatchObject({ keep: { mode: "lowest", n: 3 } });
  });

  it("aceita parênteses, sinal unário e funções", () => {
    expect(parseFormula("1d20 + (-2)").hasDice).toBe(true);
    expect(parseFormula("1d20 + floor(5/2)").hasDice).toBe(true);
    expect(parseFormula("1d20 + min(3, 2) + max(1, 4)").hasDice).toBe(true);
  });

  it("rejeita fórmulas inválidas", () => {
    for (const bad of ["", "abc", "1d", "d", "5", "1d20+", "+", "2d6 3", "1d20kh3", "1d20kh0", "1d20 + {attr.for}", "(1d20", "floor(1d6)", "min(2)", "2 * 1d6", "1d6 / 2"]) {
      expect(() => parseFormula(bad), bad).toThrow(DiceParseError);
    }
  });

  it("aceita fórmula sem dado só quando pedido", () => {
    expect(() => parseFormula("5")).toThrow(DiceParseError);
    expect(parseFormula("5", { requireDice: false }).hasDice).toBe(false);
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

  it("aplica * / e funções sobre as constantes", () => {
    const r = roll("1d20 + 2*3 - 7/2 + floor(3/2) + min(1, 5) + max(-2, 0) + abs(-4)", seq([0.5]));
    expect(r.groups[0]?.rolls).toEqual([11]);
    // 6 - 3 + 1 + 1 + 0 + 4 = 9
    expect(r.modifier).toBe(9);
    expect(r.total).toBe(20);
  });

  it("parênteses e sinal unário negam grupos de dados", () => {
    const r = roll("1d20 - (1d4 + 2)", seq([0.5, 0.5]));
    expect(r.groups[1]?.subtotal).toBe(-3);
    expect(r.modifier).toBe(-2);
    expect(r.total).toBe(11 - 3 - 2);
  });

  it("rejeita divisão por zero", () => {
    expect(() => roll("1d20 + 1/0")).toThrow(DiceParseError);
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

describe("evaluateConstant", () => {
  it("avalia expressões sem dados", () => {
    expect(evaluateConstant("10 + 2")).toBe(12);
    expect(evaluateConstant("10 + min(3, 2) + floor(7/2)")).toBe(15);
    expect(evaluateConstant("-3")).toBe(-3);
    expect(evaluateConstant("10 + (-2)")).toBe(8);
  });

  it("rejeita dados", () => {
    expect(() => evaluateConstant("10 + 1d6")).toThrow(DiceParseError);
  });
});
