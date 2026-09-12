import { describe, expect, it } from "vitest";
import { CharacterSchema, createDefaultCharacterData, getSystemDefinition, type Character } from "@tormenta-vtt/shared";
import { resolveMacroTarget } from "./macros";

const def = getSystemDefinition("tormenta20");

function character(patch: Partial<Character> = {}): Character {
  return CharacterSchema.parse({
    ...createDefaultCharacterData(def),
    id: "c1",
    roomId: "r1",
    ownerId: "p1",
    name: "Teste",
    kind: "pc",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    items: [{ id: "i1", name: "Espada longa", kind: "weapon", fields: {}, actions: [{ id: "a1", kind: "formula", label: "Ataque", formula: "1d20+5", damageType: null }], equipped: true, quantity: 1, statBonuses: {}, enhancements: [], activation: null, save: null }],
    ...patch,
  });
}

describe("resolveMacroTarget", () => {
  it("'roll' e 'chatText' são sempre ok, mesmo sem nenhuma ficha", () => {
    expect(resolveMacroTarget({ type: "roll", formula: "2d6+3" }, [])).toEqual({ ok: true });
    expect(resolveMacroTarget({ type: "chatText", text: "Ataque duplo!" }, [])).toEqual({ ok: true });
  });

  it("characterAction: ficha, item e ação existem — ok", () => {
    const check = resolveMacroTarget({ type: "characterAction", characterId: "c1", itemId: "i1", actionId: "a1", enhancements: [] }, [character()]);
    expect(check).toEqual({ ok: true });
  });

  it("characterAction: ficha apagada — 'Personagem não encontrado'", () => {
    const check = resolveMacroTarget({ type: "characterAction", characterId: "c1", itemId: "i1", actionId: "a1", enhancements: [] }, []);
    expect(check).toEqual({ ok: false, reason: "Personagem não encontrado" });
  });

  it("characterAction: item apagado da ficha — 'Item não encontrado'", () => {
    const check = resolveMacroTarget({ type: "characterAction", characterId: "c1", itemId: "sumiu", actionId: "a1", enhancements: [] }, [character()]);
    expect(check).toEqual({ ok: false, reason: "Item não encontrado" });
  });

  it("characterAction: ação apagada do item — 'Ação não encontrada'", () => {
    const check = resolveMacroTarget({ type: "characterAction", characterId: "c1", itemId: "i1", actionId: "sumiu", enhancements: [] }, [character()]);
    expect(check).toEqual({ ok: false, reason: "Ação não encontrada" });
  });

  it("useItem: só precisa do item, não de uma ação específica", () => {
    const check = resolveMacroTarget({ type: "useItem", characterId: "c1", itemId: "i1", enhancements: [] }, [character()]);
    expect(check).toEqual({ ok: true });
  });
});
