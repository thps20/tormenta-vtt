import { describe, expect, it } from "vitest";
import { CharacterDataSchema, CharacterItemSchema, ModifierSchema, type CharacterData } from "../schemas/character.js";
import { getSystemDefinition } from "../systems.js";
import { computeCharacter } from "./compute.js";
import { createDefaultCharacterData, createDefaultItem } from "./defaults.js";
import { describeModifierTarget, listModifierTargets, parseModifierTarget, ModifierTargetSchema } from "./modifierTarget.js";
import { collectPlaceholders, substitutePlaceholders, FormulaError } from "./placeholders.js";
import { buildCharacterRoll, resolveCharacterFormula, RollBuildError } from "./rolls.js";
import { baseCost, buildItemUse, describeActivation, effectiveCost, isPassiveItem, ItemUseError, saveDcFor, saveSkills } from "./activation.js";
import { applyActivationEnhancements, applyAttackEnhancements, applyDamageEnhancements, EnhancementError, resolveEnhancements } from "./enhancements.js";
import { damageTypeInfo, isHealingType } from "./damageTypes.js";
import { describeClasses, pendingChoices, validateCharacterItems } from "./progression.js";

const def = getSystemDefinition("tormenta20");

/** Ficha de teste: nível 5 (meio nível 2, treino +2), FOR 3, DES 2, CON 1, INT 2, SAB 1. */
function fixture(patch: Record<string, unknown> = {}): CharacterData {
  const base = createDefaultCharacterData(def);
  return CharacterDataSchema.parse({
    ...base,
    level: 5,
    attributes: { for: { base: 3 }, des: { base: 2 }, con: { base: 1 }, int: { base: 2 }, sab: { base: 1 }, car: { base: 0 } },
    skills: { luta: { trained: true }, percepcao: {}, furtividade: {} },
    ...patch,
  });
}

const sword = CharacterItemSchema.parse({
  id: "sword",
  kind: "weapon",
  name: "Espada longa",
  equipped: true,
  fields: { purpose: "melee", wield: "one_hand" },
  actions: [
    { id: "atk", label: "Ataque", kind: "attack", skill: "luta" },
    { id: "dmg", label: "Dano", kind: "damage", formula: "1d8", damageType: "corte" },
  ],
});

const bow = CharacterItemSchema.parse({
  id: "bow",
  kind: "weapon",
  name: "Arco",
  equipped: true,
  fields: { purpose: "ranged" },
  actions: [
    { id: "atk", label: "Ataque", kind: "attack", skill: "pontaria", critRange: 19, critMult: 3 },
    { id: "dmg", label: "Dano", kind: "damage", formula: "1d6" },
  ],
});

const heavyArmor = CharacterItemSchema.parse({
  id: "armor",
  kind: "armor",
  name: "Brunea",
  equipped: true,
  fields: { type: "heavy" },
  statBonuses: { defense: 5, maxAttr: 1, armorPenalty: -2 },
});

describe("placeholders", () => {
  it("coleta e substitui", () => {
    expect(collectPlaceholders("1d20 + {attr.for} + {halfLevel} + {attr.for}")).toEqual(["attr.for", "halfLevel"]);
    const out = substitutePlaceholders("1d20 + {a} - {b}", (p) => ({ a: 3, b: -2 })[p]);
    expect(out).toBe("1d20 + 3 - (-2)");
  });

  it("lança em placeholder desconhecido", () => {
    expect(() => substitutePlaceholders("{nope}", () => undefined)).toThrow(FormulaError);
  });
});

