/**
 * Pinos no mapa (docs/plano-narracao.md): unifica o antigo handout:pin/unpin com o pino de nota.
 * `kind: "handout"` no payload de criação vira um pino "image"/"text" (cópia denormalizada do
 * Handout); `kind: "note"` cria um pino com o conteúdo direto. Só o GM cria/edita/apaga. Broadcast
 * segue a regra de mapa de sempre (GM sempre recebe; jogador só se `visible` e `sceneId` é o mapa
 * ATIVO da sala) — entra no desfazer do GM, mesmo mecanismo de handout:pin/unpin de antes.
 */
import { PinCreateSchema, PinRemoveSchema, PinUpdateSchema, type Pin } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { buildHandoutCard, requireHandout, toHandout } from "../services/handouts.js";
import { pushEntry, type HistoryEntry } from "../services/history.js";
import { requirePin, toPin } from "../services/pins.js";
import { isActiveScene } from "../services/visibility.js";
import { guarded, HandlerError } from "./ack.js";
import { emitHistoryUpdated } from "./history.js";
import { requireScene } from "./scene.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

const gmOnly = { gmOnly: true };

/** Broadcast de mapa de sempre: GM recebe qualquer pino; jogador só se `visible` e o mapa é o ATIVO. */
export function emitPinCreated(io: TypedServer, roomId: string, sceneId: string, pin: Pin, visibleToPlayers: boolean): void {
  io.to(rooms.gm(roomId)).emit("pin:created", { sceneId, pin });
  if (visibleToPlayers) io.to(rooms.players(roomId)).emit("pin:created", { sceneId, pin });
}

export function emitPinUpdated(io: TypedServer, roomId: string, sceneId: string, pin: Pin, visibleToPlayers: boolean): void {
  io.to(rooms.gm(roomId)).emit("pin:updated", { sceneId, pin });
  if (visibleToPlayers) io.to(rooms.players(roomId)).emit("pin:updated", { sceneId, pin });
}

export function emitPinRemoved(io: TypedServer, roomId: string, sceneId: string, pinId: string, notifyPlayers: boolean): void {
  io.to(rooms.gm(roomId)).emit("pin:removed", { sceneId, pinId });
  if (notifyPlayers) io.to(rooms.players(roomId)).emit("pin:removed", { sceneId, pinId });
}

/**
 * Alterna `deletedAt` de um pino já existente (fixar de novo / apagar) e reemite. Usado nos dois
 * sentidos do histórico de `pin:create` e `pin:remove` — só a direção do `summary`/`revert`/`apply`
 * muda entre os dois (ver builders abaixo). Restaurar (revert de um apagar) reemite como
 * `pin:created` — mesmo padrão de `broadcastToken`/token:updated pra restauração: o cliente faz
 * upsert por id, então o nome do evento importa menos que o conteúdo.
 */
export async function setPinDeleted(io: TypedServer, roomId: string, sceneId: string, pin: Pin, deleted: boolean): Promise<void> {
  const row = await prisma.pin.findUnique({ where: { id: pin.id } });
  const label = pin.kind === "note" ? pin.title : pin.name;
  if (!row) throw new Error(`o pino de "${label}" não existe mais`);
  if (deleted === (row.deletedAt !== null)) throw new Error(deleted ? `o pino de "${label}" já está apagado` : `o pino de "${label}" já existe`);
  await prisma.pin.update({ where: { id: pin.id }, data: { deletedAt: deleted ? new Date() : null } });
  const activeNow = await isActiveScene(roomId, sceneId);
  if (deleted) emitPinRemoved(io, roomId, sceneId, pin.id, activeNow);
  else emitPinCreated(io, roomId, sceneId, pin, activeNow);
}

/** `pin:create`: revert apaga o pino recém-criado, apply refaz (redo). */
function buildPinCreateHistoryEntry(io: TypedServer, roomId: string, sceneId: string, pin: Pin): HistoryEntry {
  const label = pin.kind === "note" ? pin.title : pin.name;
  return {
    summary: `fixar pino "${label}"`,
    revert: () => setPinDeleted(io, roomId, sceneId, pin, true),
    apply: () => setPinDeleted(io, roomId, sceneId, pin, false),
  };
}

/** `pin:remove`: revert restaura o pino apagado, apply apaga de novo (redo). */
function buildPinRemoveHistoryEntry(io: TypedServer, roomId: string, sceneId: string, pin: Pin): HistoryEntry {
  const label = pin.kind === "note" ? pin.title : pin.name;
  return {
    summary: `apagar pino "${label}"`,
    revert: () => setPinDeleted(io, roomId, sceneId, pin, false),
    apply: () => setPinDeleted(io, roomId, sceneId, pin, true),
  };
}

/** `pin:update` (só nota): revert/apply trocam o patch aplicado — mesmo padrão de
 *  `buildUpdateHistoryEntry` do token (docs/plano-desfazer.md §3), só um campo por vez aqui. */
