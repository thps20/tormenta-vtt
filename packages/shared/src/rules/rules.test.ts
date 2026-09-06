import { describe, expect, it } from "vitest";
import { CharacterDataSchema, CharacterItemSchema, ModifierSchema, type CharacterData } from "../schemas/character.js";
import { getSystemDefinition } from "../systems.js";
import { computeCharacter } from "./compute.js";
import { createDefaultCharacterData, createDefaultItem } from "./defaults.js";
import { describeModifierTarget, listModifierTargets, parseModifierTarget, ModifierTargetSchema } from "./modifierTarget.js";
import { collectPlaceholders, substitutePlaceholders, FormulaError } from "./placeholders.js";
import { buildCharacterRoll, resolveCharacterFormula, RollBuildError } from "./rolls.js";
import { buildItemUse, describeActivation, effectiveCost, isPassiveItem, ItemUseError, saveDcFor } from "./activation.js";

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
    expect(c.resources.pv).toEqual({ max: 35, min: -17 });
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
