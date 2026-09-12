import { describe, expect, it } from "vitest";
import { nextMacroOrder, reorderMacros } from "./macros.js";

describe("nextMacroOrder", () => {
  it("0 pra lista vazia", () => {
    expect(nextMacroOrder([])).toBe(0);
  });

  it("sempre maior que todas as existentes", () => {
    expect(nextMacroOrder([{ order: 0 }, { order: 5 }, { order: 2 }])).toBe(6);
  });
});

describe("reorderMacros", () => {
  const current = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("renumera 0..n-1 na ordem recebida", () => {
    const result = reorderMacros(current, ["c", "a", "b"]);
    expect(result).toEqual({ ok: true, order: [{ id: "c", order: 0 }, { id: "a", order: 1 }, { id: "b", order: 2 }] });
  });

  it("rejeita id faltando", () => {
    expect(reorderMacros(current, ["a", "b"])).toMatchObject({ ok: false });
  });

  it("rejeita id repetido", () => {
    expect(reorderMacros(current, ["a", "a", "b"])).toMatchObject({ ok: false });
  });

  it("rejeita id desconhecido", () => {
    expect(reorderMacros(current, ["a", "b", "z"])).toMatchObject({ ok: false });
  });
});
