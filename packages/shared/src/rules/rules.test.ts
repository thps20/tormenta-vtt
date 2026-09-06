import { describe, expect, it } from "vitest";
import { CharacterDataSchema, CharacterItemSchema, ModifierSchema, type CharacterData } from "../schemas/character.js";
import { getSystemDefinition } from "../systems.js";
import { computeCharacter } from "./compute.js";
import { createDefaultCharacterData, createDefaultItem } from "./defaults.js";
import { describeModifierTarget, listModifierTargets, parseModifierTarget, ModifierTargetSchema } from "./modifierTarget.js";
import { collectPlaceholders, substitutePlaceholders, FormulaError } from "./placeholders.js";
import { buildCharacterRoll, resolveCharacterFormula, RollBuildError } from "./rolls.js";

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
    for (const ok of ["attr.for", "skill.luta", "skill.oficio:alquimia", "skill.*", "skill[tag=ataque]", "derived.defense", "resource.pv.max", "attack", "attack.luta", "damage", "damage.pontaria"]) {
      expect(ModifierTargetSchema.safeParse(ok).success, ok).toBe(true);
    }
  });

  it("rejeita seletores fora da gramática", () => {
    for (const bad of ["", "for", "attr", "attr.", "skill[ataque]", "resource.pv", "resource.pv.min", "Attack", "attr.for.max", "derived"]) {
      expect(ModifierTargetSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it("interpreta e descreve", () => {
    expect(parseModifierTarget("skill[tag=resistencia]")).toEqual({ kind: "skillTag", tag: "resistencia" });
    expect(parseModifierTarget("attack.luta")).toEqual({ kind: "attack", skill: "luta" });
    expect(parseModifierTarget("resource.pv.max")).toEqual({ kind: "resourceMax", key: "pv" });
    expect(describeModifierTarget("attr.for", def)).toBe("Força");
    expect(describeModifierTarget("damage.pontaria", def)).toBe("Dano (Pontaria)");
    expect(listModifierTargets(def).some((t) => t.value === "derived.defense")).toBe(true);
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
