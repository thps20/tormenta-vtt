import { describe, expect, it } from "vitest";
import { CompendiumCreatureEntrySchema, CompendiumEntrySchema, CompendiumItemEntrySchema, type CompendiumCreatureEntry, type CompendiumItemEntry } from "../schemas/compendium.js";
import { getSystemDefinition } from "../systems.js";
import { entryToCharacter, entryToItem, mergeCompendium, validateCompendiumEntry } from "./compendium.js";

const def = getSystemDefinition("tormenta20");

/** Entrada de criatura válida (goblin simplificado); `sheet`/`patch` sobrescrevem para os casos de erro. */
function creature(sheet: Record<string, unknown> = {}, patch: Record<string, unknown> = {}): CompendiumCreatureEntry {
  return CompendiumCreatureEntrySchema.parse({
    type: "creature",
    id: "goblin",
    name: "Goblin",
    sheet: {
      attributes: { for: { base: 1 }, des: { base: 2 } },
      resources: { pv: { current: 7, temp: 0, maxOverride: 7 } },
      skills: { luta: { trained: true, other: 2 } },
      traits: { tipo: "humanoide", nd: "1/4" },
      size: "pequeno",
      items: [
        {
          kind: "weapon",
          name: "Adaga",
          fields: { proficiency: "simples", purpose: "melee", wield: "one_hand" },
          actions: [
            { label: "Ataque", kind: "attack", skill: "luta" },
            { label: "Dano", kind: "damage", formula: "1d4", damageType: "perfuracao" },
          ],
        },
      ],
      ...sheet,
    },
    ...patch,
  });
}

/** Entrada de arma válida; `patch` sobrescreve para os casos de erro. */
function weapon(patch: Record<string, unknown> = {}): CompendiumItemEntry {
  return CompendiumItemEntrySchema.parse({
    type: "item",
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
    // Efeito de aprimoramento com tipo próprio: a chave precisa existir em damageTypes[].
    const spell = (effect: unknown) => ({ id: "s", name: "S", kind: "spell", activation: { cost: 1 }, enhancements: [{ id: "e1", cost: 2, effect }] });
    expect(validateCompendiumEntry(def, CompendiumEntrySchema.parse(spell({ kind: "damageDiceAdd", dice: "1d6", damageType: "frio" })))).toBeNull();
    expect(validateCompendiumEntry(def, CompendiumEntrySchema.parse(spell({ kind: "damageDiceAdd", dice: "1d6", damageType: "sonico" })))).toMatch(/aprimoramento "e1": tipo de dano desconhecido "sonico"/);
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
    const power = CompendiumItemEntrySchema.parse({ type: "item", id: "p", name: "P", kind: "power" });
    expect(entryToItem(def, power, () => "x").activation).not.toBeNull();
  });

  it("copia os aprimoramentos (com texto) para o item", () => {
    const spell = CompendiumItemEntrySchema.parse({
      type: "item",
      id: "s",
      name: "S",
      kind: "spell",
      fields: { circle: 1, school: "evocacao", type: "arcana" },
      activation: { cost: 1 },
      enhancements: [{ id: "e1", label: "+1d6", cost: 2, repeatable: true }, { id: "e2", cost: 1 }],
    });
    expect(entryToItem(def, spell, () => "x").enhancements).toEqual([
      { id: "e1", label: "+1d6", cost: 2, repeatable: true },
      { id: "e2", label: "", cost: 1, repeatable: false },
    ]);
  });
});

