import { describe, expect, it } from "vitest";
import type { FogConfig, FogShape } from "../schemas/fog.js";
import { FogConfigSchema, FogShapeSchema } from "../schemas/fog.js";
import { distanceToPolyline, isPointRevealed, pointInPolygon, shapeContains, tokenCenter } from "./visibility.js";

const fog = (shapes: FogShape[], base: FogConfig["base"] = "hidden", enabled = true): FogConfig => ({ enabled, base, shapes });
const circle = (mode: FogShape["mode"], cx: number, cy: number, r: number): FogShape => ({ id: "c", mode, kind: "circle", cx, cy, r });
const rect = (mode: FogShape["mode"], x: number, y: number, w: number, h: number): FogShape => ({ id: "r", mode, kind: "rect", x, y, width: w, height: h });

describe("isPointRevealed", () => {
  it("fog desligado revela tudo, mesmo com base hidden", () => {
    expect(isPointRevealed(fog([], "hidden", false), { x: 0, y: 0 })).toBe(true);
  });

  it("sem shapes, vale a base", () => {
    expect(isPointRevealed(fog([], "hidden"), { x: 10, y: 10 })).toBe(false);
    expect(isPointRevealed(fog([], "revealed"), { x: 10, y: 10 })).toBe(true);
  });

  it("a última shape que contém o ponto decide", () => {
    const f = fog([rect("reveal", 0, 0, 100, 100), circle("hide", 50, 50, 10)]);
    expect(isPointRevealed(f, { x: 50, y: 50 })).toBe(false); // dentro do hide
    expect(isPointRevealed(f, { x: 80, y: 80 })).toBe(true); // só no reveal
    expect(isPointRevealed(f, { x: 200, y: 200 })).toBe(false); // fora de tudo: base
    // Ordem inversa: reveal por cima do hide.
    const g = fog([circle("hide", 50, 50, 10), rect("reveal", 0, 0, 100, 100)]);
    expect(isPointRevealed(g, { x: 50, y: 50 })).toBe(true);
  });
});

describe("shapeContains", () => {
  it("círculo inclui a borda", () => {
    expect(shapeContains(circle("reveal", 0, 0, 10), { x: 10, y: 0 })).toBe(true);
    expect(shapeContains(circle("reveal", 0, 0, 10), { x: 10.01, y: 0 })).toBe(false);
  });

  it("polígono côncavo (L) e pontos fora", () => {
    // L: (0,0)-(20,0)-(20,10)-(10,10)-(10,20)-(0,20)
    const points = [0, 0, 20, 0, 20, 10, 10, 10, 10, 20, 0, 20];
    expect(pointInPolygon(points, { x: 5, y: 5 })).toBe(true);
    expect(pointInPolygon(points, { x: 15, y: 5 })).toBe(true);
    expect(pointInPolygon(points, { x: 15, y: 15 })).toBe(false); // o "canto" faltando do L
    expect(pointInPolygon(points, { x: -1, y: 5 })).toBe(false);
  });

  it("stroke: distância até a polilinha com pontas redondas", () => {
    const stroke: FogShape = { id: "s", mode: "reveal", kind: "stroke", points: [0, 0, 100, 0], width: 20 };
    expect(shapeContains(stroke, { x: 50, y: 9 })).toBe(true);
    expect(shapeContains(stroke, { x: 50, y: 11 })).toBe(false);
    expect(shapeContains(stroke, { x: 108, y: 0 })).toBe(true); // ponta redonda
    expect(shapeContains(stroke, { x: 112, y: 0 })).toBe(false);
    expect(distanceToPolyline([0, 0, 0, 0], { x: 3, y: 4 })).toBe(5); // segmento degenerado
  });
});

describe("tokenCenter", () => {
  it("centro a partir do canto superior esquerdo (1 célula)", () => {
    expect(tokenCenter({ x: 10, y: 20, cells: 1 }, 70)).toEqual({ x: 45, y: 55 });
  });

  it("token 2x2: meio lado é cells × cellSize / 2", () => {
    expect(tokenCenter({ x: 0, y: 0, cells: 2 }, 70)).toEqual({ x: 70, y: 70 });
  });
});

describe("schemas", () => {
  it("FogConfigSchema preenche defaults", () => {
    expect(FogConfigSchema.parse({})).toEqual({ enabled: false, base: "hidden", shapes: [] });
  });

  it("rejeita lista de pontos ímpar ou polígono com menos de 3 vértices", () => {
    expect(FogShapeSchema.safeParse({ id: "a", mode: "reveal", kind: "polygon", points: [0, 0, 1, 1, 2] }).success).toBe(false);
    expect(FogShapeSchema.safeParse({ id: "a", mode: "reveal", kind: "polygon", points: [0, 0, 1, 1] }).success).toBe(false);
    expect(FogShapeSchema.safeParse({ id: "a", mode: "reveal", kind: "polygon", points: [0, 0, 1, 1, 0, 1] }).success).toBe(true);
  });
});
