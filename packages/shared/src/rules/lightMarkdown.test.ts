import { describe, expect, it } from "vitest";
import { parseLightMarkdown } from "./lightMarkdown.js";

describe("parseLightMarkdown", () => {
  it("texto sem nenhuma marcação vira um parágrafo com um nó de texto só", () => {
    expect(parseLightMarkdown("Chegada ao porto")).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "Chegada ao porto" }] },
    ]);
  });

  it("negrito e itálico combinados na mesma linha", () => {
    expect(parseLightMarkdown("**negrito** e *itálico* juntos")).toEqual([
      {
        type: "paragraph",
        children: [
          { type: "bold", children: [{ type: "text", text: "negrito" }] },
          { type: "text", text: " e " },
          { type: "italic", children: [{ type: "text", text: "itálico" }] },
          { type: "text", text: " juntos" },
        ],
      },
    ]);
  });

  it("título", () => {
    expect(parseLightMarkdown("# Chegada ao porto")).toEqual([
      { type: "heading", children: [{ type: "text", text: "Chegada ao porto" }] },
    ]);
  });

  it("citação", () => {
    expect(parseLightMarkdown("> Ordem do duque")).toEqual([
      { type: "quote", children: [{ type: "text", text: "Ordem do duque" }] },
    ]);
  });

  it("lista não ordenada agrupa linhas consecutivas num bloco só", () => {
    expect(parseLightMarkdown("- primeiro\n- segundo")).toEqual([
      {
        type: "list",
        ordered: false,
        items: [[{ type: "text", text: "primeiro" }], [{ type: "text", text: "segundo" }]],
      },
    ]);
  });

  it("lista ordenada", () => {
    expect(parseLightMarkdown("1. primeiro\n2. segundo")).toEqual([
      {
        type: "list",
        ordered: true,
        items: [[{ type: "text", text: "primeiro" }], [{ type: "text", text: "segundo" }]],
      },
    ]);
  });

  it("linhas em branco separam blocos e não viram parágrafo vazio", () => {
    expect(parseLightMarkdown("primeiro\n\nsegundo")).toEqual([
      { type: "paragraph", children: [{ type: "text", text: "primeiro" }] },
      { type: "paragraph", children: [{ type: "text", text: "segundo" }] },
    ]);
  });

  it("lista seguida de parágrafo fecha o bloco de lista corretamente", () => {
    expect(parseLightMarkdown("- item\ntexto solto")).toEqual([
      { type: "list", ordered: false, items: [[{ type: "text", text: "item" }]] },
      { type: "paragraph", children: [{ type: "text", text: "texto solto" }] },
    ]);
  });
});
