import { describe, expect, it } from "vitest";
import { getSystemDefinition, type SystemDefinition } from "@tormenta-vtt/shared";
import { buildRollTargets, confirmCritical, type RollTargetInput } from "./rolls.js";

const t20 = getSystemDefinition("tormenta20");

const goblin: RollTargetInput = { tokenId: "t1", name: "Goblin", computed: null };
const orc: RollTargetInput = { tokenId: "t2", name: "Orc", computed: null };

describe("buildRollTargets (docs/plano-alvos.md, SPEC §9.12/§9.13)", () => {
  it("sem alvo marcado: lista vazia, ataque ou não", () => {
    expect(buildRollTargets(undefined, { isAttack: true, hasDamage: false, def: t20, attackCtx: { total: 18, natural: 12 } })).toEqual([]);
    expect(buildRollTargets([], { isAttack: true, hasDamage: false, def: t20, attackCtx: { total: 18, natural: 12 } })).toEqual([]);
  });

  it("teste/atributo (sem ataque nem dano) com alvo marcado: nunca constrói nada", () => {
    expect(buildRollTargets([goblin], { isAttack: false, hasDamage: false, def: t20, attackCtx: { total: 18, natural: null } })).toEqual([]);
  });

  it("ação de DANO avulsa (sem ataque): congela a lista com hit sempre null (bug corrigido)", () => {
    expect(buildRollTargets([goblin, orc], { isAttack: false, hasDamage: true, def: t20, attackCtx: { total: 14, natural: null } })).toEqual([
      { tokenId: "t1", name: "Goblin", hit: null, reason: "no-rule" },
      { tokenId: "t2", name: "Orc", hit: null, reason: "no-rule" },
    ]);
  });

  it("ataque: 20 natural acerta sempre (attackAutoHit do T20), sem precisar da ficha do alvo", () => {
    expect(buildRollTargets([goblin], { isAttack: true, hasDamage: false, def: t20, attackCtx: { total: 8, natural: 20 } })).toEqual([
      { tokenId: "t1", name: "Goblin", hit: true, reason: "auto-hit" },
    ]);
  });

  it("ataque: 1 natural erra sempre (attackAutoMiss do T20)", () => {
    expect(buildRollTargets([goblin], { isAttack: true, hasDamage: false, def: t20, attackCtx: { total: 30, natural: 1 } })).toEqual([
      { tokenId: "t1", name: "Goblin", hit: false, reason: "auto-miss" },
    ]);
  });

  it("ataque: attackHit precisa da ficha do alvo — alvo sem ficha (computed null) vira hit:null", () => {
    expect(buildRollTargets([goblin], { isAttack: true, hasDamage: false, def: t20, attackCtx: { total: 18, natural: 12 } })).toEqual([
      { tokenId: "t1", name: "Goblin", hit: null, reason: "no-rule" },
    ]);
  });

  it("ataque combinado com dano (§9.13): mesma avaliação de acerto de um ataque sozinho", () => {
    expect(buildRollTargets([goblin], { isAttack: true, hasDamage: true, def: t20, attackCtx: { total: 8, natural: 20 } })).toEqual([
      { tokenId: "t1", name: "Goblin", hit: true, reason: "auto-hit" },
    ]);
  });

  it("ataque sem `def`: não avalia acerto (some pra lista vazia, já que também não há dano junto)", () => {
    expect(buildRollTargets([goblin], { isAttack: true, hasDamage: false, attackCtx: { total: 8, natural: 20 } })).toEqual([]);
  });
});

describe("confirmCritical (SPEC §9.13, 'Rolar dano junto com o ataque')", () => {
  it("sem natural, sem critThreshold, ou natural abaixo da margem: nunca confirma", () => {
    expect(confirmCritical(t20, null, 20)).toBe(false);
    expect(confirmCritical(t20, 20, undefined)).toBe(false);
    expect(confirmCritical(t20, 18, 19)).toBe(false);
  });

  it("dentro da margem mas o sistema não declara rolls.critical: não confirma sozinho", () => {
    const noCritical: SystemDefinition = { ...t20, rolls: { ...t20.rolls, critical: undefined } };
    expect(confirmCritical(noCritical, 20, 20)).toBe(false);
  });

  it("dentro da margem e rolls.critical confirma (T20: sempre, natural >= 1)", () => {
    expect(confirmCritical(t20, 19, 19)).toBe(true);
    expect(confirmCritical(t20, 20, 19)).toBe(true);
  });

  it("dentro da margem mas rolls.critical de um sistema hipotético recusa (ex.: exige o 20 natural)", () => {
    const strict: SystemDefinition = { ...t20, rolls: { ...t20.rolls, critical: "{natural} == 20" } };
    expect(confirmCritical(strict, 19, 19)).toBe(false); // ameaçou (margem 19+) mas não confirmou
    expect(confirmCritical(strict, 20, 19)).toBe(true);
  });
});
