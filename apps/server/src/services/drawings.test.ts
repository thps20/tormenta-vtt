import { describe, expect, it } from "vitest";
import type { Drawing as DbDrawing } from "@prisma/client";
import { toDrawing, toDrawingSafe } from "./drawings.js";

/** Linha de `Drawing` do Prisma com os defaults de uma coluna vazia (mesmo padrão de `pins.test.ts`
 *  — `Partial<DbDrawing>` sobrescreve só o que o caso precisa). */
const dbDrawingRow = (patch: Partial<DbDrawing> = {}): DbDrawing => ({
  id: "d1",
  sceneId: "s1",
  kind: "pen",
  ownerId: "gm1",
  color: "#ff0000",
  strokeWidth: 4,
  filled: false,
  visible: true,
  points: [],
  x1: null,
  y1: null,
  x2: null,
  y2: null,
  x: null,
  y: null,
  width: null,
  height: null,
  cx: null,
  cy: null,
  rx: null,
  ry: null,
  text: null,
  deletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  ...patch,
});

describe("toDrawing", () => {
  it("kind pen: usa a coluna points", () => {
    const row = dbDrawingRow({ kind: "pen", points: [0, 0, 10, 10] });
    expect(toDrawing(row)).toMatchObject({ kind: "pen", points: [0, 0, 10, 10] });
  });

  it("kind line/arrow: usa x1/y1/x2/y2", () => {
    const line = dbDrawingRow({ kind: "line", x1: 0, y1: 0, x2: 10, y2: 20 });
    expect(toDrawing(line)).toMatchObject({ kind: "line", x1: 0, y1: 0, x2: 10, y2: 20 });
    const arrow = dbDrawingRow({ kind: "arrow", x1: 1, y1: 2, x2: 3, y2: 4 });
    expect(toDrawing(arrow)).toMatchObject({ kind: "arrow", x1: 1, y1: 2, x2: 3, y2: 4 });
  });

  it("kind rect: usa x/y/width/height/filled", () => {
    const row = dbDrawingRow({ kind: "rect", x: 1, y: 2, width: 30, height: 40, filled: true });
    expect(toDrawing(row)).toMatchObject({ kind: "rect", x: 1, y: 2, width: 30, height: 40, filled: true });
  });

  it("kind ellipse: usa cx/cy/rx/ry", () => {
    const row = dbDrawingRow({ kind: "ellipse", cx: 5, cy: 6, rx: 7, ry: 8 });
    expect(toDrawing(row)).toMatchObject({ kind: "ellipse", cx: 5, cy: 6, rx: 7, ry: 8 });
  });

  it("kind text: usa x/y/text", () => {
    const row = dbDrawingRow({ kind: "text", x: 1, y: 2, text: "olá mundo" });
    expect(toDrawing(row)).toMatchObject({ kind: "text", x: 1, y: 2, text: "olá mundo" });
  });

  it("linha com dado inconsistente (campo obrigatório do kind faltando) lança", () => {
    const row = dbDrawingRow({ kind: "rect", x: null, y: 2, width: 10, height: 10 });
    expect(() => toDrawing(row)).toThrow();
  });

  it("kind desconhecido lança", () => {
    expect(() => toDrawing(dbDrawingRow({ kind: "invalido-qualquer" }))).toThrow();
  });
});

describe("toDrawingSafe", () => {
  it("traço válido: mesmo resultado de toDrawing", () => {
    const row = dbDrawingRow({ kind: "pen", points: [0, 0, 1, 1] });
    expect(toDrawingSafe(row)).toEqual(toDrawing(row));
  });

  it("traço com dado inconsistente: devolve null, não lança", () => {
    const row = dbDrawingRow({ kind: "rect", x: null, y: 2, width: 10, height: 10 });
    expect(() => toDrawingSafe(row)).not.toThrow();
    expect(toDrawingSafe(row)).toBeNull();
  });

  it("kind desconhecido: devolve null, não lança", () => {
    expect(toDrawingSafe(dbDrawingRow({ kind: "invalido-qualquer" }))).toBeNull();
  });
});
