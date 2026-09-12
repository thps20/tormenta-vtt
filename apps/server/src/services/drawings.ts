/**
 * Traços de desenho livre no mapa (docs/SPEC.md §9.17). Mesmo espírito de services/pins.ts: linha
 * do Prisma -> tipo do shared, passando pelo Zod na saída; só os campos do `kind` atual da linha
 * viram parte do objeto (os demais ficam `null`/`[]` no banco e são ignorados aqui).
 */
import type { Drawing as DbDrawing } from "@prisma/client";
import { DrawingSchema, type Drawing } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { HandlerError } from "../socket/ack.js";

/** Linha do Prisma -> `Drawing` do shared, montando só os campos do `kind` da linha. */
export function toDrawing(row: DbDrawing): Drawing {
  const base = {
    id: row.id,
    sceneId: row.sceneId,
    ownerId: row.ownerId,
    color: row.color,
    strokeWidth: row.strokeWidth,
    visible: row.visible,
  };
  switch (row.kind) {
    case "pen":
      return DrawingSchema.parse({ ...base, kind: "pen", points: row.points });
    case "line":
      return DrawingSchema.parse({ ...base, kind: "line", x1: row.x1, y1: row.y1, x2: row.x2, y2: row.y2 });
    case "arrow":
      return DrawingSchema.parse({ ...base, kind: "arrow", x1: row.x1, y1: row.y1, x2: row.x2, y2: row.y2 });
    case "rect":
      return DrawingSchema.parse({ ...base, kind: "rect", x: row.x, y: row.y, width: row.width, height: row.height, filled: row.filled });
    case "ellipse":
      return DrawingSchema.parse({ ...base, kind: "ellipse", cx: row.cx, cy: row.cy, rx: row.rx, ry: row.ry, filled: row.filled });
    case "text":
      return DrawingSchema.parse({ ...base, kind: "text", x: row.x, y: row.y, text: row.text });
    default:
      throw new Error(`kind de desenho desconhecido: "${row.kind}"`);
  }
}

/**
 * Mesma conversão, mas nunca derruba quem chama: um traço com dado inconsistente (linha antiga,
 * edição manual no banco, migration futura incompleta...) é IGNORADO (aviso no log), nunca joga a
 * exceção pra cima. Usada em qualquer lugar que lista traços JÁ EXISTENTES pra um viewer (snapshot
 * da sala, `scene:enter`) — mesmo padrão de `toPinSafe`.
 */
export function toDrawingSafe(row: DbDrawing): Drawing | null {
  try {
    return toDrawing(row);
  } catch (err) {
    console.warn(`[drawings] traço "${row.id}" (kind="${row.kind}") com dados inconsistentes, ignorado no snapshot:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Carrega o traço e confirma que é desta cena e não está apagado. */
export async function requireDrawing(drawingId: string, sceneId: string): Promise<DbDrawing> {
  const row = await prisma.drawing.findUnique({ where: { id: drawingId } });
  if (!row || row.sceneId !== sceneId || row.deletedAt !== null) throw new HandlerError("Traço não encontrado");
  return row;
}
