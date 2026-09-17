import { describe, expect, it } from "vitest";
import { buildLibraryItems } from "./library.js";
import type { Asset, LibraryFavorite } from "../schemas/library.js";
import type { Handout } from "../schemas/handout.js";
import type { SavedEncounter } from "../schemas/encounter.js";
import { CompendiumCreatureEntrySchema, type CompendiumEntry } from "../schemas/compendium.js";
import type { Macro } from "../schemas/macro.js";

const asset = (patch: Partial<Asset> = {}): Asset => ({
  id: "a1",
  roomId: "r1",
  kind: "map",
  name: "Taverna",
  url: "/uploads/a1.png",
  width: 100,
  height: 100,
  durationMs: null,
  tags: ["sessao3"],
  createdAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

const handout: Handout = {
  id: "h1",
  roomId: "r1",
  kind: "text",
  name: "Carta do duque",
  text: "Prezado aventureiro...",
  tags: [],
  createdAt: "2026-01-02T00:00:00.000Z",
};

const encounter: SavedEncounter = {
  id: "e1",
  roomId: "r1",
  name: "Emboscada",
  tags: [],
  notes: "",
  entries: [{ entryId: "goblin", count: 3, visibleOnSpawn: true, nameOverride: null }],
  createdAt: "2026-01-03T00:00:00.000Z",
  updatedAt: "2026-01-03T00:00:00.000Z",
};

const creature: CompendiumEntry = CompendiumCreatureEntrySchema.parse({
  type: "creature",
  id: "goblin-da-sala",
  name: "Goblin especial",
  sheet: {
    attributes: { for: { base: 1 }, des: { base: 2 } },
    resources: { pv: { current: 7, temp: 0, maxOverride: 7 } },
    skills: { luta: { trained: true, other: 2 } },
    traits: { tipo: "humanoide", nd: "1/4" },
    size: "pequeno",
    items: [],
  },
});

const macro: Macro = {
  id: "m1",
  label: "Bola de fogo",
  icon: "fire",
  color: "#ff0000",
  order: 0,
  action: { type: "roll", formula: "1d6" },
};

describe("buildLibraryItems", () => {
  it("junta as cinco fontes numa lista só, marcando favoritos", () => {
    const favorites: LibraryFavorite[] = [{ refKind: "handout", refId: "h1" }];
    const items = buildLibraryItems({
      assets: [asset()],
      handouts: [handout],
      encounters: [encounter],
      creatures: [creature],
      macros: [macro],
      favorites,
    });

    expect(items.map((i) => i.kind)).toEqual(["asset", "handout", "encounter", "creature", "macro"]);
    expect(items.find((i) => i.kind === "handout")?.favorite).toBe(true);
    expect(items.find((i) => i.kind === "asset")?.favorite).toBe(false);
  });

  it("criatura e macro não têm data própria (§1.2) e macro não tem tags", () => {
    const items = buildLibraryItems({ assets: [], handouts: [], encounters: [], creatures: [creature], macros: [macro], favorites: [] });
    const creatureItem = items.find((i) => i.kind === "creature");
    const macroItem = items.find((i) => i.kind === "macro");
    expect(creatureItem?.createdAt).toBeNull();
    expect(macroItem?.createdAt).toBeNull();
    expect(macroItem?.tags).toEqual([]);
  });

  it("dentro do mesmo tipo, ordena por nome", () => {
    const items = buildLibraryItems({
      assets: [asset({ id: "a2", name: "Zorro" }), asset({ id: "a1", name: "Abrigo" })],
      handouts: [],
      encounters: [],
      creatures: [],
      macros: [],
      favorites: [],
    });
    expect(items.map((i) => i.name)).toEqual(["Abrigo", "Zorro"]);
  });

  it("lista vazia não quebra", () => {
    expect(buildLibraryItems({ assets: [], handouts: [], encounters: [], creatures: [], macros: [], favorites: [] })).toEqual([]);
  });
});
