/**
 * Pinos no mapa (docs/plano-narracao.md): unifica o antigo HandoutPin (kind "image"/"text") com o
 * pino de nota (kind "note"). Mesmo espírito de services/characters.ts — linha do Prisma -> tipo
 * do shared, passando pelo Zod na saída.
 */
import type { Pin as DbPin } from "@prisma/client";
import { PinSchema, type Pin } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { HandlerError } from "../socket/ack.js";

/**
 * Linha do Prisma -> `Pin` do shared. `name` é a coluna física dos dois mundos, mas o SCHEMA chama
 * o campo diferente por `kind`: `HandoutCardBaseSchema.name` pra pino de handout ("image"/"text"),
 * `title` pra pino de nota (achado num bug real: passar `name` pros dois fazia `PinSchema` cair no
 * ramo "note" sem `title`, e o pino de handout — que TEM `name` — quebrava com "title Required").
 * Por isso o `kind` decide qual dos dois recebe `row.name` — nunca os dois ao mesmo tempo.
 */
export function toPin(row: DbPin): Pin {
  if (row.kind === "note") {
    return PinSchema.parse({
      id: row.id,
      sceneId: row.sceneId,
      kind: "note",
      x: row.x,
      y: row.y,
      visible: row.visible,
      title: row.name ?? undefined,
      text: row.text ?? undefined,
      icon: row.icon ?? undefined,
      color: row.color ?? undefined,
    });
  }
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
  });
}

/**
 * Mesma conversão, mas nunca derruba quem chama: um pino com dado inconsistente (linha antiga de
 * antes de um bug de mapeamento, edição manual no banco, migration futura incompleta...) é
 * IGNORADO (com aviso no log), nunca joga a exceção pra cima. Usada em qualquer lugar que lista
 * pinos JÁ EXISTENTES pra um viewer (snapshot da sala, `scene:enter`) — ao contrário de
 * `pin:create`/`pin:update`, que acabaram de escrever a linha e esperam que ela seja válida (erro
 * ali é um bug de verdade, deve estourar).
 */
export function toPinSafe(row: DbPin): Pin | null {
  try {
    return toPin(row);
  } catch (err) {
    console.warn(`[pins] pino "${row.id}" (kind="${row.kind}") com dados inconsistentes, ignorado no snapshot:`, err instanceof Error ? err.message : err);
    return null;
  }
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
