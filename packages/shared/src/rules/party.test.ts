import { describe, expect, it } from "vitest";
import { addToParty, removeFromParty, reorderParty, setPartyHidden } from "./party.js";
import type { PartyEntry } from "../schemas/party.js";

const entries = (...ids: string[]): PartyEntry[] => ids.map((characterId) => ({ characterId, hidden: false }));

describe("addToParty", () => {
  it("adiciona no fim, sem ocultar", () => {
    expect(addToParty(entries("a", "b"), "c")).toEqual([{ characterId: "a", hidden: false }, { characterId: "b", hidden: false }, { characterId: "c", hidden: false }]);
  });

  it("é idempotente: já estar no grupo não duplica nem reordena", () => {
    const current = [{ characterId: "a", hidden: true }, { characterId: "b", hidden: false }];
    expect(addToParty(current, "a")).toBe(current);
  });
});

describe("removeFromParty", () => {
  it("remove a entrada", () => {
    expect(removeFromParty(entries("a", "b", "c"), "b")).toEqual(entries("a", "c"));
  });

  it("é idempotente: não estar no grupo não é erro", () => {
    expect(removeFromParty(entries("a", "b"), "z")).toEqual(entries("a", "b"));
  });
});

describe("setPartyHidden", () => {
  it("marca oculto/visível preservando a ordem e as outras entradas", () => {
    const current = entries("a", "b");
    expect(setPartyHidden(current, "a", true)).toEqual([{ characterId: "a", hidden: true }, { characterId: "b", hidden: false }]);
  });

  it("entrada inexistente não muda nada", () => {
    const current = entries("a", "b");
    expect(setPartyHidden(current, "z", true)).toEqual(current);
  });
});

describe("reorderParty (mesma régua de reorderScenes)", () => {
  it("reordena preservando hidden de cada entrada", () => {
    const current = [{ characterId: "a", hidden: true }, { characterId: "b", hidden: false }, { characterId: "c", hidden: false }];
    const result = reorderParty(current, ["c", "a", "b"]);
    expect(result).toEqual({
      ok: true,
      entries: [{ characterId: "c", hidden: false }, { characterId: "a", hidden: true }, { characterId: "b", hidden: false }],
    });
  });

  it("rejeita id repetido", () => {
    const result = reorderParty(entries("a", "b"), ["a", "a"]);
    expect(result.ok).toBe(false);
  });

  it("rejeita lista que não bate com o grupo atual (faltando ou sobrando id)", () => {
    expect(reorderParty(entries("a", "b"), ["a"]).ok).toBe(false);
    expect(reorderParty(entries("a", "b"), ["a", "b", "c"]).ok).toBe(false);
    expect(reorderParty(entries("a", "b"), ["a", "z"]).ok).toBe(false);
  });
});
