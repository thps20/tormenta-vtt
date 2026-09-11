import { describe, expect, it } from "vitest";
import { CompendiumCreatureEntrySchema, CompendiumEntrySchema, type CompendiumCreatureEntry } from "../schemas/compendium.js";
import type { SavedEncounterEntry } from "../schemas/encounter.js";
import { getSystemDefinition } from "../systems.js";
import { expandEncounterEntries, sumChallengeRating } from "./encounter.js";

const def = getSystemDefinition("tormenta20");
const bounds = { cols: 20, rows: 20 };

/** Criatura mínima válida, mesmo molde de rules/compendium.test.ts. `nd` fica em `traits.nd`. */
function creature(id: string, name: string, nd: string, patch: Record<string, unknown> = {}): CompendiumCreatureEntry {
  return CompendiumCreatureEntrySchema.parse({
    type: "creature",
    id,
    name,
    sheet: {
      attributes: { for: { base: 1 }, des: { base: 2 } },
      resources: { pv: { current: 7, temp: 0, maxOverride: 7 } },
      skills: { luta: { trained: true, other: 2 } },
      traits: { tipo: "humanoide", nd },
      size: "pequeno",
      items: [],
    },
    ...patch,
  });
}

function entry(entryId: string, count: number, opts: Partial<SavedEncounterEntry> = {}): SavedEncounterEntry {
  return { entryId, count, visibleOnSpawn: true, nameOverride: null, ...opts };
}

const goblin = creature("goblin", "Goblin", "1/4");
const kobold = creature("kobold", "Kobold", "1/2");
const compendiumEntries = [goblin, kobold];

describe("expandEncounterEntries", () => {
  it("expande cada entrada na quantidade pedida, na ordem salva", () => {
    const { placements, missingIds } = expandEncounterEntries({
      encounterEntries: [entry("goblin", 2), entry("kobold", 1)],
      compendiumEntries,
      def,
      start: { col: 5, row: 5 },
      occupied: [],
      existingNames: [],
      bounds,
    });
    expect(missingIds).toEqual([]);
    expect(placements).toHaveLength(3);
    expect(placements.filter((p) => p.entryId === "goblin")).toHaveLength(2);
    expect(placements.filter((p) => p.entryId === "kobold")).toHaveLength(1);
  });

  it("a segunda espécie pula as células que a primeira já usou (nenhuma posição repetida)", () => {
    const { placements } = expandEncounterEntries({
      encounterEntries: [entry("goblin", 3), entry("kobold", 3)],
      compendiumEntries,
      def,
      start: { col: 5, row: 5 },
      occupied: [],
      existingNames: [],
      bounds,
    });
    expect(placements).toHaveLength(6);
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const overlap = placements[i]!.col === placements[j]!.col && placements[i]!.row === placements[j]!.row;
        expect(overlap).toBe(false);
      }
    }
  });

  it("entryId que não existe mais no compêndio vai para missingIds; o resto do encontro solta normal", () => {
    const { placements, missingIds } = expandEncounterEntries({
      encounterEntries: [entry("goblin", 1), entry("sumiu", 2)],
      compendiumEntries,
      def,
      start: { col: 5, row: 5 },
      occupied: [],
      existingNames: [],
      bounds,
    });
    expect(missingIds).toEqual(["sumiu"]);
    expect(placements).toHaveLength(1);
    expect(placements[0]?.entryId).toBe("goblin");
  });

  it("entrada que virou type:\"item\" no compêndio (id reaproveitado) também vai para missingIds", () => {
    const goblinComoItem = CompendiumEntrySchema.parse({ id: "goblin", name: "Goblin (item?)", kind: "gear" });
    const { placements, missingIds } = expandEncounterEntries({
      encounterEntries: [entry("goblin", 1), entry("kobold", 1)],
      compendiumEntries: [goblinComoItem, kobold],
      def,
      start: { col: 5, row: 5 },
      occupied: [],
      existingNames: [],
      bounds,
    });
    expect(missingIds).toEqual(["goblin"]);
    expect(placements).toHaveLength(1);
    expect(placements[0]?.entryId).toBe("kobold");
  });

  it("numeração continua a da cena: \"Goblin 1\"/\"Goblin 2\" já na cena -> a entrada nova começa em \"Goblin 3\"", () => {
    const { placements } = expandEncounterEntries({
      encounterEntries: [entry("goblin", 1)],
      compendiumEntries,
      def,
      start: { col: 5, row: 5 },
      occupied: [],
      existingNames: ["Goblin 1", "Goblin 2"],
      bounds,
    });
    expect(placements.map((p) => p.name)).toEqual(["Goblin 3"]);
  });

  it("uma espécie nova no mesmo encontro, sem homônimo na cena nem nas entradas anteriores, nasce sem número", () => {
    const { placements } = expandEncounterEntries({
      encounterEntries: [entry("goblin", 2), entry("kobold", 1)],
      compendiumEntries,
      def,
      start: { col: 5, row: 5 },
      occupied: [],
      existingNames: [],
      bounds,
    });
    const koboldNames = placements.filter((p) => p.entryId === "kobold").map((p) => p.name);
    expect(koboldNames).toEqual(["Kobold"]);
  });

  it("nameOverride vira a base da numeração no lugar do nome da criatura", () => {
    const { placements } = expandEncounterEntries({
      encounterEntries: [entry("goblin", 2, { nameOverride: "Batedor" })],
      compendiumEntries,
      def,
      start: { col: 5, row: 5 },
      occupied: [],
      existingNames: [],
      bounds,
    });
    expect(placements.map((p) => p.name)).toEqual(["Batedor 1", "Batedor 2"]);
  });
});

describe("sumChallengeRating", () => {
  it("soma ND inteiro e fração simples (1/4, 1/2...)", () => {
    const strongGoblin = creature("goblin-forte", "Goblin forte", "3");
    const result = sumChallengeRating(
      def,
      [entry("goblin", 2), entry("kobold", 1), entry("goblin-forte", 1)],
      [...compendiumEntries, strongGoblin],
    );
    // 2 * 1/4 + 1 * 1/2 + 1 * 3
    expect(result.total).toBeCloseTo(4);
    expect(result.unparsed).toBe(0);
  });

  it("ND que não é inteiro nem fração simples fica de fora da soma (unparsed), sem inventar valor", () => {
    const special = creature("especial", "Ameaça especial", "variável");
    const result = sumChallengeRating(def, [entry("goblin", 1), entry("especial", 1)], [...compendiumEntries, special]);
    expect(result.total).toBeCloseTo(0.25);
    expect(result.unparsed).toBe(1);
  });

  it("nenhum ND parseável: total null, não zero", () => {
    const special = creature("especial", "Ameaça especial", "variável");
    const result = sumChallengeRating(def, [entry("especial", 1)], [special]);
    expect(result.total).toBeNull();
    expect(result.unparsed).toBe(1);
  });

  it("entrada sem correspondente no compêndio conta como unparsed, não derruba a soma do resto", () => {
    const result = sumChallengeRating(def, [entry("goblin", 1), entry("sumiu", 1)], compendiumEntries);
    expect(result.total).toBeCloseTo(0.25);
    expect(result.unparsed).toBe(1);
  });
});
