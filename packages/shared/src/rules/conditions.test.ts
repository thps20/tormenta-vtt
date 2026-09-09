import { describe, expect, it } from "vitest";
import { deriveExpiresRound, effectiveCombatRound, expireConditions, stripTimedConditions } from "./conditions.js";
import type { TokenCondition } from "../schemas/token.js";

describe("expireConditions", () => {
  it("remove exatamente as condições com expiresRound <= round, mantém as demais", () => {
    const conditions: TokenCondition[] = [
      { key: "atordoado", expiresRound: 3 },
      { key: "cego", expiresRound: 5 },
      { key: "abalado" }, // permanente
    ];
    const { remaining, expired } = expireConditions(conditions, 3);
    expect(expired).toEqual([{ key: "atordoado", expiresRound: 3 }]);
    expect(remaining).toEqual([{ key: "cego", expiresRound: 5 }, { key: "abalado" }]);
  });

  it("condição permanente (sem expiresRound) nunca expira, em rodada nenhuma", () => {
    const conditions: TokenCondition[] = [{ key: "abalado" }];
    expect(expireConditions(conditions, 1).remaining).toEqual(conditions);
    expect(expireConditions(conditions, 999).remaining).toEqual(conditions);
    expect(expireConditions(conditions, 999).expired).toEqual([]);
  });

  it("sem nada pra expirar, devolve a mesma lista em remaining e [] em expired", () => {
    const conditions: TokenCondition[] = [{ key: "cego", expiresRound: 10 }];
    const { remaining, expired } = expireConditions(conditions, 2);
    expect(remaining).toEqual(conditions);
    expect(expired).toEqual([]);
  });
});

describe("stripTimedConditions", () => {
  it("remove toda condição com expiresRound (não importa o valor), preserva as permanentes", () => {
    const conditions: TokenCondition[] = [
      { key: "atordoado", expiresRound: 1 },
      { key: "cego", expiresRound: 999 },
      { key: "abalado" },
    ];
    const { remaining, expired } = stripTimedConditions(conditions);
    expect(remaining).toEqual([{ key: "abalado" }]);
    expect(expired).toEqual([{ key: "atordoado", expiresRound: 1 }, { key: "cego", expiresRound: 999 }]);
  });
});

describe("effectiveCombatRound / deriveExpiresRound", () => {
  it("com o combate já rodando (round >= 1), a rodada efetiva é a própria", () => {
    expect(effectiveCombatRound(1)).toBe(1);
    expect(effectiveCombatRound(5)).toBe(5);
    expect(deriveExpiresRound(3, 2)).toBe(5);
  });

  it("com o combate em 'rolling' (round 0), a rodada efetiva é 1 — não 0", () => {
    expect(effectiveCombatRound(0)).toBe(1);
    expect(deriveExpiresRound(0, 2)).toBe(3);
  });

  it("marcar Surpreendido (defaultDuration 1) em rolling: ativo na rodada 1, expira na 2", () => {
    // Marcado antes do primeiro "Próximo": combatRound ainda é 0 (status "rolling").
    const expiresRound = deriveExpiresRound(0, 1);
    expect(expiresRound).toBe(2);

    const conditions: TokenCondition[] = [{ key: "surpreendido", expiresRound }];

    // Primeiro combat:next (rolling -> active) leva a rodada a 1: a condição continua valendo.
    expect(expireConditions(conditions, 1).remaining).toEqual(conditions);
    expect(expireConditions(conditions, 1).expired).toEqual([]);

    // combat:next seguinte vira a rodada pra 2: aí sim expira.
    expect(expireConditions(conditions, 2).expired).toEqual(conditions);
    expect(expireConditions(conditions, 2).remaining).toEqual([]);
  });
});
