import { describe, expect, it } from "vitest";
import { canAccessScene } from "./visibility.js";

describe("canAccessScene (regra de broadcast por mapa, docs/plano-mapas.md §5/§11)", () => {
  it("GM sempre acessa, mapa ativo ou não", () => {
    expect(canAccessScene("gm", true)).toBe(true);
    expect(canAccessScene("gm", false)).toBe(true);
  });

  it("jogador só acessa quando o mapa é o ativo", () => {
    expect(canAccessScene("player", true)).toBe(true);
    expect(canAccessScene("player", false)).toBe(false);
  });
});
