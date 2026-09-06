import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getSystemCompendium, validateCompendiumEntries } from "../compendium/index.js";
import { listSystemIds } from "../systems.js";

const systemsDir = join(__dirname, "..", "..", "systems");

/**
 * Todo arquivo em systems/<id>/compendium/*.json é uma lista de entradas
 * válidas para AQUELE sistema, e o registro em src/compendium/index.ts as
 * carrega. Um JSON com campo errado quebra aqui, não em produção.
 */
describe("compêndios (packages/shared/systems/<id>/compendium/*.json)", () => {
  for (const systemId of listSystemIds()) {
    const dir = join(systemsDir, systemId, "compendium");
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));

    for (const file of files) {
      it(`${systemId}/compendium/${file} só tem entradas válidas para o sistema`, () => {
        const raw = JSON.parse(readFileSync(join(dir, file), "utf-8")) as unknown;
        expect(Array.isArray(raw)).toBe(true);
        expect(() => validateCompendiumEntries(systemId, raw as unknown[])).not.toThrow();
      });
    }

    it(`${systemId}: o registro carrega todas as entradas dos arquivos, sem id repetido`, () => {
      const fromFiles = files.flatMap((f) => JSON.parse(readFileSync(join(dir, f), "utf-8")) as { id: string }[]).map((e) => e.id);
      const loaded = getSystemCompendium(systemId).entries.map((e) => e.id);
      expect(loaded.sort()).toEqual(fromFiles.sort());
      expect(new Set(loaded).size).toBe(loaded.length);
    });
  }

  it("rejeita id duplicado e entrada incoerente com o sistema", () => {
    const race = { id: "x", name: "X", kind: "race" };
    expect(() => validateCompendiumEntries("tormenta20", [race, race])).toThrow(/id duplicado/);
    expect(() => validateCompendiumEntries("tormenta20", [{ ...race, kind: "nope" }])).toThrow(/tipo de item desconhecido/);
    expect(() => validateCompendiumEntries("tormenta20", [{ id: "Maiúsculo", name: "X", kind: "race" }])).toThrow(/entrada "Maiúsculo"/);
  });
});

describe("tormenta20 seed", () => {
  const entries = getSystemCompendium("tormenta20").entries;
  const ids = entries.map((e) => e.id);

  it("tem o seed inicial", () => {
    for (const id of ["guerreiro", "arcanista", "anao", "humano", "espada-longa", "arco-curto", "couro-batido"]) expect(ids).toContain(id);
  });

  it("raça sem bônus à escolha não deixa escolha pendente", () => {
    const anao = entries.find((e) => e.id === "anao");
    expect(anao?.fields.flexibleBonuses).toMatchObject({ count: 0 });
  });
});
