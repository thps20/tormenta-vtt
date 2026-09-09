import { describe, expect, it } from "vitest";
import { TokenConditionEntrySchema } from "./token.js";

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
