import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validateSystemDefinition } from "../schemas/system.js";
import { getSystemDefinition, listSystemIds } from "../systems.js";

const systemsDir = join(__dirname, "..", "..", "systems");

describe("definições de sistema (packages/shared/systems/*.json)", () => {
  const files = readdirSync(systemsDir).filter((f) => f.endsWith(".json"));

  it("existe pelo menos um sistema", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} é válido contra o SystemDefinitionSchema`, () => {
      const raw = JSON.parse(readFileSync(join(systemsDir, file), "utf-8"));
      const def = validateSystemDefinition(raw);
      expect(def.id).toBe(file.replace(/\.json$/, ""));
    });
  }

  it("todo JSON em systems/ está registrado em src/systems.ts (e vice-versa)", () => {
    const ids = files.map((f) => f.replace(/\.json$/, "")).sort();
    expect(listSystemIds().sort()).toEqual(ids);
    for (const id of ids) expect(getSystemDefinition(id).id).toBe(id);
  });
});

describe("validateSystemDefinition (integridade)", () => {
  const base = JSON.parse(readFileSync(join(systemsDir, "tormenta20.json"), "utf-8")) as Record<string, unknown>;
  const withPatch = (patch: Record<string, unknown>) => ({ ...structuredClone(base), ...patch });

  it("rejeita perícia com atributo inexistente", () => {
    const skills = [...(base.skills as unknown[]), { key: "x", label: "X", attribute: "nope" }];
    expect(() => validateSystemDefinition(withPatch({ skills }))).toThrow(/atributo inexistente/);
  });

  it("rejeita placeholder desconhecido em stat derivado", () => {
    const derived = [{ key: "x", label: "X", formula: "10 + {attr.zzz}" }];
    expect(() => validateSystemDefinition(withPatch({ derived }))).toThrow(/placeholder/);
  });

  it("rejeita stat derivado que referencia outro definido depois", () => {
    const derived = [
      { key: "a", label: "A", formula: "{derived.b}" },
      { key: "b", label: "B", formula: "1" },
    ];
    expect(() => validateSystemDefinition(withPatch({ derived }))).toThrow(/derived.b/);
  });

  it("rejeita tipo de item com equipStat inexistente", () => {
    const itemKinds = [{ key: "x", label: "X", statBonuses: ["nope"] }];
    expect(() => validateSystemDefinition(withPatch({ itemKinds }))).toThrow(/equipStat inexistente/);
  });

  it("rejeita tokenBar apontando para recurso inexistente", () => {
    expect(() => validateSystemDefinition(withPatch({ tokenBar: "nope" }))).toThrow(/tokenBar/);
  });

  it("rejeita activation.resource apontando para recurso inexistente", () => {
    const activation = { ...(base.activation as Record<string, unknown>), resource: "nope" };
    expect(() => validateSystemDefinition(withPatch({ activation }))).toThrow(/activation.resource/);
  });

  it("rejeita activation.saveSkillTag que nenhuma perícia usa", () => {
    const activation = { ...(base.activation as Record<string, unknown>), saveSkillTag: "nope" };
    expect(() => validateSystemDefinition(withPatch({ activation }))).toThrow(/saveSkillTag/);
  });

  it("rejeita placeholder desconhecido em activation.saveDc (mas aceita os contextuais)", () => {
    const activation = { ...(base.activation as Record<string, unknown>), saveDc: "10 + {saveAttr} + {attr.zzz}" };
    expect(() => validateSystemDefinition(withPatch({ activation }))).toThrow(/activation.saveDc/);
    const ok = { ...(base.activation as Record<string, unknown>), saveDc: "10 + {halfLevel} + {saveAttr} + {saveBonus}" };
    expect(() => validateSystemDefinition(withPatch({ activation: ok }))).not.toThrow();
  });

  it("rejeita damageAttribute apontando para opção que não existe", () => {
    const damageAttribute = { field: "purpose", map: { voo: "for" } };
    expect(() => validateSystemDefinition(withPatch({ damageAttribute }))).toThrow(/opção "voo"/);
  });

  it("level.source = classes exige level.classes apontando para campos reais", () => {
    const level = base.level as Record<string, unknown>;
    expect(() => validateSystemDefinition(withPatch({ level: { ...level, classes: undefined } }))).toThrow(/exige level.classes/);
    expect(() => validateSystemDefinition(withPatch({ level: { ...level, classes: { kind: "nope", levelsField: "levels", initialField: "initial" } } }))).toThrow(/tipo de item inexistente/);
    expect(() => validateSystemDefinition(withPatch({ level: { ...level, classes: { kind: "class", levelsField: "initial", initialField: "initial" } } }))).toThrow(/levelsField/);
    expect(() => validateSystemDefinition(withPatch({ level: { ...level, classes: { kind: "class", levelsField: "levels", initialField: "levels" } } }))).toThrow(/initialField/);
  });

  it("rejeita perLevel apontando para campo ou atributo inexistente", () => {
    const resources = structuredClone(base.resources as { key: string; perLevel?: Record<string, unknown> }[]);
    const pv = resources.find((r) => r.key === "pv");
    pv!.perLevel = { ...pv!.perLevel, classField: "proficiencies" };
    expect(() => validateSystemDefinition(withPatch({ resources }))).toThrow(/classField/);
    pv!.perLevel = { ...pv!.perLevel, classField: "hpPerLevel", attribute: "nope" };
    expect(() => validateSystemDefinition(withPatch({ resources }))).toThrow(/perLevel.attribute/);
  });

  it("rejeita campo estruturado com default e campo size sem sizes[]", () => {
    const itemKinds = [...(base.itemKinds as unknown[]), { key: "x", label: "X", fields: [{ key: "b", label: "B", type: "attributeBonuses", default: "" }] }];
    expect(() => validateSystemDefinition(withPatch({ itemKinds }))).toThrow(/não aceita default/);
    expect(() => validateSystemDefinition(withPatch({ sizes: [] }))).toThrow(/não declara sizes/);
  });
});

describe("tormenta20.json", () => {
  const def = getSystemDefinition("tormenta20");

  it("tem os 6 atributos na ordem FOR/DES/CON/INT/SAB/CAR", () => {
    expect(def.attributes.map((a) => a.abbr)).toEqual(["FOR", "DES", "CON", "INT", "SAB", "CAR"]);
  });

  it("tem as perícias básicas", () => {
    const keys = def.skills.map((s) => s.key);
    expect(keys).toContain("percepcao");
    expect(keys).toContain("iniciativa");
    expect(keys).toContain("luta");
  });

  it("teste de perícia usa 1d20", () => {
    expect(def.rolls.skillCheck.startsWith("1d20")).toBe(true);
  });

  it("aponta a barra do token para um recurso declarado", () => {
    expect(def.tokenBar).toBeDefined();
    expect(def.resources.some((r) => r.key === def.tokenBar)).toBe(true);
  });

  it("declara a escala do grid (célula em metros e regra de diagonais)", () => {
    expect(def.grid).toBeDefined();
    expect(def.grid?.cellSize).toBeGreaterThan(0);
    expect(def.grid?.unit).toBeTruthy();
  });

  it("ativação desconta de um recurso declarado, com piso 1 e CD por fórmula", () => {
    expect(def.resources.some((r) => r.key === def.activation.resource)).toBe(true);
    expect(def.activation.minCost).toBe(1);
    expect(def.activation.saveDc).toBeDefined();
    expect(def.activation.executions.some((e) => e.passive)).toBe(true);
  });

  it("nível vem das classes; PV e PM acumulam por nível de classe", () => {
    expect(def.level.source).toBe("classes");
    expect(def.level.classes?.kind).toBeDefined();
    expect(def.itemKinds.some((k) => k.key === def.level.classes?.kind)).toBe(true);
    expect(def.resources.filter((r) => r.perLevel).length).toBe(2);
    expect(def.itemKinds.some((k) => k.maxCount === 1)).toBe(true);
  });

  it("declara Defesa como stat derivado e armadura como tipo de item com bônus de Defesa", () => {
    expect(def.derived.some((d) => d.key === "defense")).toBe(true);
    const armor = def.itemKinds.find((k) => k.key === "armor");
    expect(armor?.statBonuses).toContain("defense");
  });
});
