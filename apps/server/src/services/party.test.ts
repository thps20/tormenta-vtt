import { describe, expect, it } from "vitest";
import type { PartyEntry } from "@tormenta-vtt/shared";
import { partyFor } from "./party.js";

const entry = (characterId: string, hidden = false): PartyEntry => ({ characterId, hidden });

describe("partyFor (SPEC §9.15 — visibilidade da Visão de grupo por papel)", () => {
  const entries = [entry("a"), entry("b", true), entry("c")];
  const pcIds = new Set(["a", "b", "c"]);

  it("GM recebe todo mundo, ocultas inclusive", () => {
    expect(partyFor(entries, pcIds, "gm")).toEqual(entries);
  });

  it("jogador nunca recebe entrada oculta", () => {
    expect(partyFor(entries, pcIds, "player")).toEqual([entry("a"), entry("c")]);
  });

  it("entrada cujo personagem não é mais PC (apagado, ou virou NPC) some pra TODOS, GM inclusive", () => {
    const pcIdsSemB = new Set(["a", "c"]);
    expect(partyFor(entries, pcIdsSemB, "gm")).toEqual([entry("a"), entry("c")]);
    expect(partyFor(entries, pcIdsSemB, "player")).toEqual([entry("a"), entry("c")]);
  });

  it("grupo vazio devolve lista vazia pros dois papéis", () => {
    expect(partyFor([], pcIds, "gm")).toEqual([]);
    expect(partyFor([], pcIds, "player")).toEqual([]);
  });

  it("todas ocultas: GM ainda vê todas, jogador não vê nenhuma", () => {
    const allHidden = [entry("a", true), entry("b", true)];
    const ids = new Set(["a", "b"]);
    expect(partyFor(allHidden, ids, "gm")).toEqual(allHidden);
    expect(partyFor(allHidden, ids, "player")).toEqual([]);
  });
});
