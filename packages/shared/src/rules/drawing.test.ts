import { describe, expect, it } from "vitest";
import type { Drawing } from "../schemas/drawing.js";
import { drawingBounds, drawingOwnedBy, drawingVisibleTo, hitTestDrawing, smoothPenPoints } from "./drawing.js";

const base = { id: "d1", sceneId: "s1", ownerId: "gm1", color: "#ff0000", strokeWidth: 4, visible: true };

describe("drawingBounds", () => {
  it("pen: caixa a partir dos pontos", () => {
    const d: Drawing = { ...base, kind: "pen", points: [0, 10, 20, 0, 5, 30] };
    expect(drawingBounds(d)).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 30 });
  });

  it("line/arrow: caixa a partir das duas pontas, em qualquer ordem", () => {
    const d: Drawing = { ...base, kind: "line", x1: 20, y1: 5, x2: 0, y2: 15 };
    expect(drawingBounds(d)).toEqual({ minX: 0, minY: 5, maxX: 20, maxY: 15 });
  });

  it("rect: canto + tamanho", () => {
    const d: Drawing = { ...base, kind: "rect", x: 10, y: 10, width: 5, height: 8, filled: false };
    expect(drawingBounds(d)).toEqual({ minX: 10, minY: 10, maxX: 15, maxY: 18 });
  });

  it("ellipse: centro ± raios", () => {
    const d: Drawing = { ...base, kind: "ellipse", cx: 10, cy: 10, rx: 5, ry: 2, filled: false };
    expect(drawingBounds(d)).toEqual({ minX: 5, minY: 8, maxX: 15, maxY: 12 });
  });
});

describe("hitTestDrawing", () => {
  it("pen: dentro da tolerância da polilinha", () => {
    const d: Drawing = { ...base, strokeWidth: 4, kind: "pen", points: [0, 0, 100, 0] };
    expect(hitTestDrawing(d, { x: 50, y: 1 }, 2)).toBe(true);
    expect(hitTestDrawing(d, { x: 50, y: 10 }, 2)).toBe(false);
  });

  it("line: distância ao segmento", () => {
    const d: Drawing = { ...base, strokeWidth: 2, kind: "line", x1: 0, y1: 0, x2: 10, y2: 0 };
    expect(hitTestDrawing(d, { x: 5, y: 0 }, 1)).toBe(true);
    expect(hitTestDrawing(d, { x: 5, y: 5 }, 1)).toBe(false);
  });

  it("rect: qualquer ponto de dentro conta, preenchido ou não", () => {
    const d: Drawing = { ...base, strokeWidth: 1, kind: "rect", x: 0, y: 0, width: 10, height: 10, filled: false };
    expect(hitTestDrawing(d, { x: 5, y: 5 }, 0)).toBe(true);
    expect(hitTestDrawing(d, { x: 20, y: 20 }, 0)).toBe(false);
  });

  it("ellipse: dentro da elipse normalizada", () => {
    const d: Drawing = { ...base, strokeWidth: 1, kind: "ellipse", cx: 0, cy: 0, rx: 10, ry: 5, filled: false };
    expect(hitTestDrawing(d, { x: 0, y: 0 }, 0)).toBe(true);
    expect(hitTestDrawing(d, { x: 20, y: 0 }, 0)).toBe(false);
  });

  it("text: dentro da caixa estimada", () => {
    const d: Drawing = { ...base, strokeWidth: 20, kind: "text", x: 0, y: 0, text: "olá" };
    expect(hitTestDrawing(d, { x: 5, y: 5 }, 0)).toBe(true);
    expect(hitTestDrawing(d, { x: 500, y: 500 }, 0)).toBe(false);
  });
});

describe("smoothPenPoints", () => {
  it("reta colinear reduz a 2 pontos", () => {
    const points = [0, 0, 5, 0, 10, 0, 15, 0, 20, 0];
    expect(smoothPenPoints(points, 0.5)).toEqual([0, 0, 20, 0]);
  });

  it("zigue-zague preserva os vértices que fogem da tolerância", () => {
    const points = [0, 0, 5, 10, 10, 0, 15, 10, 20, 0];
    expect(smoothPenPoints(points, 1)).toEqual(points);
  });

  it("entrada com menos de 3 pontos não quebra", () => {
    expect(smoothPenPoints([0, 0, 10, 10], 1)).toEqual([0, 0, 10, 10]);
    expect(smoothPenPoints([], 1)).toEqual([]);
  });
});

describe("drawingOwnedBy / drawingVisibleTo", () => {
  const d: Drawing = { ...base, kind: "line", x1: 0, y1: 0, x2: 1, y2: 1 };

  it("dono é sempre quem criou", () => {
    expect(drawingOwnedBy(d, "gm1")).toBe(true);
    expect(drawingOwnedBy(d, "player1")).toBe(false);
  });

  it("GM sempre vê; jogador só se visible e mapa ativo", () => {
    expect(drawingVisibleTo(d, { role: "gm" }, "outro-mapa")).toBe(true);
    expect(drawingVisibleTo(d, { role: "player" }, "s1")).toBe(true);
    expect(drawingVisibleTo(d, { role: "player" }, "outro-mapa")).toBe(false);
    expect(drawingVisibleTo({ ...d, visible: false }, { role: "player" }, "s1")).toBe(false);
  });
});
