import { describe, expect, it } from "vitest";
import { CharacterDataSchema, CompendiumEntrySchema, createDefaultCharacterData, getSystemDefinition, type Character, type CompendiumEntry } from "@tormenta-vtt/shared";
import { buildInsertPatch, checkInsert, isOpenPaletteShortcut, matchesQuery, type ShortcutKey } from "./compendium";

const def = getSystemDefinition("tormenta20");

function character(items: Character["items"] = []): Pick<Character, "items"> {
  return CharacterDataSchema.parse({ ...createDefaultCharacterData(def), items });
}

const entry = (patch: Partial<CompendiumEntry> & { id: string; kind: string }): CompendiumEntry =>
  CompendiumEntrySchema.parse({ name: patch.id, ...patch });

// O teste conhece as chaves do T20 (é o sistema sob teste); o código de lib/ não.
const classKind = def.level.classes?.kind ?? "";
const initialField = def.level.classes?.initialField ?? "";
const raceKind = def.itemKinds.find((k) => k.maxCount === 1)?.key ?? "";
const sizeField = def.itemKinds.find((k) => k.key === raceKind)?.fields.find((f) => f.type === "size")?.key ?? "";

let n = 0;
const newId = () => `id${++n}`;

describe("checkInsert", () => {
  it("aceita item de tipo sem limite e recusa tipo desconhecido", () => {
    expect(checkInsert(def, character(), entry({ id: "espada", kind: "weapon" })).ok).toBe(true);
    expect(checkInsert(def, character(), entry({ id: "x", kind: "nope" })).reason).toMatch(/desconhecido/);
  });

  it("segunda raça: não inserível, com o motivo e o item a substituir", () => {
    const { item: anao } = buildInsertPatch(def, character(), entry({ id: "anao", name: "Anão", kind: raceKind }), newId);
    const check = checkInsert(def, character([anao]), entry({ id: "humano", kind: raceKind }));
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/já tem Raça: Anão/);
    expect(check.replaces?.id).toBe(anao.id);
  });
});

describe("buildInsertPatch", () => {
  it("a primeira classe nasce como inicial; a segunda não", () => {
    const first = buildInsertPatch(def, character(), entry({ id: "guerreiro", kind: classKind }), newId);
    expect(first.item.fields[initialField]).toBe(true);
    const second = buildInsertPatch(def, character([first.item]), entry({ id: "arcanista", kind: classKind }), newId);
    expect(second.item.fields[initialField]).toBe(false);
    expect(second.patch.items?.map((i) => i.name)).toEqual(["guerreiro", "arcanista"]);
  });

  it("substituir a raça remove a antiga e aplica o tamanho à ficha", () => {
    const big = def.sizes.find((s) => s.skillModifier !== 0)?.key ?? "";
    const { item: anao } = buildInsertPatch(def, character(), entry({ id: "anao", kind: raceKind }), newId);
    const humano = entry({ id: "humano", kind: raceKind, fields: { [sizeField]: big } });
    const check = checkInsert(def, character([anao]), humano);
    const result = buildInsertPatch(def, character([anao]), humano, newId, { replace: check.replaces });
    expect(result.patch.items?.map((i) => i.name)).toEqual(["humano"]);
    expect(result.patch.size).toBe(big);
  });

  it("sem replace, a lista atual é preservada e o item vai para o fim", () => {
    const { item: sword } = buildInsertPatch(def, character(), entry({ id: "espada", kind: "weapon" }), newId);
    const result = buildInsertPatch(def, character([sword]), entry({ id: "arco", kind: "weapon" }), newId);
    expect(result.patch.items?.map((i) => i.name)).toEqual(["espada", "arco"]);
    expect(result.patch.size).toBeUndefined();
  });
});

describe("matchesQuery", () => {
  const sword = entry({ id: "espada-longa", name: "Espada longa", kind: "weapon", tags: ["marcial", "corpo a corpo"] });
  it("ignora acento e caixa, e exige todas as palavras", () => {
    expect(matchesQuery(sword, "ESPADA")).toBe(true);
    expect(matchesQuery(sword, "marcial longa")).toBe(true);
    expect(matchesQuery(sword, "arco")).toBe(false);
    expect(matchesQuery(sword, "")).toBe(true);
  });
});

describe("isOpenPaletteShortcut", () => {
  const key = (patch: Partial<ShortcutKey>): ShortcutKey => ({ key: "", code: "", ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...patch });
  const space = { key: " ", code: "Space" };

  it("Ctrl+Espaço e Cmd+Espaço abrem, mesmo digitando num campo", () => {
    expect(isOpenPaletteShortcut(key({ ...space, ctrlKey: true }), false)).toBe(true);
    expect(isOpenPaletteShortcut(key({ ...space, metaKey: true }), true)).toBe(true);
  });

  it("Ctrl+Shift+Espaço abre (alternativa para o Brave)", () => {
    expect(isOpenPaletteShortcut(key({ ...space, ctrlKey: true, shiftKey: true }), false)).toBe(true);
  });

  it("espaço sem modificador ou com Alt não abre", () => {
    expect(isOpenPaletteShortcut(key(space), false)).toBe(false);
    expect(isOpenPaletteShortcut(key({ ...space, ctrlKey: true, altKey: true }), false)).toBe(false);
  });

  it('"/" abre só fora de campos de texto e sem Ctrl/Cmd; Shift é ignorado', () => {
    expect(isOpenPaletteShortcut(key({ key: "/", code: "Slash" }), false)).toBe(true);
    expect(isOpenPaletteShortcut(key({ key: "/", code: "Digit7", shiftKey: true }), false)).toBe(true);
    expect(isOpenPaletteShortcut(key({ key: "/", code: "Slash" }), true)).toBe(false);
    expect(isOpenPaletteShortcut(key({ key: "/", code: "Slash", ctrlKey: true }), false)).toBe(false);
  });
});
