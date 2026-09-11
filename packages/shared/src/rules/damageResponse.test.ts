import { describe, expect, it } from "vitest";
import { getSystemDefinition } from "../systems.js";
import { describeDamageResponse, suggestDamage } from "./damageResponse.js";
import type { CharacterData } from "../schemas/character.js";
import type { DamageRollComponent } from "../schemas/dice.js";

const def = getSystemDefinition("tormenta20");

const NEUTRAL = { reduction: 0, half: false, immune: false, vulnerable: false };
const noResponses = (): CharacterData["damageResponses"] => ({ all: { ...NEUTRAL }, byType: {} });

const dmg = (formula: string, total: number, damageType: string | null = "fogo"): DamageRollComponent => ({ formula, damageType, groups: [], modifier: 0, total });

describe("suggestDamage", () => {
  it("alvo sem resposta a dano: ×1 e aviso vazio", () => {
    const result = suggestDamage(def, [dmg("2d6", 10)], noResponses());
    expect(result).toEqual({ multiplier: "1", amount: 10, note: "", raw: 10 });
  });

  it("imune: ×0, valor zerado, aviso com o rótulo do tipo", () => {
    const responses: CharacterData["damageResponses"] = { all: { ...NEUTRAL }, byType: { fogo: { ...NEUTRAL, immune: true } } };
    const result = suggestDamage(def, [dmg("2d6", 10)], responses);
    expect(result.multiplier).toBe("0");
    expect(result.amount).toBe(0);
    expect(result.raw).toBe(10);
    expect(result.note).toMatch(/Imune a fogo/i);
  });

  it("vulnerável: ×2", () => {
    const responses: CharacterData["damageResponses"] = { all: { ...NEUTRAL }, byType: { fogo: { ...NEUTRAL, vulnerable: true } } };
    const result = suggestDamage(def, [dmg("2d6", 10)], responses);
    expect(result).toEqual({ multiplier: "2", amount: 20, note: "Vulnerável a fogo", raw: 10 });
  });

  it('"reduz à metade": ×½ (arredondado pra baixo)', () => {
    const responses: CharacterData["damageResponses"] = { all: { ...NEUTRAL }, byType: { fogo: { ...NEUTRAL, half: true } } };
    const result = suggestDamage(def, [dmg("2d6", 9)], responses);
    expect(result).toEqual({ multiplier: "0.5", amount: 4, note: "Resistente a fogo", raw: 9 });
  });

  it("RD: sem multiplicador (null), valor já com a subtração (piso 0)", () => {
    const responses: CharacterData["damageResponses"] = { all: { ...NEUTRAL }, byType: { fogo: { ...NEUTRAL, reduction: 5 } } };
    expect(suggestDamage(def, [dmg("2d6", 10)], responses)).toEqual({ multiplier: null, amount: 5, note: "Resistente a fogo (RD 5)", raw: 10 });
    expect(suggestDamage(def, [dmg("2d6", 3)], responses)).toEqual({ multiplier: null, amount: 0, note: "Resistente a fogo (RD 5)", raw: 3 });
  });

  it("all (resposta geral) entra em toda parcela, mesmo sem tipo", () => {
    const responses: CharacterData["damageResponses"] = { all: { ...NEUTRAL, reduction: 2 }, byType: {} };
    expect(suggestDamage(def, [dmg("1d6", 6, null)], responses)).toEqual({ multiplier: null, amount: 4, note: "Resistente (RD 2)", raw: 6 });
  });

  it("duas parcelas de tipos diferentes (imune a uma, vulnerável à outra): multiplier null, soma parcela a parcela", () => {
    const responses: CharacterData["damageResponses"] = {
      all: { ...NEUTRAL },
      byType: { fogo: { ...NEUTRAL, immune: true }, frio: { ...NEUTRAL, vulnerable: true } },
    };
    const result = suggestDamage(def, [dmg("1d6", 6, "fogo"), dmg("1d6", 4, "frio")], responses);
    expect(result.multiplier).toBeNull();
    expect(result.amount).toBe(0 + 8); // fogo zerado, frio dobrado
    expect(result.raw).toBe(6 + 4);
    expect(result.note).toMatch(/Imune a fogo/);
    expect(result.note).toMatch(/Vulnerável a frio/);
  });

  it("cura nunca é ajustada, mesmo com resposta a dano cadastrada", () => {
    const responses: CharacterData["damageResponses"] = { all: { ...NEUTRAL }, byType: { cura: { ...NEUTRAL, immune: true } } };
    const result = suggestDamage(def, [dmg("2d8", 12, "cura")], responses);
    expect(result).toEqual({ multiplier: "1", amount: 12, note: "", raw: 12 });
  });
});

describe("describeDamageResponse", () => {
  it("sem nada marcado: string vazia", () => {
    expect(describeDamageResponse(def, "fogo", NEUTRAL)).toBe("");
  });

  it("imune e vulnerável juntos (ficha inconsistente, mas não deve travar): imune vence", () => {
    expect(describeDamageResponse(def, "fogo", { ...NEUTRAL, immune: true, vulnerable: true })).toMatch(/^Imune/);
  });
});
