import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { validateSystemDefinition } from "../schemas/system.js";

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
});

describe("tormenta20.json", () => {
  const def = validateSystemDefinition(
    JSON.parse(readFileSync(join(systemsDir, "tormenta20.json"), "utf-8")),
  );

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
});
