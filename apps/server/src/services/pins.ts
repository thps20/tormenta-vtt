/**
 * Pinos no mapa (docs/plano-narracao.md): unifica o antigo HandoutPin (kind "image"/"text") com o
 * pino de nota (kind "note"). Mesmo espírito de services/characters.ts — linha do Prisma -> tipo
 * do shared, passando pelo Zod na saída.
 */
import type { Pin as DbPin } from "@prisma/client";
import { PinSchema, type Pin } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { HandlerError } from "../socket/ack.js";

export function toPin(row: DbPin): Pin {
  return PinSchema.parse({
    id: row.id,
    sceneId: row.sceneId,
    kind: row.kind,
    handoutId: row.handoutId ?? undefined,
    x: row.x,
    y: row.y,
    visible: row.visible,
    name: row.name ?? undefined,
    imageUrl: row.imageUrl ?? undefined,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    text: row.text ?? undefined,
    icon: row.icon ?? undefined,
    color: row.color ?? undefined,
  });
}

/**
 * Quem pode ver um pino: GM sempre; jogador só se `visible` (mesma regra de Token.visible — sem
 * névoa aqui, um pino não tem "centro escondido", é um ícone fixo do GM). `activeSceneId` decide
 * se o mapa do pino é o que a mesa vê agora (regra de broadcast de mapa de sempre).
 */
export function pinVisibleTo(pin: Pin, viewer: { role: "gm" | "player" }, activeSceneId: string | null): boolean {
  if (viewer.role === "gm") return true;
  return pin.visible && pin.sceneId === activeSceneId;
}

/** Carrega o pino e confirma que é desta cena e não está apagado. */
export async function requirePin(pinId: string, sceneId: string): Promise<DbPin> {
  const row = await prisma.pin.findUnique({ where: { id: pinId } });
  if (!row || row.sceneId !== sceneId || row.deletedAt !== null) throw new HandlerError("Pino não encontrado");
  return row;
}
