import { describe, expect, it } from "vitest";
import { describeTemplateChange, formatArea, parseAreaText, pointInTemplate, presetConeAngle, presetLineWidth, tokensInTemplate } from "./templates.js";
import type { Template } from "../schemas/template.js";
import { TemplateAreaSchema, type Activation } from "../schemas/character.js";
import type { SystemDefinition } from "../schemas/system.js";

const base = { id: "t1", ownerId: "p1", label: "" };

describe("pointInTemplate", () => {
  it("círculo: dentro e fora do raio", () => {
    const t: Template = { ...base, shape: "circle", x: 100, y: 100, rotation: 0, r: 50 };
    expect(pointInTemplate({ x: 130, y: 100 }, t)).toBe(true); // 30 <= 50
    expect(pointInTemplate({ x: 200, y: 100 }, t)).toBe(false); // 100 > 50
    expect(pointInTemplate({ x: 100, y: 150 }, t)).toBe(true); // na borda
  });

  it("quadrado: girado 90° o comprido vira o eixo y", () => {
    const t: Template = { ...base, shape: "square", x: 0, y: 0, rotation: Math.PI / 2, side: 20 };
    expect(pointInTemplate({ x: 9, y: 0 }, t)).toBe(true);
    expect(pointInTemplate({ x: 0, y: 9 }, t)).toBe(true);
    expect(pointInTemplate({ x: 15, y: 0 }, t)).toBe(false);
  });

  it("linha: comprimento na direção da rotação, largura perpendicular", () => {
    const t: Template = { ...base, shape: "line", x: 0, y: 0, rotation: 0, length: 100, width: 20 };
    expect(pointInTemplate({ x: 50, y: 5 }, t)).toBe(true);
    expect(pointInTemplate({ x: 50, y: 15 }, t)).toBe(false); // fora da largura
    expect(pointInTemplate({ x: 150, y: 0 }, t)).toBe(false); // além do comprimento
    expect(pointInTemplate({ x: -10, y: 0 }, t)).toBe(false); // atrás da origem
  });

  it("cone: dentro do raio e do ângulo, na direção da rotação", () => {
    const t: Template = { ...base, shape: "cone", x: 0, y: 0, rotation: 0, length: 100, angle: 90 };
    expect(pointInTemplate({ x: 50, y: 0 }, t)).toBe(true); // direção exata
    expect(pointInTemplate({ x: 50, y: 40 }, t)).toBe(true); // dentro dos 45° de meio-ângulo
    expect(pointInTemplate({ x: 50, y: 60 }, t)).toBe(false); // fora do ângulo
    expect(pointInTemplate({ x: -50, y: 0 }, t)).toBe(false); // atrás do cone
    expect(pointInTemplate({ x: 200, y: 0 }, t)).toBe(false); // além do alcance
  });

  it("cone girado: a direção acompanha rotation", () => {
    const t: Template = { ...base, shape: "cone", x: 0, y: 0, rotation: Math.PI, length: 100, angle: 60 };
    expect(pointInTemplate({ x: -50, y: 0 }, t)).toBe(true);
    expect(pointInTemplate({ x: 50, y: 0 }, t)).toBe(false);
  });
});

describe("tokensInTemplate", () => {
  const circle: Template = { ...base, shape: "circle", x: 100, y: 100, rotation: 0, r: 60 };

  it("token pequeno conta pelo centro da célula (== centro do token com 1 célula)", () => {
    const tokens = [{ id: "a", x: 90, y: 90, width: 20, height: 20 }]; // centro em (100,100)
    expect(tokensInTemplate(tokens, circle, 20)).toEqual(new Set(["a"]));
  });

  it("token fora não conta", () => {
    const tokens = [{ id: "a", x: 500, y: 500, width: 20, height: 20 }];
    expect(tokensInTemplate(tokens, circle, 20)).toEqual(new Set());
  });

  it("token grande conta se QUALQUER célula estiver dentro", () => {
    // Token 3x3 células cobrindo de (40,40) a (100,100); a célula mais próxima do centro do
    // círculo (célula 90,90) entra, mesmo a maior parte do token ficando fora.
    const tokens = [{ id: "big", x: 40, y: 40, width: 60, height: 60 }];
    expect(tokensInTemplate(tokens, circle, 20)).toEqual(new Set(["big"]));
  });
});

