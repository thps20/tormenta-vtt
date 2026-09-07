import { describe, expect, it } from "vitest";
import { applyResourceDelta } from "./resources.js";

describe("applyResourceDelta", () => {
  it("dano gasta temp antes do current", () => {
    expect(applyResourceDelta({ current: 20, temp: 5 }, -8, { min: -15, max: 30 })).toEqual({ current: 17, temp: 0 });
  });

  it("dano menor que o temp só mexe no temp", () => {
    expect(applyResourceDelta({ current: 20, temp: 5 }, -3, { min: -15, max: 30 })).toEqual({ current: 20, temp: 2 });
  });

  it("dano trava no mínimo (ex.: -metade do máximo)", () => {
    expect(applyResourceDelta({ current: 2, temp: 0 }, -50, { min: -15, max: 30 })).toEqual({ current: -15, temp: 0 });
  });

  it("cura só mexe no current, travada no máximo", () => {
    expect(applyResourceDelta({ current: 25, temp: 3 }, 20, { min: -15, max: 30 })).toEqual({ current: 30, temp: 3 });
  });

  it("token solto: sem temp (sempre 0), current travado em 0..max", () => {
    expect(applyResourceDelta({ current: 5, temp: 0 }, -12, { min: 0, max: 20 })).toEqual({ current: 0, temp: 0 });
    expect(applyResourceDelta({ current: 5, temp: 0 }, 30, { min: 0, max: 20 })).toEqual({ current: 20, temp: 0 });
  });

  it("delta zero (×0, resistiu) não muda nada", () => {
    expect(applyResourceDelta({ current: 10, temp: 2 }, 0, { min: -15, max: 30 })).toEqual({ current: 10, temp: 2 });
  });
});
