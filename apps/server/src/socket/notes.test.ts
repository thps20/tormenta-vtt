import { describe, expect, it } from "vitest";
import { buildNoteSnippet } from "./notes.js";

describe("buildNoteSnippet (docs/plano-narracao.md — busca de notas)", () => {
  it("recorta um pedaço em volta do match, case-insensitive", () => {
    const text = "O barão mente sobre o irmão dele. Ninguém sabe da verdade ainda.";
    expect(buildNoteSnippet(text, "IRMÃO")).toContain("irmão");
  });

  it("marca reticências só do lado que foi cortado", () => {
    const text = "a".repeat(100) + "ALVO" + "b".repeat(100);
    const snippet = buildNoteSnippet(text, "alvo", 10);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("ALVO");
  });

  it("texto curto sem precisar cortar não ganha reticências", () => {
    expect(buildNoteSnippet("nota curta", "curta")).toBe("nota curta");
  });

  it("sem match (não deveria acontecer, mas não quebra): devolve o começo do texto", () => {
    const text = "b".repeat(200);
    expect(buildNoteSnippet(text, "não existe")).toContain("b");
  });
});
