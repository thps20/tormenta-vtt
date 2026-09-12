/**
 * Handouts (docs/SPEC.md §9.10): biblioteca de imagem/texto por sala que o GM mostra pros
 * jogadores (overlay em tela cheia + card no chat) ou fixa no mapa como um pino (socket/pins.ts,
 * docs/plano-narracao.md — unificado com pino de nota). Só o GM: cria, edita, apaga, lista, mostra,
 * fecha — tudo `gmOnly`. Biblioteca (create/update/delete/list) só vai pra sala do GM (`rooms.gm`).
 */
import { EmptySchema, HandoutCloseSchema, HandoutCreateSchema, HandoutDeleteSchema, HandoutShowSchema, HandoutUpdateSchema } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { emitChatMessage } from "../services/chatVisibility.js";
import { buildHandoutCard, requireHandout, toHandout } from "../services/handouts.js";
import { pushEntry, type HistoryEntry } from "../services/history.js";
import { toPin } from "../services/pins.js";
import { toChatMessage } from "../services/serialize.js";
import { isActiveScene } from "../services/visibility.js";
import { guarded, HandlerError } from "./ack.js";
import { emitHistoryUpdated } from "./history.js";
import { emitPinCreated, emitPinRemoved } from "./pins.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

const gmOnly = { gmOnly: true };

/**
 * `handout:delete`: soft delete do handout E de todo pino dele em qualquer mapa (uma entrada de
 * desfazer só — mesmo espírito de "apagar a ficha desvincula os tokens", §3.6). `pinIds` já veio
 * carregado (não apagado) de ANTES da transação, pro revert saber quais restaurar — os pinos em si
 * são recarregados a cada passo (`toPin`), então este builder não precisa do tipo `Pin` completo.
 */
function buildHandoutDeleteHistoryEntry(io: TypedServer, roomId: string, handoutId: string, handoutName: string, pinIds: string[]): HistoryEntry {
  return {
    summary: `apagar handout "${handoutName}"`,
    async revert() {
      const row = await prisma.handout.findUnique({ where: { id: handoutId } });
      if (!row || row.deletedAt === null) throw new Error(`o handout "${handoutName}" não está mais apagado`);
      const handout = toHandout(await prisma.handout.update({ where: { id: handoutId }, data: { deletedAt: null } }));
      io.to(rooms.gm(roomId)).emit("handout:updated", handout);
      for (const pinId of pinIds) {
        const pinRow = await prisma.pin.findUnique({ where: { id: pinId } });
        if (!pinRow || pinRow.deletedAt === null) continue; // não deveria acontecer; não trava o resto do lote
        const updated = toPin(await prisma.pin.update({ where: { id: pinId }, data: { deletedAt: null } }));
        const activeNow = await isActiveScene(roomId, updated.sceneId);
        emitPinCreated(io, roomId, updated.sceneId, updated, updated.visible && activeNow);
      }
    },
    async apply() {
      const row = await prisma.handout.findUnique({ where: { id: handoutId } });
      if (!row || row.deletedAt !== null) throw new Error(`o handout "${handoutName}" não existe mais`);
      await prisma.handout.update({ where: { id: handoutId }, data: { deletedAt: new Date() } });
      io.to(rooms.gm(roomId)).emit("handout:deleted", { id: handoutId });
      for (const pinId of pinIds) {
        const pinRow = await prisma.pin.findUnique({ where: { id: pinId } });
        if (!pinRow || pinRow.deletedAt !== null) continue;
        const before = toPin(pinRow);
        await prisma.pin.update({ where: { id: pinId }, data: { deletedAt: new Date() } });
        const activeNow = await isActiveScene(roomId, before.sceneId);
        emitPinRemoved(io, roomId, before.sceneId, pinId, before.visible && activeNow);
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
        const pinRows = await prisma.pin.findMany({ where: { handoutId: id, deletedAt: null } });
        const pins = pinRows.map(toPin);

        await prisma.$transaction([
          prisma.handout.update({ where: { id }, data: { deletedAt: new Date() } }),
          ...pinRows.map((p) => prisma.pin.update({ where: { id: p.id }, data: { deletedAt: new Date() } })),
        ]);

        io.to(rooms.gm(ctx.roomId)).emit("handout:deleted", { id });
        for (const pin of pins) {
          const activeNow = await isActiveScene(ctx.roomId, pin.sceneId);
          emitPinRemoved(io, ctx.roomId, pin.sceneId, pin.id, pin.visible && activeNow);
        }

        pushEntry(
          ctx.roomId,
          buildHandoutDeleteHistoryEntry(
            io,
            ctx.roomId,
            id,
            row.name,
            pins.map((p) => p.id),
          ),
        );
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
}