describe("validateCompendiumEntry: aprimoramentos", () => {
  it("só em tipo com ativação e sem id repetido", () => {
    const enhancements = [{ id: "e1", cost: 1 }];
    expect(validateCompendiumEntry(def, weapon({ enhancements }))).toMatch(/não tem bloco de ativação \(aprimoramentos\)/);
    const power = (list: unknown[]) => CompendiumEntrySchema.parse({ id: "p", name: "P", kind: "power", enhancements: list });
    expect(validateCompendiumEntry(def, power(enhancements))).toBeNull();
    expect(validateCompendiumEntry(def, power([{ id: "e1", cost: 1 }, { id: "e1", cost: 2 }]))).toMatch(/aprimoramento "e1" repetido/);
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

describe("validateCompendiumEntry: criaturas", () => {
  it("aceita uma criatura coerente com o sistema", () => {
    expect(validateCompendiumEntry(def, creature())).toBeNull();
  });

  it("rejeita atributo, perícia, recurso e tamanho desconhecidos", () => {
    expect(validateCompendiumEntry(def, creature({ attributes: { zzz: { base: 1 } } }))).toMatch(/atributo desconhecido "zzz"/);
    expect(validateCompendiumEntry(def, creature({ skills: { zzz: { trained: true } } }))).toMatch(/perícia desconhecida "zzz"/);
    expect(validateCompendiumEntry(def, creature({ resources: { zzz: { current: 1 } } }))).toMatch(/recurso desconhecido "zzz"/);
    expect(validateCompendiumEntry(def, creature({ size: "gigante" }))).toMatch(/tamanho desconhecido/);
  });

  it("rejeita tipo de dano desconhecido em damageResponses e tipo de criatura fora das opções do traitField", () => {
    expect(validateCompendiumEntry(def, creature({ damageResponses: { byType: { sonico: {} } } }))).toMatch(/tipo de dano desconhecido "sonico"/);
    expect(validateCompendiumEntry(def, creature({ traits: { tipo: "nope" } }))).toMatch(/tipo de criatura desconhecido "nope"/);
  });

  it("rejeita derivedOverrides desconhecido, e aceita só quando o derivado é editável", () => {
    expect(validateCompendiumEntry(def, creature({ derivedOverrides: { zzz: 1 } }))).toMatch(/stat derivado desconhecido "zzz"/);
    expect(validateCompendiumEntry(def, creature({ derivedOverrides: { movement: 12 } }))).toBeNull();
    const notEditable = { ...def, derived: def.derived.map((d) => (d.key === "movement" ? { ...d, editable: false } : d)) };
    expect(validateCompendiumEntry(notEditable, creature({ derivedOverrides: { movement: 12 } }))).toMatch(/stat derivado "movement" não é editável/);
  });

  it("rejeita item embutido inválido com a mesma checagem dos itens avulsos", () => {
    expect(validateCompendiumEntry(def, creature({ items: [{ kind: "nope", name: "X" }] }))).toMatch(/item #1 \("X"\): tipo de item desconhecido "nope"/);
  });

  it("rejeita criatura quando o sistema não declara o bloco creatures", () => {
    const semCreatures = { ...def, creatures: undefined };
    expect(validateCompendiumEntry(semCreatures, creature())).toMatch(/não declara o bloco creatures/);
  });
});

describe("entryToCharacter", () => {
  it("copia a criatura como ficha NPC nova, com ids novos nos itens e ações", () => {
    let n = 0;
    const result = entryToCharacter(def, creature(), () => `id${++n}`);
    expect(result.kind).toBe("npc");
    expect(result.name).toBe("Goblin");
    expect(result.data.imageUrl).toBeNull();
    expect(result.data.bio).toBe("");
    expect(result.data.traits.tipo).toBe("humanoide");
    expect(result.data.items).toHaveLength(1);
    const [item] = result.data.items;
    expect(item?.id).toBe("id1");
    expect(item?.name).toBe("Adaga");
    expect(item?.actions.map((a) => a.id)).toEqual(["id2", "id3"]);
  });

  it("opts.name sobrescreve o nome (soltura em lote numerada); sem ele, usa o nome da entrada", () => {
    expect(entryToCharacter(def, creature(), () => "x").name).toBe("Goblin");
    expect(entryToCharacter(def, creature(), () => "x", { name: "Goblin 2" }).name).toBe("Goblin 2");
  });

  it("duas cópias da mesma entrada são independentes", () => {
    let n = 0;
    const a = entryToCharacter(def, creature(), () => `a${++n}`);
    const b = entryToCharacter(def, creature(), () => `b${++n}`);
    expect(a.data.items[0]?.id).not.toBe(b.data.items[0]?.id);
    a.data.items[0]!.name = "Adaga enferrujada";
    expect(b.data.items[0]?.name).toBe("Adaga");
  });
});