describe("parseAreaText", () => {
  it("casa esfera/círculo, cone, linha/raio e quadrado/cubo com o tamanho", () => {
    expect(parseAreaText("Esfera de 6 m de raio")).toEqual({ shape: "circle", size: 6 });
    expect(parseAreaText("Círculo de 4,5 m")).toEqual({ shape: "circle", size: 4.5 });
    expect(parseAreaText("Cone de 9 m")).toEqual({ shape: "cone", size: 9 });
    expect(parseAreaText("Linha de 3 m")).toEqual({ shape: "line", size: 3 });
    expect(parseAreaText("Quadrado de 3 m de lado")).toEqual({ shape: "square", size: 3 });
    expect(parseAreaText("Cubo de 3 m")).toEqual({ shape: "square", size: 3 });
  });

  it("também casa '<forma> com N m ...' (ex.: 'esfera com 6m de raio')", () => {
    expect(parseAreaText("Esfera com 6m de raio")).toEqual({ shape: "circle", size: 6 });
    expect(parseAreaText("Linha com 30 m de comprimento")).toEqual({ shape: "line", size: 30 });
  });

  it("sem match devolve null (frase composta, fora do padrão, ou forma sem tamanho)", () => {
    expect(parseAreaText("Toque")).toBeNull();
    expect(parseAreaText("Um alvo por nível")).toBeNull();
    expect(parseAreaText("")).toBeNull();
    expect(parseAreaText("Cubo")).toBeNull(); // nunca infere um tamanho não dito
  });
});

describe("formatArea", () => {
  const def: Pick<SystemDefinition, "templates" | "grid"> = {
    templates: { coneAngle: 90, lineWidth: 1.5, presets: [], shapeLabels: { circle: "Esfera", cone: "Cone", line: "Linha", square: "Quadrado" } },
    grid: { cellSize: 1.5, unit: "m", diagonals: "chebyshev" },
  };

  it("null sem área", () => {
    expect(formatArea(def, null)).toBeNull();
  });

  it("texto livre sai direto", () => {
    const area: Activation["area"] = { kind: "text", text: "1 alvo por nível" };
    expect(formatArea(def, area)).toBe("1 alvo por nível");
  });

  it("forma usa o rótulo do sistema + tamanho + unidade do grid", () => {
    const area: Activation["area"] = { kind: "shape", shape: "circle", size: 6 };
    expect(formatArea(def, area)).toBe("Esfera 6 m");
  });

  it("sem def.templates cai no nome cru da forma, sem travar", () => {
    const area: Activation["area"] = { kind: "shape", shape: "cone", size: 9 };
    expect(formatArea({ templates: undefined, grid: def.grid }, area)).toBe("cone 9 m");
  });
});

describe("describeTemplateChange", () => {
  it("monta o resumo do toast de desfazer/refazer", () => {
    expect(describeTemplateChange("colocar", "cone 9 m")).toBe("colocar área (cone 9 m)");
    expect(describeTemplateChange("apagar", "esfera 6 m")).toBe("apagar área (esfera 6 m)");
  });
});

describe("presetConeAngle / presetLineWidth", () => {
  const def = { coneAngle: 90, lineWidth: 1.5, presets: [], shapeLabels: { circle: "Esfera", cone: "Cone", line: "Linha", square: "Quadrado" } };
  it("usa o padrão do sistema quando o preset não sobrescreve", () => {
    expect(presetConeAngle(def, undefined)).toBe(90);
    expect(presetLineWidth(def, undefined)).toBe(1.5);
  });
  it("preset sobrescreve", () => {
    expect(presetConeAngle(def, 60)).toBe(60);
    expect(presetLineWidth(def, 3)).toBe(3);
  });
});

describe("TemplateAreaSchema (docs/plano-gabaritos.md §6)", () => {
  it("formato novo passa direto", () => {
    expect(TemplateAreaSchema.parse({ kind: "shape", shape: "circle", size: 6 })).toEqual({ kind: "shape", shape: "circle", size: 6 });
    expect(TemplateAreaSchema.parse({ kind: "text", text: "1 alvo por nível" })).toEqual({ kind: "text", text: "1 alvo por nível" });
    expect(TemplateAreaSchema.parse(null)).toBeNull();
  });

  it("migra string antiga (Character.data/ChatMessage.item persistidos) para { kind: 'text' }", () => {
    expect(TemplateAreaSchema.parse("Esfera de 6 m de raio")).toEqual({ kind: "text", text: "Esfera de 6 m de raio" });
  });

  it("string vazia (default antigo) vira null", () => {
    expect(TemplateAreaSchema.parse("")).toBeNull();
    expect(TemplateAreaSchema.parse("   ")).toBeNull();
  });

  it("ausente (undefined) vira null via .default(null) em ActivationSchema", () => {
    expect(TemplateAreaSchema.safeParse(undefined).success).toBe(false); // sem .default aqui — quem tem é ActivationSchema.area
  });
});
