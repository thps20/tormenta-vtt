import { describe, expect, it } from "vitest";
import { CompendiumEntrySchema, type CompendiumEntry } from "../schemas/compendium.js";
import { getSystemDefinition } from "../systems.js";
import { entryToItem, mergeCompendium, validateCompendiumEntry } from "./compendium.js";

const def = getSystemDefinition("tormenta20");

/** Entrada de arma válida; `patch` sobrescreve para os casos de erro. */
function weapon(patch: Record<string, unknown> = {}): CompendiumEntry {
  return CompendiumEntrySchema.parse({
    id: "espada-longa",
    name: "Espada longa",
    kind: "weapon",
    tags: ["marcial"],
    fields: { proficiency: "marcial", purpose: "melee", wield: "one_hand" },
    actions: [
      { label: "Ataque", kind: "attack", skill: "luta", critRange: 19 },
      { label: "Dano", kind: "damage", formula: "1d8", damageType: "corte" },
    ],
    slots: 1,
    price: 15,
    ...patch,
  });
}

describe("validateCompendiumEntry", () => {
  it("aceita uma entrada coerente com o sistema", () => {
    expect(validateCompendiumEntry(def, weapon())).toBeNull();
  });

  it("rejeita tipo de item, campo e opção de enum desconhecidos", () => {
    expect(validateCompendiumEntry(def, weapon({ kind: "nope" }))).toMatch(/tipo de item desconhecido/);
    expect(validateCompendiumEntry(def, weapon({ fields: { dano: "1d8" } }))).toMatch(/campo "dano" não existe/);
    expect(validateCompendiumEntry(def, weapon({ fields: { purpose: "voo" } }))).toMatch(/opção desconhecida "voo"/);
  });

  it("rejeita valor de tipo errado num campo estruturado e chave inexistente dentro dele", () => {
    const race = (fields: Record<string, unknown>) => CompendiumEntrySchema.parse({ id: "r", name: "R", kind: "race", fields });
    expect(validateCompendiumEntry(def, race({ attributeBonuses: { con: 2, zzz: 1 } }))).toMatch(/atributo desconhecido "zzz"/);
    expect(validateCompendiumEntry(def, race({ skillsGranted: { fixed: ["nope"], choices: [] } }))).toMatch(/perícia desconhecida "nope"/);
    expect(validateCompendiumEntry(def, race({ size: "gigante" }))).toMatch(/tamanho desconhecido/);
    expect(validateCompendiumEntry(def, race({ movement: "9" }))).toMatch(/esperado número/);
  });

  it("rejeita stat que o tipo não fornece e ativação/resistência em tipo sem os blocos", () => {
    expect(validateCompendiumEntry(def, weapon({ statBonuses: { defense: 1 } }))).toMatch(/não fornece o stat "defense"/);
    expect(validateCompendiumEntry(def, weapon({ activation: { cost: 1 } }))).toMatch(/não tem bloco de ativação/);
    expect(validateCompendiumEntry(def, weapon({ save: { skill: "reflexos" } }))).toMatch(/não tem teste de resistência/);
  });

  it("confere as enumerações da ativação e a perícia do save", () => {
    const spell = (patch: Record<string, unknown>) =>
      CompendiumEntrySchema.parse({ id: "s", name: "S", kind: "spell", activation: { cost: 1, execution: "standard", range: { units: "short", value: 0 } }, ...patch });
    expect(validateCompendiumEntry(def, spell({}))).toBeNull();
    expect(validateCompendiumEntry(def, spell({ activation: { execution: "instant" } }))).toMatch(/execução desconhecida/);
    expect(validateCompendiumEntry(def, spell({ save: { skill: "luta" } }))).toMatch(/não é perícia de resistência/);
    expect(validateCompendiumEntry(def, spell({ save: { skill: "reflexos" } }))).toBeNull();
  });

  it("confere perícias e atributos das ações", () => {
    expect(validateCompendiumEntry(def, weapon({ actions: [{ label: "A", kind: "attack", skill: "percepcao" }] }))).toMatch(/não é perícia de ataque/);
    expect(validateCompendiumEntry(def, weapon({ actions: [{ label: "D", kind: "damage", formula: "1d6", damageType: "sonico" }] }))).toMatch(/tipo de dano desconhecido/);
    expect(validateCompendiumEntry(def, weapon({ actions: [{ label: "T", kind: "check", skill: "nope" }] }))).toMatch(/perícia desconhecida/);
  });
});

describe("entryToItem", () => {
  it("copia a entrada com ids novos e completa os campos ausentes com o default do sistema", () => {
    let n = 0;
    const item = entryToItem(def, weapon(), () => `id${++n}`);
    expect(item.id).toBe("id1");
    expect(item.actions.map((a) => a.id)).toEqual(["id2", "id3"]);
    expect(item.name).toBe("Espada longa");
    expect(item.fields.purpose).toBe("melee");
    // "properties" não veio na entrada: usa o default do JSON do sistema.
    expect(item.fields.properties).toBe("");
    expect(item.equipped).toBe(false);
    expect(item.quantity).toBe(1);
    expect(item.price).toBe(15);
    expect(item.activation).toBeNull();
  });

  it("duas cópias da mesma entrada são independentes", () => {
    let n = 0;
    const a = entryToItem(def, weapon(), () => `a${++n}`);
    const b = entryToItem(def, weapon(), () => `b${++n}`);
    expect(a.id).not.toBe(b.id);
    a.fields.purpose = "ranged";
    expect(b.fields.purpose).toBe("melee");
  });

  it("tipo com ativação ganha o bloco mesmo quando a entrada não o define", () => {
    const power = CompendiumEntrySchema.parse({ id: "p", name: "P", kind: "power" });
    expect(entryToItem(def, power, () => "x").activation).not.toBeNull();
  });
});

describe("mergeCompendium", () => {
  it("id repetido: vence a fonte de maior prioridade", () => {
    const system = { id: "system", label: "Sistema", priority: 0, entries: [weapon(), weapon({ id: "arco", name: "Arco" })] };
    const room = { id: "room", label: "Sala", priority: 10, entries: [weapon({ name: "Espada da casa" })] };
    const merged = mergeCompendium([system, room]);
    expect(merged.map((e) => e.id).sort()).toEqual(["arco", "espada-longa"]);
    expect(merged.find((e) => e.id === "espada-longa")?.name).toBe("Espada da casa");
  });
});