function buildPinUpdateHistoryEntry(io: TypedServer, roomId: string, sceneId: string, pinId: string, title: string, before: Pin, after: Pin): HistoryEntry {
  return {
    summary: `editar pino "${title}"`,
    async revert() {
      await writeNotePin(io, roomId, sceneId, pinId, before);
    },
    async apply() {
      await writeNotePin(io, roomId, sceneId, pinId, after);
    },
  };
}

async function writeNotePin(io: TypedServer, roomId: string, sceneId: string, pinId: string, state: Pin): Promise<void> {
  if (state.kind !== "note") return; // nunca deveria acontecer (pin:update só aceita nota)
  const row = await prisma.pin.findUnique({ where: { id: pinId } });
  if (!row || row.deletedAt !== null) throw new Error(`o pino "${state.title}" não existe mais`);
  const updated = toPin(
    await prisma.pin.update({
      where: { id: pinId },
      data: { name: state.title, text: state.text, icon: state.icon ?? null, color: state.color ?? null, visible: state.visible },
    }),
  );
  const activeNow = await isActiveScene(roomId, sceneId);
  emitPinUpdated(io, roomId, sceneId, updated, updated.visible && activeNow);
}

export function registerPinHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "pin:create",
    guarded(
      socket,
      PinCreateSchema,
      async (data, ctx) => {
        await requireScene(data.sceneId, ctx.roomId);

        let row;
        if (data.kind === "handout") {
          const handout = toHandout(await requireHandout(data.handoutId, ctx.roomId));
          const card = buildHandoutCard(handout);
          row = await prisma.pin.create({
            data: {
              sceneId: data.sceneId,
              x: data.x,
              y: data.y,
              visible: data.visible,
              kind: card.kind,
              handoutId: card.handoutId,
              name: card.name,
              imageUrl: card.kind === "image" ? card.imageUrl : null,
              width: card.kind === "image" ? card.width : null,
              height: card.kind === "image" ? card.height : null,
              text: card.kind === "text" ? card.text : null,
            },
          });
        } else {
          row = await prisma.pin.create({
            data: {
              sceneId: data.sceneId,
              x: data.x,
              y: data.y,
              visible: data.visible,
              kind: "note",
              name: data.title,
              text: data.text,
              icon: data.icon ?? null,
              color: data.color ?? null,
            },
          });
        }

        const pin = toPin(row);
        const activeNow = await isActiveScene(ctx.roomId, data.sceneId);
        emitPinCreated(io, ctx.roomId, data.sceneId, pin, pin.visible && activeNow);

        pushEntry(ctx.roomId, buildPinCreateHistoryEntry(io, ctx.roomId, data.sceneId, pin));
        emitHistoryUpdated(io, ctx.roomId);
        return pin;
      },
      gmOnly,
    ),
  );

  socket.on(
    "pin:update",
    guarded(
      socket,
      PinUpdateSchema,
      async ({ sceneId, pinId, patch }, ctx) => {
        await requireScene(sceneId, ctx.roomId);
        const row = await requirePin(pinId, sceneId);
        const before = toPin(row);
        if (before.kind !== "note") throw new HandlerError('Só um pino de nota pode ser editado no lugar — apague e fixe o handout de novo');

        const updated = toPin(
          await prisma.pin.update({
            where: { id: pinId },
            data: {
              name: patch.title ?? before.title,
              text: patch.text ?? before.text,
              icon: patch.icon !== undefined ? patch.icon : before.icon ?? null,
              color: patch.color !== undefined ? patch.color : before.color ?? null,
              visible: patch.visible ?? before.visible,
            },
          }),
        );
        const activeNow = await isActiveScene(ctx.roomId, sceneId);
        emitPinUpdated(io, ctx.roomId, sceneId, updated, updated.visible && activeNow);

        pushEntry(ctx.roomId, buildPinUpdateHistoryEntry(io, ctx.roomId, sceneId, pinId, before.title, before, updated));
        emitHistoryUpdated(io, ctx.roomId);
        return updated;
      },
      gmOnly,
    ),
  );

  socket.on(
    "pin:remove",
    guarded(
      socket,
      PinRemoveSchema,
      async ({ sceneId, pinId }, ctx) => {
        await requireScene(sceneId, ctx.roomId);
        const row = await requirePin(pinId, sceneId);
        const pin = toPin(row);

        await prisma.pin.update({ where: { id: pinId }, data: { deletedAt: new Date() } });
        const activeNow = await isActiveScene(ctx.roomId, sceneId);
        emitPinRemoved(io, ctx.roomId, sceneId, pinId, pin.visible && activeNow);

        pushEntry(ctx.roomId, buildPinRemoveHistoryEntry(io, ctx.roomId, sceneId, pin));
        emitHistoryUpdated(io, ctx.roomId);
      },
      gmOnly,
    ),
  );
}
