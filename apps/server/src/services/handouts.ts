/**
 * Handouts (docs/SPEC.md §9.10): biblioteca por sala. Pino no mapa mudou pra services/pins.ts
 * (docs/plano-narracao.md, unificado com pino de nota). Mesmo espírito de services/characters.ts
 * — linha do Prisma -> tipo do shared, passando pelo Zod na saída.
 */
import type { Handout as DbHandout } from "@prisma/client";
import { HandoutSchema, type Handout, type HandoutCard } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { HandlerError } from "../socket/ack.js";

export function toHandout(row: DbHandout): Handout {
  return HandoutSchema.parse({
    id: row.id,
    roomId: row.roomId,
    name: row.name,
    kind: row.kind,
    imageUrl: row.imageUrl ?? undefined,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    text: row.text ?? undefined,
    tags: row.tags,
    createdAt: row.createdAt.toISOString(),
  });
}

/** Cópia denormalizada de um Handout, pronta pra embutir em ChatMessage.handout ou num pino novo. */
export function buildHandoutCard(handout: Handout): HandoutCard {
  return handout.kind === "image"
    ? { handoutId: handout.id, name: handout.name, kind: "image", imageUrl: handout.imageUrl, width: handout.width, height: handout.height }
    : { handoutId: handout.id, name: handout.name, kind: "text", text: handout.text };
}

/** Carrega o handout e confirma que é desta sala e não está apagado. */
export async function requireHandout(handoutId: string, roomId: string): Promise<DbHandout> {
  const row = await prisma.handout.findUnique({ where: { id: handoutId } });
  if (!row || row.roomId !== roomId || row.deletedAt !== null) throw new HandlerError("Handout não encontrado");
  return row;
}
