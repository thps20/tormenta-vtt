import { describe, expect, it } from "vitest";
import { basename } from "node:path";
import {
  CUSTOM_FILE,
  getSystemCompendium,
  listCompendiumFiles,
  loadCompendiumEntries,
  readCompendiumFile,
  validateCompendiumEntries,
} from "../compendium/index.js";
import { listSystemIds } from "../systems.js";

/**
 * Todo arquivo em systems/<id>/compendium/*.json é uma lista de entradas
 * válidas para AQUELE sistema, e o loader as carrega com custom.json vencendo
 * em id repetido. Um JSON com campo errado quebra aqui, não em produção.
 */
describe("compêndios (packages/shared/systems/<id>/compendium/*.json)", () => {
  for (const systemId of listSystemIds()) {
    const files = listCompendiumFiles(systemId);
    if (files.length === 0) continue;

    for (const file of files) {
      it(`${systemId}/compendium/${basename(file)} só tem entradas válidas para o sistema`, () => {
        expect(() => validateCompendiumEntries(systemId, readCompendiumFile(file))).not.toThrow();
      });
    }

    it(`${systemId}: o loader carrega todas as entradas dos arquivos, sem id repetido, com custom.json na frente`, () => {
      const custom = new Set(files.filter((f) => basename(f) === CUSTOM_FILE).flatMap((f) => readCompendiumFile(f) as { id: string }[]).map((e) => e.id));
      const fromFiles = new Set(files.flatMap((f) => readCompendiumFile(f) as { id: string }[]).map((e) => e.id));
      const loaded = getSystemCompendium(systemId).entries.map((e) => e.id);
      expect(new Set(loaded)).toEqual(fromFiles);
      expect(new Set(loaded).size).toBe(loaded.length);
      expect(loaded.slice(0, custom.size).every((id) => custom.has(id))).toBe(true);
    });
  }

  it("rejeita id duplicado e entrada incoerente com o sistema", () => {
    const race = { id: "x", name: "X", kind: "race" };
    expect(() => validateCompendiumEntries("tormenta20", [race, race])).toThrow(/id duplicado/);
    expect(() => validateCompendiumEntries("tormenta20", [{ ...race, kind: "nope" }])).toThrow(/tipo de item desconhecido/);
    expect(() => validateCompendiumEntries("tormenta20", [{ id: "Maiúsculo", name: "X", kind: "race" }])).toThrow(/entrada "Maiúsculo"/);
  });

  it("sistema sem pasta de compêndio carrega vazio", () => {
    expect(loadCompendiumEntries("nao-existe-compendio")).toEqual([]);
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
