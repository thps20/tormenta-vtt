import { describe, expect, it } from "vitest";
import { TokenSchema } from "../schemas/token.js";
import { resolveTokenDefaults, tokenDefaultsFromToken } from "./tokenDefaults.js";

const token = TokenSchema.parse({ id: "t1", sceneId: "s1", name: "Goblin", imageUrl: "/u/goblin.png", x: 0, y: 0, cells: 2, color: "#16a34a", ownerId: null });

describe("tokenDefaults (docs/SPEC.md §9.30)", () => {
  it("copia do token só a aparência (imagem, tamanho e cor)", () => {
    expect(tokenDefaultsFromToken(token)).toEqual({ imageUrl: "/u/goblin.png", cells: 2, color: "#16a34a" });
  });

  it("ficha sem aparência guardada cai nos padrões do schema", () => {
    expect(resolveTokenDefaults(null)).toEqual({ imageUrl: null, cells: 1, color: "#e11d48" });
  });

  it("ficha com aparência guardada devolve ela mesma", () => {
    const saved = tokenDefaultsFromToken(token);
    expect(resolveTokenDefaults(saved)).toBe(saved);
  });
});
