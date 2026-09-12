import { describe, expect, it } from "vitest";
import { DrawingSchema } from "./drawing.js";

const base = { id: "d1", sceneId: "s1", ownerId: "p1", color: "#ff0000", strokeWidth: 4, visible: true };

describe("DrawingSchema", () => {
  it("aceita um traço de caneta válido", () => {
    expect(DrawingSchema.safeParse({ ...base, kind: "pen", points: [0, 0, 10, 10, 20, 0] }).success).toBe(true);
  });

  it("rejeita pontos ímpares ou faltando", () => {
    expect(DrawingSchema.safeParse({ ...base, kind: "pen", points: [0, 0, 10] }).success).toBe(false);
    expect(DrawingSchema.safeParse({ ...base, kind: "pen", points: [0, 0] }).success).toBe(false);
  });

  it("aceita linha/seta com as 4 coordenadas", () => {
    expect(DrawingSchema.safeParse({ ...base, kind: "line", x1: 0, y1: 0, x2: 10, y2: 10 }).success).toBe(true);
    expect(DrawingSchema.safeParse({ ...base, kind: "arrow", x1: 0, y1: 0, x2: 10, y2: 10 }).success).toBe(true);
  });

  it("retângulo e elipse exigem tamanho positivo; filled tem default false", () => {
    const rect = DrawingSchema.parse({ ...base, kind: "rect", x: 0, y: 0, width: 10, height: 10 });
    expect(rect.kind === "rect" && rect.filled).toBe(false);
    expect(DrawingSchema.safeParse({ ...base, kind: "rect", x: 0, y: 0, width: 0, height: 10 }).success).toBe(false);
    expect(DrawingSchema.safeParse({ ...base, kind: "ellipse", cx: 0, cy: 0, rx: -1, ry: 10 }).success).toBe(false);
  });

  it("texto exige conteúdo não vazio", () => {
    expect(DrawingSchema.safeParse({ ...base, kind: "text", x: 0, y: 0, text: "" }).success).toBe(false);
    expect(DrawingSchema.safeParse({ ...base, kind: "text", x: 0, y: 0, text: "olá" }).success).toBe(true);
  });

  it("rejeita cor fora do formato hex", () => {
    expect(DrawingSchema.safeParse({ ...base, color: "red", kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 }).success).toBe(false);
  });

  it("rejeita espessura fora do intervalo", () => {
    expect(DrawingSchema.safeParse({ ...base, strokeWidth: 0, kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 }).success).toBe(false);
    expect(DrawingSchema.safeParse({ ...base, strokeWidth: 21, kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 }).success).toBe(false);
  });
});
