import { describe, expect, it } from "vitest";
import { getSystemDefinition, type DamageResponses, type DamageRollComponent } from "@tormenta-vtt/shared";
import { checkApplyDamageTarget, computeDamageBreakdown } from "./applyDamage.js";

const gm = { role: "gm" as const, participantId: "gm-1" };
const player = { role: "player" as const, participantId: "p-1" };

const linkedToken = { name: "Goblin", ownerId: null, characterId: "char-1", hp: null };
const ownedToken = { name: "Herói", ownerId: "p-1", characterId: null, hp: { current: 10, max: 20 } };
const strangerToken = { name: "PC alheio", ownerId: "p-2", characterId: null, hp: { current: 10, max: 20 } };

describe("checkApplyDamageTarget", () => {
  it("GM pode em qualquer token", () => {
    expect(checkApplyDamageTarget(gm, linkedToken, { tokenBar: "pv" })).toBeNull();
    expect(checkApplyDamageTarget(gm, strangerToken, { tokenBar: "pv" })).toBeNull();
  });

  it("jogador pode no token que possui", () => {
    expect(checkApplyDamageTarget(player, ownedToken, { tokenBar: "pv" })).toBeNull();
  });

  it("jogador não pode em token alheio nem sem dono", () => {
    expect(checkApplyDamageTarget(player, strangerToken, { tokenBar: "pv" })).toMatch(/não controla/);
    expect(checkApplyDamageTarget(player, linkedToken, { tokenBar: "pv" })).toMatch(/não controla/);
  });

  it("token vinculado a ficha exige que o sistema defina tokenBar", () => {
    expect(checkApplyDamageTarget(gm, linkedToken, {})).toMatch(/não define barra de PV/);
  });

  it("token solto sem hp definido não pode ser alvo", () => {
    const noHp = { name: "Sem PV", ownerId: null, characterId: null, hp: null };
    expect(checkApplyDamageTarget(gm, noHp, { tokenBar: "pv" })).toMatch(/não tem PV definido/);
  });

  it("token solto com hp definido pode ser alvo mesmo sem tokenBar no sistema", () => {
    expect(checkApplyDamageTarget(gm, ownedToken, {})).toBeNull();
  });
});

describe("computeDamageBreakdown", () => {
  const def = getSystemDefinition("tormenta20");
  const NEUTRAL = { reduction: 0, half: false, immune: false, vulnerable: false };
  const noResponses: DamageResponses = { all: { ...NEUTRAL }, byType: {} };
  const dmg = (total: number, damageType: string | null = "fogo"): DamageRollComponent => ({
    formula: "2d6",
    damageType,
    groups: [],
    modifier: 0,
    total,
  });

  it("sem resposta a dano: ajuste 0, bruto = total com sinal (dano)", () => {
    expect(computeDamageBreakdown(def, [dmg(10)], noResponses)).toEqual({ raw: -10, adjustment: 0 });
  });

  it("cura: bruto positivo, ajuste 0 mesmo com resposta cadastrada (cura nunca é ajustada)", () => {
    const responses: DamageResponses = { all: { ...NEUTRAL }, byType: { cura: { ...NEUTRAL, immune: true } } };
    expect(computeDamageBreakdown(def, [dmg(10, "cura")], responses)).toEqual({ raw: 10, adjustment: 0 });
  });

  it("RD 4: bruto -7, ajuste +4 (a resistência SALVA 4 pontos de dano)", () => {
    const responses: DamageResponses = { all: { ...NEUTRAL }, byType: { corte: { ...NEUTRAL, reduction: 4 } } };
    expect(computeDamageBreakdown(def, [dmg(7, "corte")], responses)).toEqual({ raw: -7, adjustment: 4 });
  });

  it("imune: bruto -10, ajuste +10 (sugerido some por completo)", () => {
    const responses: DamageResponses = { all: { ...NEUTRAL }, byType: { fogo: { ...NEUTRAL, immune: true } } };
    expect(computeDamageBreakdown(def, [dmg(10)], responses)).toEqual({ raw: -10, adjustment: 10 });
  });

  it("vulnerável: bruto -10, ajuste -10 (sugerido dobra o dano)", () => {
    const responses: DamageResponses = { all: { ...NEUTRAL }, byType: { fogo: { ...NEUTRAL, vulnerable: true } } };
    expect(computeDamageBreakdown(def, [dmg(10)], responses)).toEqual({ raw: -10, adjustment: -10 });
  });

  it("token solto (responses neutra explícita): ajuste sempre 0", () => {
    expect(computeDamageBreakdown(def, [dmg(5)], noResponses)).toEqual({ raw: -5, adjustment: 0 });
  });
});
