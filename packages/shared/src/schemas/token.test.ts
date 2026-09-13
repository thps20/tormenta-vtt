import { describe, expect, it } from "vitest";
import { TokenConditionEntrySchema, TokenSchema } from "./token.js";

const baseToken = {
  id: "t1",
  sceneId: "s1",
  name: "Goblin",
  imageUrl: null,
  x: 0,
  y: 0,
  ownerId: null,
};

describe("TokenSchema.cells (docs/plano-grid.md — meia célula do Minúsculo)", () => {
  it("aceita inteiro >= 1 (padrão de sempre)", () => {
    expect(TokenSchema.parse({ ...baseToken, cells: 1 }).cells).toBe(1);
    expect(TokenSchema.parse({ ...baseToken, cells: 2 }).cells).toBe(2);
    expect(TokenSchema.parse(baseToken).cells).toBe(1); // default
  });

  it("aceita exatamente 0.5 (meia célula)", () => {
    expect(TokenSchema.parse({ ...baseToken, cells: 0.5 }).cells).toBe(0.5);
  });

  it("rejeita fração diferente de 0.5, zero e negativo", () => {
    expect(() => TokenSchema.parse({ ...baseToken, cells: 1.5 })).toThrow();
    expect(() => TokenSchema.parse({ ...baseToken, cells: 0.25 })).toThrow();
    expect(() => TokenSchema.parse({ ...baseToken, cells: 0 })).toThrow();
    expect(() => TokenSchema.parse({ ...baseToken, cells: -1 })).toThrow();
  });
});

describe("TokenConditionEntrySchema (preprocess de Token.conditions)", () => {
  it("normaliza a forma antiga (string) pra { key }, sem expiresRound (permanente)", () => {
    expect(TokenConditionEntrySchema.parse("atordoado")).toEqual({ key: "atordoado" });
  });

  it("aceita a forma nova direto, com expiresRound", () => {
    expect(TokenConditionEntrySchema.parse({ key: "atordoado", expiresRound: 3 })).toEqual({
      key: "atordoado",
      expiresRound: 3,
    });
  });

  it("aceita a forma nova sem expiresRound (permanente)", () => {
    expect(TokenConditionEntrySchema.parse({ key: "cego" })).toEqual({ key: "cego" });
  });

  it("rejeita expiresRound 0, negativo ou não-inteiro", () => {
    expect(() => TokenConditionEntrySchema.parse({ key: "cego", expiresRound: 0 })).toThrow();
    expect(() => TokenConditionEntrySchema.parse({ key: "cego", expiresRound: -1 })).toThrow();
    expect(() => TokenConditionEntrySchema.parse({ key: "cego", expiresRound: 1.5 })).toThrow();
  });

  it("rejeita chave que não bate com KeySchema (maiúscula/acento/espaço)", () => {
    expect(() => TokenConditionEntrySchema.parse("Atordoado")).toThrow();
  });
});
