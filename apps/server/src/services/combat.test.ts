import { describe, expect, it } from "vitest";
import { combatantValuesVisibleTo } from "./combat.js";

describe("combatantValuesVisibleTo (quem vê iniciativa/bônus na lista, docs/plano-combate.md §4)", () => {
  const gm = { role: "gm" as const, participantId: "gm1" };
  const ana = { role: "player" as const, participantId: "ana" };

  it("GM vê tudo, qualquer que seja a rolagem", () => {
    for (const vis of ["all", "gm", "self", null]) {
      expect(combatantValuesVisibleTo(gm, null, vis)).toEqual({ initiative: true, bonus: true });
    }
  });

  it("rolagem pública mostra a iniciativa de NPC e de outro jogador, mas nunca o bônus", () => {
    expect(combatantValuesVisibleTo(ana, null, "all")).toEqual({ initiative: true, bonus: false });
    expect(combatantValuesVisibleTo(ana, "bruno", "all")).toEqual({ initiative: true, bonus: false });
  });

  it("rolagem secreta ou só-GM de outro combatente continua escondida", () => {
    expect(combatantValuesVisibleTo(ana, null, "gm")).toEqual({ initiative: false, bonus: false });
    expect(combatantValuesVisibleTo(ana, null, "self")).toEqual({ initiative: false, bonus: false });
    expect(combatantValuesVisibleTo(ana, "bruno", "self")).toEqual({ initiative: false, bonus: false });
  });

  it("valor digitado pelo GM (null) só aparece para o dono", () => {
    expect(combatantValuesVisibleTo(ana, null, null)).toEqual({ initiative: false, bonus: false });
    expect(combatantValuesVisibleTo(ana, "ana", null)).toEqual({ initiative: true, bonus: true });
  });

  it("o próprio combatente: visível, menos às cegas", () => {
    expect(combatantValuesVisibleTo(ana, "ana", "all")).toEqual({ initiative: true, bonus: true });
    expect(combatantValuesVisibleTo(ana, "ana", "self")).toEqual({ initiative: true, bonus: true });
    expect(combatantValuesVisibleTo(ana, "ana", "gm")).toEqual({ initiative: false, bonus: false });
  });
});
