import { describe, expect, it } from "vitest";
import type { SystemDefinition } from "../schemas/system.js";
import { CharacterDataSchema, type CharacterData } from "../schemas/character.js";
import { getSystemDefinition } from "../systems.js";
import { createDefaultCharacterData } from "./defaults.js";
import {
  advanceTurn,
  canAct,
  characterTiebreakBonus,
  noSheetInitiativeFormula,
  normalizeOrder,
  resumePlacement,
  sortCombatants,
  startTurns,
  stateAfterRemoval,
  type CombatantCore,
} from "./combat.js";

/** Só o bloco `combat` importa para sortCombatants/canAct/advanceTurn/startTurns. */
function defWith(combat: Partial<SystemDefinition["combat"]> = {}): SystemDefinition {
  return {
    combat: { initiative: "1d20", initiativeNoSheet: "1d20 + {bonus}", tiebreakBonus: "0", tiebreak: ["bonus", "order"], surprise: { rounds: 1 }, ...combat },
  } as SystemDefinition;
}

function c(patch: Partial<CombatantCore> & { id: string }): CombatantCore {
  return { initiative: null, bonus: 0, delayed: false, surprised: false, order: 0, ...patch };
}

describe("sortCombatants", () => {
  it("valor maior primeiro", () => {
    const def = defWith();
    const list = [c({ id: "a", initiative: 10, order: 0 }), c({ id: "b", initiative: 18, order: 1 }), c({ id: "d", initiative: 14, order: 2 })];
    expect(sortCombatants(def, list).map((x) => x.id)).toEqual(["b", "d", "a"]);
  });

  it("empate de valor decide por bonus (maior primeiro)", () => {
    const def = defWith();
    const list = [c({ id: "a", initiative: 15, bonus: 2, order: 0 }), c({ id: "b", initiative: 15, bonus: 5, order: 1 })];
    expect(sortCombatants(def, list).map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("empate de valor e bonus decide por order (menor primeiro)", () => {
    const def = defWith();
    const list = [c({ id: "a", initiative: 15, bonus: 3, order: 2 }), c({ id: "b", initiative: 15, bonus: 3, order: 0 })];
    expect(sortCombatants(def, list).map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("quem não rolou vai pro fim, mesmo com bonus alto, ordenados por order", () => {
    const def = defWith();
    const list = [
      c({ id: "rolled", initiative: 5, order: 0 }),
      c({ id: "missing2", initiative: null, bonus: 99, order: 2 }),
      c({ id: "missing1", initiative: null, bonus: 1, order: 1 }),
    ];
    expect(sortCombatants(def, list).map((x) => x.id)).toEqual(["rolled", "missing1", "missing2"]);
  });

  it("adiado sai da rotação mas fica antes dos não-rolados", () => {
    const def = defWith();
    const list = [
      c({ id: "active", initiative: 10, order: 0 }),
      c({ id: "missing", initiative: null, order: 1 }),
      c({ id: "delayed", initiative: 20, delayed: true, order: 2 }),
    ];
    expect(sortCombatants(def, list).map((x) => x.id)).toEqual(["active", "delayed", "missing"]);
  });
});

describe("canAct", () => {
  const def = defWith({ surprise: { rounds: 1 } });

  it("sem iniciativa nunca age", () => {
    expect(canAct(def, { initiative: null, delayed: false, surprised: false }, 1)).toBe(false);
  });

  it("adiado não age", () => {
    expect(canAct(def, { initiative: 10, delayed: true, surprised: false }, 1)).toBe(false);
  });

  it("surpreso não age na rodada 1, age na 2", () => {
    expect(canAct(def, { initiative: 10, delayed: false, surprised: true }, 1)).toBe(false);
    expect(canAct(def, { initiative: 10, delayed: false, surprised: true }, 2)).toBe(true);
  });

  it("surprise.rounds = 0: surpresa nunca pula ninguém", () => {
    const noSurprise = defWith({ surprise: { rounds: 0 } });
    expect(canAct(noSurprise, { initiative: 10, delayed: false, surprised: true }, 1)).toBe(true);
  });
});

describe("startTurns / advanceTurn", () => {
  it("startTurns começa na rodada 1 com o primeiro que pode agir", () => {
    const def = defWith();
    const sorted = [c({ id: "a", initiative: 20 }), c({ id: "b", initiative: 10 })];
    expect(startTurns(def, sorted)).toEqual({ activeCombatantId: "a", round: 1 });
  });

  it("next anda 1 a 1", () => {
    const def = defWith();
    const sorted = [c({ id: "a", initiative: 20 }), c({ id: "b", initiative: 10 }), c({ id: "d", initiative: 5 })];
    expect(advanceTurn(def, sorted, { activeCombatantId: "a", round: 1 }, 1)).toEqual({ activeCombatantId: "b", round: 1 });
  });

  it("next no último fecha o ciclo: incrementa a rodada e volta ao primeiro", () => {
    const def = defWith();
    const sorted = [c({ id: "a", initiative: 20 }), c({ id: "b", initiative: 10 })];
    expect(advanceTurn(def, sorted, { activeCombatantId: "b", round: 1 }, 1)).toEqual({ activeCombatantId: "a", round: 2 });
  });

  it("prev no primeiro volta ao último e decrementa a rodada (mínimo 1)", () => {
    const def = defWith();
    const sorted = [c({ id: "a", initiative: 20 }), c({ id: "b", initiative: 10 })];
    expect(advanceTurn(def, sorted, { activeCombatantId: "a", round: 2 }, -1)).toEqual({ activeCombatantId: "b", round: 1 });
    // Já na rodada 1: continua voltando ao último, mas a rodada não fica negativa.
    expect(advanceTurn(def, sorted, { activeCombatantId: "a", round: 1 }, -1)).toEqual({ activeCombatantId: "b", round: 1 });
  });

  it("pula quem está surpreso na rodada 1 e o pega de volta na 2", () => {
    const def = defWith({ surprise: { rounds: 1 } });
    const sorted = [c({ id: "a", initiative: 20 }), c({ id: "surprised", initiative: 15, surprised: true }), c({ id: "b", initiative: 10 })];
    // De "a" (rodada 1), o próximo deveria ser "surprised", mas ele está de fora -> pula pra "b".
    expect(advanceTurn(def, sorted, { activeCombatantId: "a", round: 1 }, 1)).toEqual({ activeCombatantId: "b", round: 1 });
    // Fechando o ciclo (de "b"), a rodada vira 2; "a" (não surpreso) age de novo primeiro.
    expect(advanceTurn(def, sorted, { activeCombatantId: "b", round: 1 }, 1)).toEqual({ activeCombatantId: "a", round: 2 });
    // Só agora, de "a" na rodada 2, "surprised" já pode agir.
    expect(advanceTurn(def, sorted, { activeCombatantId: "a", round: 2 }, 1)).toEqual({ activeCombatantId: "surprised", round: 2 });
  });

  it("todos surpresos na rodada 1: avança a rodada em vez de travar", () => {
    const def = defWith({ surprise: { rounds: 1 } });
    const sorted = [c({ id: "a", initiative: 20, surprised: true }), c({ id: "b", initiative: 10, surprised: true })];
    // Ninguém pode agir na rodada 1; percorrendo a lista inteira a rodada vira 2 e "a" (primeiro) assume.
    expect(advanceTurn(def, sorted, { activeCombatantId: null, round: 1 }, 1)).toEqual({ activeCombatantId: "a", round: 2 });
  });

  it("combatente sem iniciativa nunca recebe turno", () => {
    const def = defWith();
    const sorted = [c({ id: "a", initiative: 20 }), c({ id: "missing", initiative: null })];
    expect(advanceTurn(def, sorted, { activeCombatantId: "a", round: 1 }, 1)).toEqual({ activeCombatantId: "a", round: 2 });
  });

  it("lista vazia não trava", () => {
    const def = defWith();
    expect(advanceTurn(def, [], { activeCombatantId: null, round: 0 }, 1)).toEqual({ activeCombatantId: null, round: 0 });
  });
});

describe("normalizeOrder", () => {
  it("renumera 0..n-1 na ordem da lista, sem buraco nem empate", () => {
    const list = [{ id: "a", order: 5 }, { id: "b", order: 5 }, { id: "d", order: 9 }];
    expect(normalizeOrder(list)).toEqual([{ id: "a", order: 0 }, { id: "b", order: 1 }, { id: "d", order: 2 }]);
  });
});

describe("resumePlacement", () => {
  it("adiado entra antes do ativo, copiando iniciativa e bônus dele, e some o delayed", () => {
    const sorted = [
      c({ id: "active", initiative: 20, bonus: 3, order: 0 }),
      c({ id: "other", initiative: 10, order: 1 }),
      c({ id: "delayed", initiative: 15, bonus: 1, delayed: true, order: 2 }),
    ];
    const result = resumePlacement(sorted, "active", "delayed");
    expect(result.map((x) => ({ id: x.id, order: x.order }))).toEqual([
      { id: "delayed", order: 0 },
      { id: "active", order: 1 },
      { id: "other", order: 2 },
    ]);
    const resumed = result.find((x) => x.id === "delayed")!;
    expect(resumed.initiative).toBe(20);
    expect(resumed.bonus).toBe(3);
    expect(resumed.delayed).toBe(false);
  });
});

describe("stateAfterRemoval", () => {
  it("ativo não removido: nada muda", () => {
    const def = defWith();
    const list = [c({ id: "a", initiative: 20 }), c({ id: "b", initiative: 10 })];
    expect(stateAfterRemoval(def, list, { activeCombatantId: "a", round: 1 }, new Set(["b"]))).toEqual({ activeCombatantId: "a", round: 1 });
  });

  it("remover o ativo passa o turno pra quem agiria em seguida", () => {
    const def = defWith();
    const list = [c({ id: "a", initiative: 20 }), c({ id: "b", initiative: 15 }), c({ id: "d", initiative: 10 })];
    expect(stateAfterRemoval(def, list, { activeCombatantId: "a", round: 1 }, new Set(["a"]))).toEqual({ activeCombatantId: "b", round: 1 });
  });

  it("remover o ativo e o próximo junto pula os dois", () => {
    const def = defWith();
    const list = [c({ id: "a", initiative: 20 }), c({ id: "b", initiative: 15 }), c({ id: "d", initiative: 10 })];
    expect(stateAfterRemoval(def, list, { activeCombatantId: "a", round: 1 }, new Set(["a", "b"]))).toEqual({ activeCombatantId: "d", round: 1 });
  });

  it("remover o último ativo fecha o ciclo (avança a rodada)", () => {
    const def = defWith();
    const list = [c({ id: "a", initiative: 20 }), c({ id: "b", initiative: 10 })];
    expect(stateAfterRemoval(def, list, { activeCombatantId: "b", round: 1 }, new Set(["b"]))).toEqual({ activeCombatantId: "a", round: 2 });
  });

  it("remover todo mundo: ninguém fica ativo (a rodada pode avançar procurando alguém que não existe mais)", () => {
    const def = defWith();
    const list = [c({ id: "a", initiative: 20 }), c({ id: "b", initiative: 10 })];
    const result = stateAfterRemoval(def, list, { activeCombatantId: "a", round: 1 }, new Set(["a", "b"]));
    expect(result.activeCombatantId).toBeNull();
  });
});

describe("characterTiebreakBonus / noSheetInitiativeFormula (integração com tormenta20.json)", () => {
  const def = getSystemDefinition("tormenta20");

  function fixture(patch: Record<string, unknown> = {}): CharacterData {
    const base = createDefaultCharacterData(def);
    return CharacterDataSchema.parse({ ...base, attributes: { des: { base: 3 } }, skills: { iniciativa: {} }, ...patch });
  }

  it("bônus de desempate é o mesmo valor de {skill.iniciativa} (sem dado)", () => {
    const bonus = characterTiebreakBonus(def, fixture());
    expect(bonus).toBe(3); // metade do nível (0, nível 1) + DES 3
  });

  it("fórmula sem ficha substitui só {bonus}", () => {
    expect(noSheetInitiativeFormula(def, 4)).toBe("1d20 + 4");
  });
});