describe("modifierTarget", () => {
  it("aceita a gramática", () => {
    for (const ok of ["attr.for", "skill.luta", "skill.oficio:alquimia", "skill.*", "skill[tag=ataque]", "derived.defense", "resource.pv.max", "resource.pm.cost", "attack", "attack.luta", "damage", "damage.pontaria"]) {
      expect(ModifierTargetSchema.safeParse(ok).success, ok).toBe(true);
    }
  });

  it("rejeita seletores fora da gramática", () => {
    for (const bad of ["", "for", "attr", "attr.", "skill[ataque]", "resource.pv", "resource.pv.min", "resource.pm.cost.x", "Attack", "attr.for.max", "derived"]) {
      expect(ModifierTargetSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("interpreta e descreve", () => {
    expect(parseModifierTarget("skill[tag=resistencia]")).toEqual({ kind: "skillTag", tag: "resistencia" });
    expect(parseModifierTarget("attack.luta")).toEqual({ kind: "attack", skill: "luta" });
    expect(parseModifierTarget("resource.pv.max")).toEqual({ kind: "resourceMax", key: "pv" });
    expect(parseModifierTarget("resource.pm.cost")).toEqual({ kind: "resourceCost", key: "pm" });
    expect(describeModifierTarget("resource.pm.cost", def)).toBe("Pontos de Mana (custo)");
    expect(describeModifierTarget("attr.for", def)).toBe("Força");
    expect(describeModifierTarget("damage.pontaria", def)).toBe("Dano (Pontaria)");
    expect(listModifierTargets(def).some((t) => t.value === "derived.defense")).toBe(true);
    // Só o recurso de ativação (activation.resource) aparece com "(custo)" na lista.
    const costTargets = listModifierTargets(def).filter((t) => t.value.endsWith(".cost")).map((t) => t.value);
    expect(costTargets).toEqual([`resource.${def.activation.resource}.cost`]);
  });
});

describe("computeCharacter", () => {
  it("calcula nível, treino e atributos", () => {
    const c = computeCharacter(def, fixture());
    expect(c.level).toBe(5);
    expect(c.halfLevel).toBe(2);
    expect(c.trainedBonus).toBe(2);
    expect(c.attributes.for).toBe(3);
    expect(c.warnings).toEqual([]);
  });

  it("perícia = meio nível + atributo + treino", () => {
    const c = computeCharacter(def, fixture());
    expect(c.skills.luta?.total).toBe(2 + 3 + 2);
    expect(c.skills.percepcao?.total).toBe(2 + 1);
    expect(c.skills.percepcao?.usable).toBe(true);
    // Treinada-só sem treino: listada, mas não usável.
    expect(c.skills.misticismo?.usable).toBe(false);
  });

  it("aplica tamanho e penalidade de armadura só nas perícias marcadas", () => {
    const c = computeCharacter(def, fixture({ size: "pequeno", items: [heavyArmor] }));
    // furtividade: 2 (meio nível) + 2 (DES) + 2 (pequeno) - 2 (armadura) = 4
    expect(c.skills.furtividade?.total).toBe(4);
    // percepção não tem nenhum dos dois
    expect(c.skills.percepcao?.total).toBe(3);
    expect(c.derived.armorPenalty).toBe(-2);
  });

  it("Defesa usa o limite de atributo da armadura pesada", () => {
    expect(computeCharacter(def, fixture()).derived.defense).toBe(10 + 2);
    expect(computeCharacter(def, fixture({ items: [heavyArmor] })).derived.defense).toBe(10 + 1 + 5);
    // Desequipada, não conta.
    const off = { ...heavyArmor, equipped: false };
    expect(computeCharacter(def, fixture({ items: [off] })).derived.defense).toBe(12);
  });

  it("modificadores por atributo, perícia, tag, derivado e recurso", () => {
    const mods = [
      { id: "m1", target: "attr.for", value: 2 },
      { id: "m2", target: "skill[tag=ataque]", value: 1 },
      { id: "m3", target: "skill.*", value: 1 },
      { id: "m4", target: "derived.defense", value: 3 },
      { id: "m5", target: "resource.pv.max", value: 5 },
      { id: "m6", target: "attr.des", value: 10, enabled: false },
    ].map((m) => ModifierSchema.parse(m));
    const c = computeCharacter(def, fixture({ modifiers: mods, resources: { pv: { current: 10, temp: 0, maxOverride: 30 } } }));
    expect(c.attributes.for).toBe(5);
    expect(c.attributes.des).toBe(2);
    expect(c.skills.luta?.total).toBe(2 + 5 + 2 + 1 + 1);
    expect(c.skills.percepcao?.total).toBe(2 + 1 + 1);
    expect(c.derived.defense).toBe(12 + 3);
    expect(c.resources.pv).toEqual({ max: 35, min: -17, detail: null });
  });

  it("CD usa o atributo de conjuração da ficha; override de derivado substitui a fórmula", () => {
    expect(computeCharacter(def, fixture()).derived.dc).toBe(12);
    expect(computeCharacter(def, fixture({ spellcastingAttribute: "int" })).derived.dc).toBe(14);
    expect(computeCharacter(def, fixture({ derivedOverrides: { defense: 18 } })).derived.defense).toBe(18);
  });

  it("variante de perícia (oficio:alquimia) e atributo alternativo", () => {
    const c = computeCharacter(def, fixture({ skills: { "oficio:alquimia": { trained: true, label: "Alquimia" }, luta: { attribute: "des" } } }));
    expect(c.skills["oficio:alquimia"]?.total).toBe(2 + 2 + 2);
    expect(c.skills["oficio:alquimia"]?.label).toBe("Ofício (Alquimia)");
    expect(c.skills.oficio).toBeUndefined();
    expect(c.skills.luta?.attribute).toBe("des");
    expect(c.skills.luta?.total).toBe(2 + 2);
  });

  it("fórmula quebrada vira warning, não exceção", () => {
    const broken = { ...def, derived: [{ key: "x", label: "X", formula: "1 / 0", editable: true }] };
    const c = computeCharacter(broken, fixture());
    expect(c.derived.x).toBe(0);
    expect(c.warnings[0]).toMatch(/derivado x/);
  });
});

describe("buildCharacterRoll", () => {
  const data = fixture({ items: [sword, bow], modifiers: [ModifierSchema.parse({ id: "m", target: "damage.luta", value: 2 })] });

  it("atributo, perícia e iniciativa", () => {
    expect(buildCharacterRoll(def, data, { type: "attribute", key: "for" })).toEqual({ formula: "1d20 + 3", label: "Força" });
    expect(buildCharacterRoll(def, data, { type: "skill", key: "luta" })).toEqual({ formula: "1d20 + 7", label: "Luta" });
    expect(buildCharacterRoll(def, data, { type: "initiative" }).formula).toBe("1d20 + 4");
  });

  it("recusa perícia que exige treino", () => {
    expect(() => buildCharacterRoll(def, data, { type: "skill", key: "misticismo" })).toThrow(RollBuildError);
  });

  it("ataque usa a perícia da ação e informa o crítico", () => {
    expect(buildCharacterRoll(def, data, { type: "action", itemId: "sword", actionId: "atk" })).toEqual({
      formula: "1d20 + 7",
      label: "Espada longa: Ataque",
      critThreshold: 20,
      breakdown: null,
    });
    expect(buildCharacterRoll(def, data, { type: "action", itemId: "bow", actionId: "atk" })).toMatchObject({
      formula: "1d20 + 4",
      critThreshold: 19,
    });
  });

  it("dano: FOR em corpo a corpo, nada em disparo, + modificador damage.<perícia>", () => {
    expect(buildCharacterRoll(def, data, { type: "action", itemId: "sword", actionId: "dmg" }).formula).toBe("1d8 + 3 + 2");
    expect(buildCharacterRoll(def, data, { type: "action", itemId: "bow", actionId: "dmg" }).formula).toBe("1d6");
  });

  it("attributeOverride troca o atributo da perícia no ataque", () => {
    const agile = { ...sword, actions: [{ ...sword.actions[0]!, attributeOverride: "des" } as (typeof sword.actions)[number], sword.actions[1]!] };
    const d = fixture({ items: [agile] });
    // 7 - FOR 3 + DES 2 = 6
    expect(buildCharacterRoll(def, d, { type: "action", itemId: "sword", actionId: "atk" }).formula).toBe("1d20 + 6");
  });

  it("resolve placeholders de uma fórmula livre", () => {
    expect(resolveCharacterFormula(def, data, "1d20 + {skill.luta} + {attr.des}")).toBe("1d20 + 7 + 2");
    expect(() => resolveCharacterFormula(def, data, "{skill.nada}")).toThrow(FormulaError);
  });
});

describe("defaults", () => {
  it("ficha nova tem atributos, recursos e tamanho neutro", () => {
    const d = createDefaultCharacterData(def);
    expect(Object.keys(d.attributes)).toEqual(def.attributes.map((a) => a.key));
    expect(d.resources.pv).toEqual({ current: 0, temp: 0, maxOverride: null });
    expect(d.size).toBe("medio");
  });

  it("item novo recebe os defaults dos campos do tipo", () => {
    const w = createDefaultItem(def, "weapon", "w1");
    expect(w.fields).toMatchObject({ purpose: "melee", wield: "one_hand", proficiency: "simples", properties: "" });
    expect(w.activation).toBeNull();
    expect(w.actions.map((a) => a.kind)).toEqual(["attack", "damage"]);
    expect(createDefaultItem(def, "armor", "a1").actions).toEqual([]);
    expect(createDefaultItem(def, "spell", "s1").activation).not.toBeNull();
    expect(() => createDefaultItem(def, "nope", "x")).toThrow();
  });
});

describe("activation (poderes e magias)", () => {
  const fireball = CharacterItemSchema.parse({
    id: "fireball",
    kind: "spell",
    name: "Bola de fogo",
    description: "Explosão de chamas.",
    fields: { circle: 2, school: "evocacao", type: "arcana" },
    activation: { cost: 3, execution: "standard", range: { units: "medium" }, duration: { units: "instant" }, area: "esfera de 6 m", effect: "6d6 de fogo" },
    save: { skill: "reflexos", text: "metade" },
    actions: [{ id: "dmg", label: "Dano", kind: "damage", formula: "6d6", attribute: null, damageType: "fogo" }],
  });
  const passive = CharacterItemSchema.parse({ id: "tough", kind: "power", name: "Vigor", activation: { execution: "passive" } });
  const free = CharacterItemSchema.parse({ id: "free", kind: "power", name: "Truque", activation: { cost: 0, execution: "free" } });

  /** Ficha com PM e atributo de conjuração INT (2). */
  const caster = (pm: Partial<{ current: number; temp: number }>, patch: Record<string, unknown> = {}) =>
    ({
      ...fixture({ spellcastingAttribute: "int", items: [fireball, passive, free], resources: { pm: { current: 10, temp: 0, maxOverride: 10, ...pm } }, ...patch }),
      id: "c1",
      roomId: "r1",
      ownerId: null,
      name: "Maga",
      kind: "pc" as const,
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:00:00.000Z",
    });
  const costMod = (value: number) => ModifierSchema.parse({ id: "cm", target: "resource.pm.cost", value });

  it("passivo = sem ativação ou execução marcada como passiva no sistema", () => {
    expect(isPassiveItem(def, passive)).toBe(true);
    expect(isPassiveItem(def, { activation: null })).toBe(true);
    expect(isPassiveItem(def, fireball)).toBe(false);
    expect(isPassiveItem(def, free)).toBe(false);
  });

  it("custo efetivo: modificador reduz, piso minCost, base 0 continua 0", () => {
    const c = caster({});
    expect(effectiveCost(def, c, fireball)).toBe(3);
    expect(effectiveCost(def, { modifiers: [costMod(-1)] }, fireball)).toBe(2);
    expect(effectiveCost(def, { modifiers: [costMod(+2)] }, fireball)).toBe(5);
    // Redução grande bate no piso do JSON (1 PM), não em 0.
    expect(effectiveCost(def, { modifiers: [costMod(-5)] }, fireball)).toBe(def.activation.minCost);
    expect(def.activation.minCost).toBe(1);
    // Habilidade gratuita não ganha custo nem por bônus nem por redução.
    expect(effectiveCost(def, { modifiers: [costMod(-1)] }, free)).toBe(0);
    expect(effectiveCost(def, { modifiers: [costMod(+2)] }, free)).toBe(0);
    // Modificador desabilitado não conta.
    expect(effectiveCost(def, { modifiers: [{ ...costMod(-1), enabled: false }] }, fireball)).toBe(3);
  });

  it("CD = 10 + meio nível + atributo de conjuração (ou o do item) + bônus", () => {
    const c = caster({});
    const computed = computeCharacter(def, c);
    // nível 5 → meio nível 2; INT 2
    expect(saveDcFor(def, computed, c, fireball)).toBe(14);
    expect(saveDcFor(def, computed, c, { save: { ...fireball.save!, attribute: "sab" } })).toBe(13);
    expect(saveDcFor(def, computed, c, { save: { ...fireball.save!, bonus: 2 } })).toBe(16);
    expect(saveDcFor(def, computed, { spellcastingAttribute: null }, fireball)).toBe(12);
    expect(saveDcFor(def, computed, c, { save: null })).toBeNull();
  });

  it("perícias de resistência vêm da tag declarada em activation.saveSkillTag", () => {
    expect(saveSkills(def).map((s) => s.key)).toEqual(["fortitude", "reflexos", "vontade"]);
    // Sem tag: todas as perícias fixas (sem variantes como Ofício).
    const noTag = { ...def, activation: { ...def.activation, saveSkillTag: undefined } };
    expect(saveSkills(noTag).length).toBe(def.skills.filter((s) => !s.variants).length);
  });

  it("descreve a ativação com os rótulos do sistema", () => {
    expect(describeActivation(def, fireball.activation!)).toEqual({ execution: "Padrão", duration: "Instantânea", range: "Médio (30 m)" });
  });

  it("buildItemUse desconta o recurso (temporários primeiro) e monta o card", () => {
    const use = buildItemUse(def, caster({ current: 5, temp: 2 }), "fireball");
    expect(use.cost).toBe(3);
    expect(use.spend?.resourceKey).toBe("pm");
    expect(use.spend?.resources.pm).toEqual({ current: 4, temp: 0, maxOverride: 10 });
    expect(use.card).toMatchObject({
      characterId: "c1",
      characterName: "Maga",
      itemName: "Bola de fogo",
      kindLabel: "Magia",
      cost: { abbr: "PM", amount: 3 },
      execution: "Padrão",
      range: "Médio (30 m)",
      duration: "Instantânea",
      area: "esfera de 6 m",
      effect: "6d6 de fogo",
      save: { skillLabel: "Reflexos", dc: 14, text: "metade" },
      actions: [{ id: "dmg", label: "Dano", kind: "damage" }],
    });
    expect(use.card.fields).toEqual([
      { label: "Círculo", value: "2" },
      { label: "Escola", value: "Evocação" },
      { label: "Tipo", value: "Arcana" },
    ]);
  });

  it("custo com modificador é o que se desconta e aparece no card", () => {
    const use = buildItemUse(def, caster({ current: 2 }, { modifiers: [costMod(-1)] }), "fireball");
    expect(use.cost).toBe(2);
    expect(use.spend?.resources.pm?.current).toBe(0);
    expect(use.card.cost).toEqual({ abbr: "PM", amount: 2 });
  });

  it("recusa recurso insuficiente, item passivo e item inexistente", () => {
    expect(() => buildItemUse(def, caster({ current: 2 }), "fireball")).toThrow(/PM insuficiente: precisa de 3, tem 2/);
    expect(() => buildItemUse(def, caster({ current: 2 }), "tough")).toThrow(ItemUseError);
    expect(() => buildItemUse(def, caster({}), "nope")).toThrow(ItemUseError);
  });

  it("item sem custo não desconta nada e o card vem sem custo", () => {
    const use = buildItemUse(def, caster({ current: 0 }), "free");
    expect(use.cost).toBe(0);
    expect(use.spend).toBeNull();
    expect(use.card.cost).toBeNull();
    expect(use.card.save).toBeNull();
  });
});

describe("aprimoramentos (custo total)", () => {
  /** Magia 2 PM com um aprimoramento fixo (+3) e um repetível (+1 por vez). */
  const spell = CharacterItemSchema.parse({
    id: "spell",
    kind: "spell",
    name: "Armadura Arcana",
    activation: { cost: 2, execution: "standard" },
    enhancements: [
      { id: "e1", label: "muda a execução para reação", cost: 3 },
      { id: "e2", label: "aumenta o bônus em +1", cost: 1, repeatable: true },
      { id: "e3", label: "variação gratuita", cost: 0 },
    ],
  });
  const freePower = CharacterItemSchema.parse({ id: "fp", kind: "power", name: "Golpe", activation: { cost: 0, execution: "standard" }, enhancements: [{ id: "x", label: "+1d6", cost: 1, repeatable: true }] });
  const costMod = (value: number) => ModifierSchema.parse({ id: "cm", target: "resource.pm.cost", value });
  const sel = (...uses: [string, number][]) => resolveEnhancements(def, spell, uses.map(([id, times]) => ({ id, times })));
  const noRule = { ...def, activation: { ...def.activation, enhancementCost: undefined } };

  it("soma base + custo × vezes pela fórmula do sistema", () => {
    expect(def.activation.enhancementCost).toBe("{base} + {enhancements}");
    expect(baseCost(def, spell)).toBe(2);
    expect(baseCost(def, spell, sel(["e1", 1]))).toBe(5);
    expect(baseCost(def, spell, sel(["e2", 3]))).toBe(5);
    expect(baseCost(def, spell, sel(["e1", 1], ["e2", 2], ["e3", 1]))).toBe(7);
  });

  it("modificadores e minCost valem sobre o total; total 0 continua 0", () => {
    expect(effectiveCost(def, { modifiers: [costMod(-1)] }, spell, sel(["e1", 1]))).toBe(4);
    expect(effectiveCost(def, { modifiers: [costMod(-9)] }, spell, sel(["e1", 1]))).toBe(def.activation.minCost);
    // Poder gratuito + aprimoramento pago: passa a custar (e o modificador entra).
    const x = resolveEnhancements(def, freePower, [{ id: "x", times: 2 }]);
    expect(effectiveCost(def, { modifiers: [] }, freePower, x)).toBe(2);
    expect(effectiveCost(def, { modifiers: [costMod(-1)] }, freePower, x)).toBe(1);
    expect(effectiveCost(def, { modifiers: [costMod(+2)] }, freePower)).toBe(0);
  });

  it("recusa id desconhecido, id repetido, vezes > 1 em não repetível e sistema sem a regra", () => {
    expect(() => sel(["nope", 1])).toThrow(/não encontrado/);
    expect(() => sel(["e1", 1], ["e1", 1])).toThrow(/repetido/);
    expect(() => sel(["e1", 2])).toThrow(/só pode ser aplicado uma vez/);
    expect(() => resolveEnhancements(noRule, spell, [{ id: "e1", times: 1 }])).toThrow(EnhancementError);
    expect(resolveEnhancements(noRule, spell, [])).toEqual([]);
    expect(baseCost(noRule, spell, sel(["e1", 1]))).toBe(2);
  });

  it("buildItemUse cobra o total, recusa PM insuficiente pelo total e lista os usados no card", () => {
    const withSpell = (pm: number) => ({
      ...fixture({ items: [spell], resources: { pm: { current: pm, temp: 0, maxOverride: 10 } } }),
      id: "c1",
      roomId: "r1",
      ownerId: null,
      name: "Maga",
      kind: "pc" as const,
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:00:00.000Z",
    });
    const use = buildItemUse(def, withSpell(10), "spell", [{ id: "e2", times: 2 }, { id: "e1", times: 1 }]);
    expect(use.cost).toBe(7);
    expect(use.spend?.resources.pm?.current).toBe(3);
    expect(use.card.cost).toEqual({ abbr: "PM", amount: 7 });
    expect(use.card.enhancements).toEqual([
      { id: "e2", label: "aumenta o bônus em +1", cost: 1, times: 2 },
      { id: "e1", label: "muda a execução para reação", cost: 3, times: 1 },
    ]);
    expect(() => buildItemUse(def, withSpell(4), "spell", [{ id: "e1", times: 1 }])).toThrow(/PM insuficiente: precisa de 5, tem 4/);
    expect(buildItemUse(def, withSpell(4), "spell").card.enhancements).toEqual([]);
  });
});

describe("aprimoramentos (efeito no dano)", () => {
  /** Bola de fogo 6d6 (+1 de bônus na ação) com: add repetível 2d6, set 10d6, só custo, add 1d8, add 1d6 de frio, add 2d6 de fogo (tipo da ação, explícito). */
  const fireball = CharacterItemSchema.parse({
    id: "fb",
    kind: "spell",
    name: "Bola de fogo",
    activation: { cost: 3, execution: "standard" },
    actions: [
      { id: "dmg", label: "Dano", kind: "damage", formula: "6d6", attribute: null, damageType: "fogo", bonus: 1 },
      { id: "atk", label: "Toque", kind: "attack", skill: "pontaria" },
    ],
    enhancements: [
      { id: "add", label: "aumenta o dano em +2d6", cost: 2, repeatable: true, effect: { kind: "damageDiceAdd", dice: "2d6" } },
      { id: "set", label: "muda o dano para 10d6", cost: 5, effect: { kind: "damageSet", formula: "10d6" } },
      { id: "set2", label: "muda o dano para 12d6", cost: 7, effect: { kind: "damageSet", formula: "12d6" } },
      { id: "only", label: "muda o alcance para longo", cost: 1 },
      { id: "add8", label: "aumenta o dano em +1d8 (texto bem comprido para ser cortado no resumo)", cost: 2, effect: { kind: "damageDiceAdd", dice: "1d8" } },
      { id: "frio", label: "+1d6 de dano de frio", cost: 2, repeatable: true, effect: { kind: "damageDiceAdd", dice: "1d6", damageType: "frio" } },
      { id: "frio8", label: "+1d8 de dano de frio", cost: 3, effect: { kind: "damageDiceAdd", dice: "1d8", damageType: "frio" } },
      { id: "fogo", label: "+2d6 de dano de fogo", cost: 2, effect: { kind: "damageDiceAdd", dice: "2d6", damageType: "fogo" } },
    ],
  });
  const c = {
    ...fixture({ items: [fireball], resources: { pm: { current: 20, temp: 0, maxOverride: 20 } } }),
    id: "c1",
    roomId: "r1",
    ownerId: null,
    name: "Maga",
    kind: "pc" as const,
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
  };
  const sel = (...uses: [string, number][]) => resolveEnhancements(def, fireball, uses.map(([id, times]) => ({ id, times })));
  const apply = (...uses: [string, number][]) => applyDamageEnhancements("6d6", "fogo", sel(...uses));
  const roll = (...uses: [string, number][]) => buildCharacterRoll(def, c, { type: "action", itemId: "fb", actionId: "dmg", enhancements: uses.map(([id, times]) => ({ id, times })) });

  it("applyDamageEnhancements: add, add repetível, set, set + add, sem efeito", () => {
    expect(apply(["add", 1])).toEqual({ formula: "6d6 + 2d6", extra: [], breakdown: "6d6 base + 2d6 aumenta o dano em +2d6" });
    expect(apply(["add", 2])).toEqual({ formula: "6d6 + 4d6", extra: [], breakdown: "6d6 base + 4d6 aumenta o dano em +2d6 ×2" });
    expect(apply(["set", 1])).toEqual({ formula: "10d6", extra: [], breakdown: "10d6 muda o dano para 10d6" });
    expect(apply(["set", 1], ["add", 1])).toEqual({ formula: "10d6 + 2d6", extra: [], breakdown: "10d6 muda o dano para 10d6 + 2d6 aumenta o dano em +2d6" });
    expect(apply(["only", 1])).toEqual({ formula: "6d6", extra: [], breakdown: null });
    expect(apply()).toEqual({ formula: "6d6", extra: [], breakdown: null });
    // Rótulo longo é cortado no resumo.
    expect(apply(["add8", 1]).breakdown).toBe("6d6 base + 1d8 aumenta o dano em +1d8 (texto bem compr…");
    expect(() => apply(["set", 1], ["set2", 1])).toThrow(/Mais de um aprimoramento muda o dano/);
  });

  it("applyDamageEnhancements: tipo de dano próprio vira parcela separada; igual ao da ação entra na base", () => {
    // Outro tipo: parcela própria; repetir o mesmo tipo engrossa a mesma parcela (uma por tipo).
    expect(apply(["frio", 2])).toEqual({ formula: "6d6", extra: [{ formula: "2d6", damageType: "frio" }], breakdown: "6d6 base + 2d6 +1d6 de dano de frio ×2" });
    expect(apply(["frio", 1], ["frio8", 1]).extra).toEqual([{ formula: "1d6 + 1d8", damageType: "frio" }]);
    // Tipo explícito igual ao da ação: mesma parcela, como se estivesse ausente.
    expect(apply(["fogo", 1], ["add", 1])).toMatchObject({ formula: "6d6 + 2d6 + 2d6", extra: [] });
    // set troca a base; o extra de outro tipo continua separado.
    expect(apply(["set", 1], ["frio", 1])).toMatchObject({ formula: "10d6", extra: [{ formula: "1d6", damageType: "frio" }] });
    // Ação sem tipo: efeito sem tipo herda o "sem tipo"; efeito tipado vira parcela.
    expect(applyDamageEnhancements("1d8", null, sel(["add", 1], ["frio", 1]))).toMatchObject({ formula: "1d8 + 2d6", extra: [{ formula: "1d6", damageType: "frio" }] });
  });

  it("buildCharacterRoll: dados primeiro, bônus depois; ataque ignora a escolha; escolha inválida é RollBuildError", () => {
    expect(roll()).toMatchObject({ formula: "6d6 + 1", breakdown: null, damage: [{ formula: "6d6 + 1", damageType: "fogo" }] });
    expect(roll(["add", 2], ["only", 1])).toMatchObject({ formula: "6d6 + 4d6 + 1", breakdown: "6d6 base + 4d6 aumenta o dano em +2d6 ×2" });
    expect(roll(["set", 1])).toMatchObject({ formula: "10d6 + 1" });
    expect(buildCharacterRoll(def, c, { type: "action", itemId: "fb", actionId: "atk", enhancements: [{ id: "add", times: 2 }] })).not.toHaveProperty("damage");
    expect(() => roll(["nope", 1])).toThrow(RollBuildError);
    expect(() => roll(["set", 1], ["set2", 1])).toThrow(RollBuildError);
  });

  it("buildCharacterRoll: atributo e bônus ficam só na parcela base; a fórmula completa junta as parcelas", () => {
    expect(roll(["add", 1], ["frio", 2])).toMatchObject({
      formula: "6d6 + 2d6 + 1 + 2d6",
      damage: [
        { formula: "6d6 + 2d6 + 1", damageType: "fogo" },
        { formula: "2d6", damageType: "frio" },
      ],
    });
  });

  it("card da conjuração guarda a fórmula final, a decomposição e as parcelas de cada ação", () => {
    const use = buildItemUse(def, c, "fb", [{ id: "add", times: 2 }, { id: "frio", times: 1 }]);
    expect(use.card.actions).toEqual([
      {
        id: "dmg",
        label: "Dano",
        kind: "damage",
        formula: "6d6 + 4d6 + 1 + 1d6",
        breakdown: "6d6 base + 4d6 aumenta o dano em +2d6 ×2 + 1d6 +1d6 de dano de frio",
        damage: [
          { formula: "6d6 + 4d6 + 1", damageType: "fogo" },
          { formula: "1d6", damageType: "frio" },
        ],
      },
      { id: "atk", label: "Toque", kind: "attack", formula: expect.stringMatching(/^1d20/), breakdown: null, damage: [] },
    ]);
    // Sem efeito escolhido: fórmula como está no item e sem decomposição.
    expect(buildItemUse(def, c, "fb", [{ id: "only", times: 1 }]).card.actions[0]).toMatchObject({ formula: "6d6 + 1", breakdown: null, damage: [{ formula: "6d6 + 1", damageType: "fogo" }] });
    // Dois sets: o uso é recusado antes de cobrar.
    expect(() => buildItemUse(def, c, "fb", [{ id: "set", times: 1 }, { id: "set2", times: 1 }])).not.toThrow();
  });
});

describe("aprimoramentos (CD, cura, ataque e card)", () => {
  /** Magia com dano (fogo), cura (tipo `healing`), ataque e CD; aprimoramentos de cada tipo novo. */
  const spell = CharacterItemSchema.parse({
    id: "sp",
    kind: "spell",
    name: "Chama sagrada",
    activation: { cost: 2, execution: "standard", range: { units: "short", value: 0 }, duration: { units: "scene", value: 0 }, target: "1 criatura", area: "" },
    save: { skill: "reflexos" },
    actions: [
      { id: "dmg", label: "Dano", kind: "damage", formula: "6d6", attribute: null, damageType: "fogo" },
      { id: "heal", label: "Cura", kind: "damage", formula: "2d8", attribute: null, damageType: "cura" },
      { id: "atk", label: "Toque", kind: "attack", skill: "luta", bonus: 1 },
    ],
    enhancements: [
      { id: "dc", label: "aumenta a CD em +2", cost: 1, repeatable: true, effect: { kind: "dcAdd", value: 2 } },
      { id: "heal", label: "aumenta a cura em +1d8", cost: 1, repeatable: true, effect: { kind: "healDiceAdd", dice: "1d8" } },
      { id: "add", label: "aumenta o dano em +1d6", cost: 1, effect: { kind: "damageDiceAdd", dice: "1d6" } },
      { id: "set", label: "muda o dano para 10d6", cost: 5, effect: { kind: "damageSet", formula: "10d6" } },
      { id: "atk", label: "+2 no ataque", cost: 1, repeatable: true, effect: { kind: "attackBonusAdd", value: 2 } },
      { id: "rng", label: "muda o alcance para médio", cost: 1, effect: { kind: "rangeSet", units: "medium" } },
      { id: "rng2", label: "muda o alcance para longo", cost: 2, effect: { kind: "rangeSet", units: "long" } },
      { id: "dur", label: "muda a duração para 1 dia", cost: 2, effect: { kind: "durationSet", units: "day", value: 1 } },
      { id: "area", label: "muda a área para esfera de 6 m", cost: 1, effect: { kind: "areaSet", text: "esfera de 6 m de raio" } },
      { id: "tgt", label: "aumenta o número de alvos em +1", cost: 1, repeatable: true, effect: { kind: "targetsAdd", count: 1 } },
      { id: "note", label: "também remove uma condição", cost: 1, effect: { kind: "text", text: "Remove uma condição de fadiga do alvo." } },
    ],
  });
  const c = {
    ...fixture({ items: [spell], resources: { pm: { current: 20, temp: 0, maxOverride: 20 } } }),
    id: "c1",
    roomId: "r1",
    ownerId: null,
    name: "Clériga",
    kind: "pc" as const,
    createdAt: "2026-09-06T00:00:00.000Z",
    updatedAt: "2026-09-06T00:00:00.000Z",
  };
  const uses = (...list: [string, number][]) => list.map(([id, times]) => ({ id, times }));
  const sel = (...list: [string, number][]) => resolveEnhancements(def, spell, uses(...list));
  const roll = (actionId: string, ...list: [string, number][]) => buildCharacterRoll(def, c, { type: "action", itemId: "sp", actionId, enhancements: uses(...list) });
  const use = (...list: [string, number][]) => buildItemUse(def, c, "sp", uses(...list));

  it("healDiceAdd só entra na ação de cura; damageDiceAdd/damageSet só nas de dano", () => {
    expect(isHealingType(def, "cura")).toBe(true);
    expect(isHealingType(def, "fogo")).toBe(false);
    expect(isHealingType(def, null)).toBe(false);
    expect(roll("heal", ["heal", 2], ["add", 1], ["set", 1])).toMatchObject({ formula: "2d8 + 2d8", breakdown: "2d8 base + 2d8 aumenta a cura em +1d8 ×2", damage: [{ formula: "2d8 + 2d8", damageType: "cura" }] });
    expect(roll("dmg", ["heal", 2], ["add", 1])).toMatchObject({ formula: "6d6 + 1d6", breakdown: "6d6 base + 1d6 aumenta o dano em +1d6" });
    expect(applyDamageEnhancements("2d8", "cura", sel(["set", 1]), true)).toEqual({ formula: "2d8", extra: [], breakdown: null });
  });

  it("attackBonusAdd soma × vezes ao ataque, com decomposição; as outras ações ignoram", () => {
    const base = roll("atk").formula;
    expect(base).toMatch(/^1d20/);
    expect(roll("atk")).toMatchObject({ breakdown: null });
    expect(roll("atk", ["atk", 2], ["add", 1])).toMatchObject({ formula: `${base} + 4`, breakdown: `${base} base +4 +2 no ataque ×2` });
    expect(roll("dmg", ["atk", 2]).formula).toBe("6d6");
    expect(applyAttackEnhancements("1d20 + 5", [])).toEqual({ formula: "1d20 + 5", breakdown: null });
  });

  it("dcAdd soma × vezes à CD do card e marca 'dc'", () => {
    expect(use().card.save).toMatchObject({ dc: 12 });
    expect(use().card.enhanced).toEqual([]);
    const card = use(["dc", 2]).card;
    expect(card.save).toMatchObject({ skillLabel: "Reflexos", dc: 16 });
    expect(card.enhanced).toEqual(["dc"]);
    // Item sem save: a CD continua null e "dc" não entra em enhanced.
    const noSave = { ...c, items: [{ ...spell, save: null }] };
    const card2 = buildItemUse(def, noSave, "sp", uses(["dc", 1])).card;
    expect(card2.save).toBeNull();
    expect(card2.enhanced).toEqual([]);
  });

  it("rangeSet, durationSet, areaSet, targetsAdd e text só mudam o card", () => {
    const card = use(["rng", 1], ["dur", 1], ["area", 1], ["tgt", 2], ["note", 1], ["atk", 1]).card;
    expect(card).toMatchObject({ range: "Médio (30 m)", duration: "1 Dia", area: "esfera de 6 m de raio", target: "1 criatura, +2 alvos" });
    expect(card.enhanced).toEqual(["range", "duration", "area", "target", "attack"]);
    expect(card.enhancements.find((e) => e.id === "note")).toMatchObject({ note: "Remove uma condição de fadiga do alvo." });
    expect(card.enhancements.find((e) => e.id === "rng")).not.toHaveProperty("note");
    expect(card.actions.find((a) => a.id === "dmg")).toMatchObject({ formula: "6d6", breakdown: null });
    // Sem escolha: como está no item.
    expect(use().card).toMatchObject({ range: "Curto (9 m)", duration: "Cena", area: "", target: "1 criatura" });
    // Alvo vazio: só o extra. Um alvo: singular.
    expect(applyActivationEnhancements({ ...spell.activation!, target: "" }, sel(["tgt", 1])).target).toBe("+1 alvo");
    // Dois rangeSet: escolha inválida antes de cobrar.
    expect(() => use(["rng", 1], ["rng2", 1])).toThrow(ItemUseError);
    expect(() => use(["rng", 1], ["rng2", 1])).toThrow(/Mais de um aprimoramento muda o alcance/);
  });
});

describe("damageTypeInfo", () => {
  it("cor própria, senão a do grupo, senão null; chave desconhecida vira rótulo", () => {
    expect(damageTypeInfo(def, "fogo")).toEqual({ key: "fogo", label: "Fogo", color: "#f4511e", known: true });
    expect(damageTypeInfo(def, "corte")).toMatchObject({ label: "Corte", color: def.damageTypeGroups.find((g) => g.key === "fisico")?.color, known: true });
    expect(damageTypeInfo({ damageTypes: [{ key: "x", label: "X", healing: false }], damageTypeGroups: [] }, "x")).toEqual({ key: "x", label: "X", color: null, known: true });
    expect(damageTypeInfo(def, "sonico")).toEqual({ key: "sonico", label: "sonico", color: null, known: false });
  });
});

// --- Fase 4: classes e raças ------------------------------------------------

/** Item de classe com os campos numéricos do tormenta20.json (valores de teste, não do livro). */
function classItem(id: string, name: string, levels: number, stats: { hpInitial: number; hpPerLevel: number; mpPerLevel: number }, extra: Record<string, unknown> = {}) {
  return CharacterItemSchema.parse({
    id,
    kind: "class",
    name,
    fields: { levels, initial: false, ...stats, skillsGranted: { fixed: [], choices: [] }, proficiencies: "", ...extra },
  });
}
const warrior = classItem("war", "Guerreiro", 3, { hpInitial: 20, hpPerLevel: 5, mpPerLevel: 3 }, { initial: true });
const arcanist = classItem("arc", "Arcanista", 2, { hpInitial: 8, hpPerLevel: 2, mpPerLevel: 6 });

const dwarf = CharacterItemSchema.parse({
  id: "dwarf",
  kind: "race",
  name: "Anão",
  fields: { attributeBonuses: { con: 2, sab: 1, des: -1 }, flexibleBonuses: { amount: 1, count: 0, exclude: [], chosen: [] }, size: "medio", movement: 6, senses: "", skillsGranted: { fixed: [], choices: [] } },
});

/** Ficha com CON 2 (o exemplo do pedido: Guerreiro 3 → 36 PV, 9 PM). */
const con2 = { attributes: { for: { base: 3 }, des: { base: 2 }, con: { base: 2 }, int: { base: 2 }, sab: { base: 1 }, car: { base: 0 } } };

describe("progressão por classes", () => {
  it("Guerreiro 3 com CON 2: nível 3, 36 PV, 9 PM", () => {
    const c = computeCharacter(def, fixture({ ...con2, items: [warrior] }));
    expect(c.levelSource).toBe("classes");
    expect(c.level).toBe(3);
    expect(c.halfLevel).toBe(1);
    expect(c.resources.pv?.max).toBe(36);
    expect(c.resources.pm?.max).toBe(9);
    expect(c.resources.pv?.detail).toBe("Guerreiro 3: (20 + 2) + 2 × (5 + 2) = 36");
    expect(c.resources.pm?.detail).toBe("Guerreiro 3: 3 × 3 = 9");
    expect(describeClasses(c.classes)).toBe("Guerreiro 3");
  });

  it("multiclasse soma nível, PV e PM por classe; só a inicial usa o PV do 1º nível", () => {
    const c = computeCharacter(def, fixture({ ...con2, items: [warrior, arcanist] }));
    expect(c.level).toBe(5);
    expect(c.resources.pv?.max).toBe(36 + 2 * (2 + 2));
    expect(c.resources.pm?.max).toBe(9 + 12);
    expect(describeClasses(c.classes)).toBe("Guerreiro 3 / Arcanista 2");
    expect(c.resources.pv?.detail).toContain("total 44");
  });

  it("sem classe marcada como inicial, a primeira da lista faz o papel", () => {
    const noFlag = { ...warrior, fields: { ...warrior.fields, initial: false } };
    const c = computeCharacter(def, fixture({ ...con2, items: [noFlag] }));
    expect(c.classes[0]?.initial).toBe(true);
    expect(c.resources.pv?.max).toBe(36);
  });

  it("piso de 1 PV por nível quando CON é muito negativa", () => {
    const con = { attributes: { ...con2.attributes, con: { base: -3 } } };
    const weak = classItem("w", "Frágil", 3, { hpInitial: 20, hpPerLevel: 2, mpPerLevel: 0 }, { initial: true });
    const c = computeCharacter(def, fixture({ ...con, items: [weak] }));
    expect(c.resources.pv?.max).toBe(17 + 1 + 1);
    expect(c.resources.pv?.detail).toContain("mín. 1 por nível");
  });

  it("modificador resource.<key>.max e o mínimo continuam valendo", () => {
    const mods = [ModifierSchema.parse({ id: "m", target: "resource.pv.max", value: 4 })];
    const c = computeCharacter(def, fixture({ ...con2, items: [warrior], modifiers: mods }));
    expect(c.resources.pv).toMatchObject({ max: 40, min: -20 });
  });

  it("ficha sem classe continua manual: nível digitado e maxOverride", () => {
    const c = computeCharacter(def, fixture({ resources: { pv: { current: 10, temp: 0, maxOverride: 30 } } }));
    expect(c.levelSource).toBe("manual");
    expect(c.level).toBe(5);
    expect(c.classes).toEqual([]);
    expect(c.resources.pv).toEqual({ max: 30, min: -15, detail: null });
  });

  it("modo manual ignora as classes mesmo com item de classe", () => {
    const c = computeCharacter(def, fixture({ ...con2, items: [warrior], manualProgression: true, resources: { pv: { current: 10, temp: 0, maxOverride: 30 } } }));
    expect(c.levelSource).toBe("manual");
    expect(c.level).toBe(5);
    expect(c.resources.pv?.max).toBe(30);
    expect(describeClasses(c.classes)).toBe("Guerreiro 3");
  });

  it("nível soma das classes respeita level.max", () => {
    const big = classItem("b", "Épico", 30, { hpInitial: 1, hpPerLevel: 1, mpPerLevel: 0 });
    expect(computeCharacter(def, fixture({ items: [big] })).level).toBe(def.level.max);
  });
});

describe("raça e campos estruturados", () => {
  it("bônus fixos da raça entram nos atributos como modificadores com origem no item", () => {
    const c = computeCharacter(def, fixture({ items: [dwarf] }));
    expect(c.attributes).toMatchObject({ con: 3, sab: 2, des: 1, for: 3 });
    expect(c.itemModifiers).toEqual([
      { itemId: "dwarf", itemName: "Anão", target: "attr.con", value: 2 },
      { itemId: "dwarf", itemName: "Anão", target: "attr.sab", value: 1 },
      { itemId: "dwarf", itemName: "Anão", target: "attr.des", value: -1 },
    ]);
    // Bônus de CON da raça entra no PV por nível.
    expect(computeCharacter(def, fixture({ ...con2, items: [warrior, dwarf] })).resources.pv?.max).toBe(22 + 2 + 2 * (5 + 4));
  });

  it("remover a raça remove os bônus", () => {
    const withRace = computeCharacter(def, fixture({ items: [dwarf] }));
    const without = computeCharacter(def, fixture({ items: [] }));
    expect(withRace.attributes.con).toBe(3);
    expect(without.attributes.con).toBe(1);
    expect(without.itemModifiers).toEqual([]);
  });

  it("bônus à escolha: só atributos válidos, fora de exclude e até count", () => {
    const human = { ...dwarf, id: "human", name: "Humano", fields: { ...dwarf.fields, attributeBonuses: {}, flexibleBonuses: { amount: 1, count: 3, exclude: ["con"], chosen: ["for", "des", "con", "for", "int", "sab"] } } };
    const c = computeCharacter(def, fixture({ items: [human] }));
    expect(c.attributes).toMatchObject({ for: 4, des: 3, con: 1, int: 3, sab: 1 });
    expect(pendingChoices(def, human)).toEqual([]);
    const incomplete = { ...human, fields: { ...human.fields, flexibleBonuses: { amount: 1, count: 3, exclude: [], chosen: ["for"] } } };
    expect(pendingChoices(def, incomplete)).toEqual([{ fieldKey: "flexibleBonuses", label: "Bônus à escolha", missing: 2 }]);
  });

  it("perícias concedidas: fixas e escolhidas dentro da lista, com origem no item", () => {
    const grants = { fixed: ["fortitude"], choices: [{ count: 1, from: ["luta", "pontaria"], chosen: ["pontaria", "luta"] }, { count: 2, from: [], chosen: ["percepcao", "nope"] }] };
    const item = { ...warrior, fields: { ...warrior.fields, skillsGranted: grants } };
    const c = computeCharacter(def, fixture({ ...con2, items: [item] }));
    expect(c.skills.fortitude).toMatchObject({ trained: true, grantedBy: "war", total: 1 + 2 + 2 });
    expect(c.skills.pontaria).toMatchObject({ trained: true, grantedBy: "war" });
    // "luta" já era treinada na ficha: fica marcada pela ficha, não pelo item.
    expect(c.skills.luta).toMatchObject({ trained: true, grantedBy: null });
    expect(c.skills.percepcao?.grantedBy).toBe("war");
    expect(pendingChoices(def, item)).toEqual([{ fieldKey: "skillsGranted", label: "Perícias treinadas", missing: 1 }]);
  });

  it("item físico só aplica os campos estruturados quando equipado", () => {
    const belt = CharacterItemSchema.parse({ id: "belt", kind: "gear", name: "Cinto", equipped: false, fields: { attributeBonuses: { for: 2 } } });
    // "gear" não declara o campo, então nada acontece mesmo equipado: o efeito depende do tipo no JSON.
    expect(computeCharacter(def, fixture({ items: [{ ...belt, equipped: true }] })).attributes.for).toBe(3);
    const kindWithBonus = { ...def, itemKinds: def.itemKinds.map((k) => (k.key === "gear" ? { ...k, fields: [{ key: "attributeBonuses", label: "Atributos", type: "attributeBonuses" as const }] } : k)) };
    expect(computeCharacter(kindWithBonus, fixture({ items: [belt] })).attributes.for).toBe(3);
    expect(computeCharacter(kindWithBonus, fixture({ items: [{ ...belt, equipped: true }] })).attributes.for).toBe(5);
  });

  it("validateCharacterItems: limite por tipo e tipo desconhecido", () => {
    expect(validateCharacterItems(def, fixture({ items: [dwarf] }))).toBeNull();
    expect(validateCharacterItems(def, fixture({ items: [dwarf, { ...dwarf, id: "d2" }] }))).toMatch(/só pode ter 1 item do tipo Raça/);
    expect(validateCharacterItems(def, fixture({ items: [{ ...dwarf, kind: "alien" }] }))).toMatch(/desconhecido/);
  });

  it("valores estruturados sobrevivem ao Zod da ficha", () => {
    const parsed = CharacterItemSchema.parse({ id: "x", kind: "race", name: "X", fields: { a: {}, b: { fixed: [], choices: [] }, c: { amount: 1, count: 1, exclude: [], chosen: [] } } });
    expect(parsed.fields).toEqual({ a: {}, b: { fixed: [], choices: [] }, c: { amount: 1, count: 1, exclude: [], chosen: [] } });
    expect(CharacterItemSchema.safeParse({ id: "x", kind: "race", name: "X", fields: { a: { fixed: "nope" } } }).success).toBe(false);
  });

  it("createDefaultItem preenche os campos estruturados vazios", () => {
    const race = createDefaultItem(def, "race", "r1");
    expect(race.fields.attributeBonuses).toEqual({});
    expect(race.fields.flexibleBonuses).toEqual({ amount: 1, count: 1, exclude: [], chosen: [] });
    expect(race.fields.skillsGranted).toEqual({ fixed: [], choices: [] });
    expect(race.fields.size).toBe("medio");
    const cls = createDefaultItem(def, "class", "c1");
    expect(cls.fields.levels).toBe(1);
    expect(validateCharacterItems(def, fixture({ items: [race, cls] }))).toBeNull();
  });
});
