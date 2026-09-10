/**
 * Handouts (docs/SPEC.md §9.10): biblioteca de imagem/texto por sala que o GM mostra pros
 * jogadores (overlay em tela cheia + card no chat) ou fixa no mapa como um pino. Só o GM: cria,
 * edita, apaga, lista, mostra, fecha e (des)fixa — tudo `gmOnly`. Biblioteca (create/update/
 * delete/list) só vai pra sala do GM (`rooms.gm`); pino segue a regra de broadcast de mapa de
 * sempre (GM sempre recebe; jogador só se `visible` e `sceneId` é o mapa ATIVO da sala).
 */
import {
  EmptySchema,
  HandoutCloseSchema,
  HandoutCreateSchema,
  HandoutDeleteSchema,
  HandoutPinCreateSchema,
  HandoutShowSchema,
  HandoutUnpinSchema,
  HandoutUpdateSchema,
  type HandoutPin,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { emitChatMessage } from "../services/chatVisibility.js";
import { buildHandoutCard, requireHandout, toHandout, toHandoutPin } from "../services/handouts.js";
import { pushEntry, type HistoryEntry } from "../services/history.js";
import { toChatMessage } from "../services/serialize.js";
import { isActiveScene } from "../services/visibility.js";
import { guarded, HandlerError } from "./ack.js";
import { emitHistoryUpdated } from "./history.js";
import { requireScene } from "./scene.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

const gmOnly = { gmOnly: true };

/** Broadcast de mapa de sempre: GM recebe qualquer pino; jogador só se `visible` e o mapa é o ATIVO. */
function emitPinned(io: TypedServer, roomId: string, sceneId: string, pin: HandoutPin, visibleToPlayers: boolean): void {
  io.to(rooms.gm(roomId)).emit("handout:pinned", { sceneId, pin });
  if (visibleToPlayers) io.to(rooms.players(roomId)).emit("handout:pinned", { sceneId, pin });
}

function emitUnpinned(io: TypedServer, roomId: string, sceneId: string, pinId: string, notifyPlayers: boolean): void {
  io.to(rooms.gm(roomId)).emit("handout:unpinned", { sceneId, pinId });
  if (notifyPlayers) io.to(rooms.players(roomId)).emit("handout:unpinned", { sceneId, pinId });
}

/**
 * Alterna `deletedAt` de um pino já existente (fixar de novo / apagar) e reemite. Usado nos dois
 * sentidos do histórico de `handout:pin` (criar) e `handout:unpin` (apagar) — só a direção do
 * `summary`/`revert`/`apply` muda entre os dois (ver builders abaixo).
 */
async function setPinDeleted(io: TypedServer, roomId: string, sceneId: string, pin: HandoutPin, deleted: boolean): Promise<void> {
  const row = await prisma.handoutPin.findUnique({ where: { id: pin.id } });
  if (!row) throw new Error(`o pino de "${pin.name}" não existe mais`);
  if (deleted === (row.deletedAt !== null)) throw new Error(deleted ? `o pino de "${pin.name}" já está apagado` : `o pino de "${pin.name}" já existe`);
  await prisma.handoutPin.update({ where: { id: pin.id }, data: { deletedAt: deleted ? new Date() : null } });
  const activeNow = await isActiveScene(roomId, sceneId);
  if (deleted) emitUnpinned(io, roomId, sceneId, pin.id, activeNow);
  else emitPinned(io, roomId, sceneId, pin, activeNow);
}

/** `handout:pin`: revert apaga o pino recém-criado, apply refaz (redo). */
function buildPinCreateHistoryEntry(io: TypedServer, roomId: string, sceneId: string, pin: HandoutPin): HistoryEntry {
  return {
    summary: `fixar handout "${pin.name}"`,
    revert: () => setPinDeleted(io, roomId, sceneId, pin, true),
    apply: () => setPinDeleted(io, roomId, sceneId, pin, false),
  };
}

/** `handout:unpin`: revert restaura o pino apagado, apply apaga de novo (redo). */
function buildPinRemoveHistoryEntry(io: TypedServer, roomId: string, sceneId: string, pin: HandoutPin): HistoryEntry {
  return {
    summary: `apagar pino de "${pin.name}"`,
    revert: () => setPinDeleted(io, roomId, sceneId, pin, false),
    apply: () => setPinDeleted(io, roomId, sceneId, pin, true),
  };
}

/**
 * `handout:delete`: soft delete do handout E de todo pino dele em qualquer mapa (uma entrada de
 * desfazer só — mesmo espírito de "apagar a ficha desvincula os tokens", §3.6). `pins` já veio
 * carregado (não apagado) de ANTES da transação, pro revert saber quais restaurar.
 */
function buildHandoutDeleteHistoryEntry(io: TypedServer, roomId: string, handoutId: string, handoutName: string, pins: HandoutPin[]): HistoryEntry {
  return {
    summary: `apagar handout "${handoutName}"`,
    async revert() {
      const row = await prisma.handout.findUnique({ where: { id: handoutId } });
      if (!row || row.deletedAt === null) throw new Error(`o handout "${handoutName}" não está mais apagado`);
      const handout = toHandout(await prisma.handout.update({ where: { id: handoutId }, data: { deletedAt: null } }));
      io.to(rooms.gm(roomId)).emit("handout:updated", handout);
      for (const pin of pins) {
        const pinRow = await prisma.handoutPin.findUnique({ where: { id: pin.id } });
        if (!pinRow || pinRow.deletedAt === null) continue; // não deveria acontecer; não trava o resto do lote
        await prisma.handoutPin.update({ where: { id: pin.id }, data: { deletedAt: null } });
        const activeNow = await isActiveScene(roomId, pin.sceneId);
        emitPinned(io, roomId, pin.sceneId, pin, activeNow);
      }
    },
    async apply() {
      const row = await prisma.handout.findUnique({ where: { id: handoutId } });
      if (!row || row.deletedAt !== null) throw new Error(`o handout "${handoutName}" não existe mais`);
      await prisma.handout.update({ where: { id: handoutId }, data: { deletedAt: new Date() } });
      io.to(rooms.gm(roomId)).emit("handout:deleted", { id: handoutId });
      for (const pin of pins) {
        const pinRow = await prisma.handoutPin.findUnique({ where: { id: pin.id } });
        if (!pinRow || pinRow.deletedAt !== null) continue;
        await prisma.handoutPin.update({ where: { id: pin.id }, data: { deletedAt: new Date() } });
        const activeNow = await isActiveScene(roomId, pin.sceneId);
        emitUnpinned(io, roomId, pin.sceneId, pin.id, activeNow);
      }
    },
  };
}

export function registerHandoutHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "handout:create",
    guarded(
      socket,
      HandoutCreateSchema,
      async (data, ctx) => {
        const handout = toHandout(
          await prisma.handout.create({
            data: {
              roomId: ctx.roomId,
              name: data.name,
              kind: data.kind,
              tags: data.tags,
              imageUrl: data.kind === "image" ? data.imageUrl : null,
              width: data.kind === "image" ? data.width : null,
              height: data.kind === "image" ? data.height : null,
              text: data.kind === "text" ? data.text : null,
            },
          }),
        );
        io.to(rooms.gm(ctx.roomId)).emit("handout:created", handout);
        return handout;
      },
      gmOnly,
    ),
  );

  socket.on(
    "handout:update",
    guarded(
      socket,
      HandoutUpdateSchema,
      async ({ id, patch }, ctx) => {
        await requireHandout(id, ctx.roomId);
        const handout = toHandout(await prisma.handout.update({ where: { id }, data: patch }));
        io.to(rooms.gm(ctx.roomId)).emit("handout:updated", handout);
        return handout;
      },
      gmOnly,
    ),
  );

  socket.on(
    "handout:delete",
    guarded(
      socket,
      HandoutDeleteSchema,
      async ({ id }, ctx) => {
        const row = await requireHandout(id, ctx.roomId);
        const pinRows = await prisma.handoutPin.findMany({ where: { handoutId: id, deletedAt: null } });
        const pins = pinRows.map(toHandoutPin);

        await prisma.$transaction([
          prisma.handout.update({ where: { id }, data: { deletedAt: new Date() } }),
          ...pinRows.map((p) => prisma.handoutPin.update({ where: { id: p.id }, data: { deletedAt: new Date() } })),
        ]);

        io.to(rooms.gm(ctx.roomId)).emit("handout:deleted", { id });
        for (const pin of pins) {
          const activeNow = await isActiveScene(ctx.roomId, pin.sceneId);
          emitUnpinned(io, ctx.roomId, pin.sceneId, pin.id, activeNow);
        }

        pushEntry(ctx.roomId, buildHandoutDeleteHistoryEntry(io, ctx.roomId, id, row.name, pins));
        emitHistoryUpdated(io, ctx.roomId);
      },
      gmOnly,
    ),
  );

  socket.on(
    "handout:list",
    guarded(
      socket,
      EmptySchema,
      async (_input, ctx) => {
        const rows = await prisma.handout.findMany({ where: { roomId: ctx.roomId, deletedAt: null }, orderBy: { createdAt: "asc" } });
        return { items: rows.map(toHandout) };
      },
      gmOnly,
    ),
  );

  socket.on(
    "handout:show",
    guarded(
      socket,
      HandoutShowSchema,
      async ({ id, target }, ctx) => {
        const row = await requireHandout(id, ctx.roomId);
        const card = buildHandoutCard(toHandout(row));
        const me = await prisma.participant.findUnique({ where: { id: ctx.participantId } });
        if (!me) throw new HandlerError("Participante não encontrado");
        if (target !== "all") {
          const targetRow = await prisma.participant.findUnique({ where: { id: target.participantId } });
          if (!targetRow || targetRow.roomId !== ctx.roomId || targetRow.role !== "player") throw new HandlerError("Jogador inválido");
        }
        const msg = toChatMessage(
          await prisma.chatMessage.create({
            data: {
              roomId: ctx.roomId,
              participantId: me.id,
              nickname: me.nickname,
              kind: "handout",
              handout: card,
              visibility: "all",
              whisperTo: target === "all" ? null : target.participantId,
            },
          }),
        );
        await emitChatMessage(io, ctx.roomId, msg);
      },
      gmOnly,
    ),
  );

  socket.on(
    "handout:close",
    guarded(
      socket,
      HandoutCloseSchema,
      async ({ messageId }, ctx) => {
        const row = await prisma.chatMessage.findUnique({ where: { id: messageId } });
        if (!row || row.roomId !== ctx.roomId || row.kind !== "handout") throw new HandlerError("Mensagem não encontrada");
        // Mesmo público que a mensagem original (regra 3 de chatVisibility.ts): sem sussurro, todo
        // mundo; com sussurro, só o GM (já recebe por estar em rooms.all) e o alvo.
        const exceptRooms = row.whisperTo
          ? (await prisma.participant.findMany({ where: { roomId: ctx.roomId, role: "player" } }))
              .filter((p) => p.id !== row.whisperTo)
              .map((p) => rooms.participant(p.id))
          : [];
        const target = exceptRooms.length ? io.to(rooms.all(ctx.roomId)).except(exceptRooms) : io.to(rooms.all(ctx.roomId));
        target.emit("handout:closed", { messageId });
      },
      gmOnly,
    ),
  );

  socket.on(
    "handout:pin",
    guarded(
      socket,
      HandoutPinCreateSchema,
      async ({ sceneId, handoutId, x, y, visible }, ctx) => {
        await requireScene(sceneId, ctx.roomId);
        const handout = toHandout(await requireHandout(handoutId, ctx.roomId));
        const card = buildHandoutCard(handout);
        const row = await prisma.handoutPin.create({
          data: {
            sceneId,
            handoutId,
            x,
            y,
            visible,
            name: card.name,
            kind: card.kind,
            imageUrl: card.kind === "image" ? card.imageUrl : null,
            width: card.kind === "image" ? card.width : null,
            height: card.kind === "image" ? card.height : null,
            text: card.kind === "text" ? card.text : null,
          },
        });
        const pin = toHandoutPin(row);
        const activeNow = await isActiveScene(ctx.roomId, sceneId);
        emitPinned(io, ctx.roomId, sceneId, pin, visible && activeNow);

        pushEntry(ctx.roomId, buildPinCreateHistoryEntry(io, ctx.roomId, sceneId, pin));
        emitHistoryUpdated(io, ctx.roomId);
        return pin;
      },
      gmOnly,
    ),
  );

  socket.on(
    "handout:unpin",
    guarded(
      socket,
      HandoutUnpinSchema,
      async ({ sceneId, pinId }, ctx) => {
        const row = await prisma.handoutPin.findUnique({ where: { id: pinId } });
        if (!row || row.sceneId !== sceneId || row.deletedAt !== null) throw new HandlerError("Pino não encontrado");
        await requireScene(sceneId, ctx.roomId);
        const pin = toHandoutPin(row);

        await prisma.handoutPin.update({ where: { id: pinId }, data: { deletedAt: new Date() } });
        const activeNow = await isActiveScene(ctx.roomId, sceneId);
        emitUnpinned(io, ctx.roomId, sceneId, pinId, pin.visible && activeNow);

        pushEntry(ctx.roomId, buildPinRemoveHistoryEntry(io, ctx.roomId, sceneId, pin));
        emitHistoryUpdated(io, ctx.roomId);
      },
      gmOnly,
    ),
  );
}
