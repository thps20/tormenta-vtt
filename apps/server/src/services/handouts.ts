/**
 * Handouts (docs/SPEC.md §9.10): biblioteca por sala + pinos no mapa. Mesmo espírito de
 * services/characters.ts — linha do Prisma -> tipo do shared, passando pelo Zod na saída.
 */
import type { Handout as DbHandout, HandoutPin as DbHandoutPin } from "@prisma/client";
import { HandoutPinSchema, HandoutSchema, type Handout, type HandoutCard, type HandoutPin } from "@tormenta-vtt/shared";
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

export function toHandoutPin(row: DbHandoutPin): HandoutPin {
  return HandoutPinSchema.parse({
    id: row.id,
    sceneId: row.sceneId,
    handoutId: row.handoutId,
    x: row.x,
    y: row.y,
    visible: row.visible,
    name: row.name,
    kind: row.kind,
    imageUrl: row.imageUrl ?? undefined,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    text: row.text ?? undefined,
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

/**
 * Quem pode ver um pino: GM sempre; jogador só se `visible` (mesma regra de Token.visible — sem
 * névoa aqui, um pino não tem "centro escondido", é um ícone fixo do GM). `activeSceneId` decide
 * se o mapa do pino é o que a mesa vê agora (regra de broadcast de mapa de sempre).
 */
export function handoutPinVisibleTo(pin: HandoutPin, viewer: { role: "gm" | "player" }, activeSceneId: string | null): boolean {
  if (viewer.role === "gm") return true;
  return pin.visible && pin.sceneId === activeSceneId;
}
