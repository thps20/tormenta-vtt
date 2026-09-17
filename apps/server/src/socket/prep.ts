/**
 * Preparo do mapa (docs/plano-preparo.md §2): lista ordenada de passos por mapa, carregada sob
 * demanda (como as notas, socket/notes.ts) quando a aba "Preparo" abre. Tudo `gmOnly`, broadcast só
 * pra `rooms.gm` — mesmo desenho de socket/handout.ts.
 */
import { randomUUID } from "node:crypto";
import {
  PrepItemAddSchema,
  PrepItemMoveSchema,
  PrepItemRemoveSchema,
  PrepItemUpdateSchema,
  PrepListSchema,
  PrepResetSchema,
  PrepStepCopySchema,
  PrepStepCreateSchema,
  PrepStepDeleteSchema,
  PrepStepReorderSchema,
  PrepStepUpdateSchema,
  reorderPrepSteps,
  type PrepItem,
  type PrepStep,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { pushEntry, type HistoryEntry } from "../services/history.js";
import {
  loadPrepResetSnapshot,
  movePrepItem,
  prepItemsJson,
  prepItemsOf,
  requirePrepStep,
  resolveRefLabel,
  restorePrepUsed,
  toPrepStep,
  updatePrepItems,
  zeroPrepUsed,
  type PrepResetSnapshot,
} from "../services/prep.js";
import { guarded, HandlerError } from "./ack.js";
import { emitHistoryUpdated } from "./history.js";
import { requireScene } from "./scene.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

const gmOnly = { gmOnly: true };

/** `prep:step-delete`: soft delete + desfazer (mesmo padrão de buildHandoutDeleteHistoryEntry). */
function buildPrepStepDeleteHistoryEntry(io: TypedServer, roomId: string, sceneId: string, stepId: string, stepTitle: string): HistoryEntry {
  return {
    summary: `apagar passo "${stepTitle}"`,
    async revert() {
      const row = await prisma.prepStep.findUnique({ where: { id: stepId } });
      if (!row || row.deletedAt === null) throw new Error(`o passo "${stepTitle}" não está mais apagado`);
      const step = toPrepStep(await prisma.prepStep.update({ where: { id: stepId }, data: { deletedAt: null } }));
      io.to(rooms.gm(roomId)).emit("prep:stepUpserted", { sceneId, step });
    },
    async apply() {
      const row = await prisma.prepStep.findUnique({ where: { id: stepId } });
      if (!row || row.deletedAt !== null) throw new Error(`o passo "${stepTitle}" não existe mais`);
      await prisma.prepStep.update({ where: { id: stepId }, data: { deletedAt: new Date() } });
      io.to(rooms.gm(roomId)).emit("prep:stepRemoved", { sceneId, stepId });
    },
  };
}

/** `prep:item-remove`: desfazer restaura o item na mesma posição (§2.4). */
function buildPrepItemRemoveHistoryEntry(io: TypedServer, roomId: string, stepId: string, sceneId: string, item: PrepItem, index: number): HistoryEntry {
  return {
    summary: `remover "${item.label}" do passo`,
    async revert() {
      const step = await updatePrepItems(stepId, (items) => {
        const clamped = Math.max(0, Math.min(index, items.length));
        const copy = [...items];
        copy.splice(clamped, 0, item);
        return copy;
      });
      io.to(rooms.gm(roomId)).emit("prep:stepUpserted", { sceneId, step });
    },
    async apply() {
      const step = await updatePrepItems(stepId, (items) => items.filter((i) => i.id !== item.id));
      io.to(rooms.gm(roomId)).emit("prep:stepUpserted", { sceneId, step });
    },
  };
}

/** `prep:reset`: desfazer restaura os flags `used` de antes (§2.3 — "barato guardar os flags"). */
function buildPrepResetHistoryEntry(io: TypedServer, roomId: string, sceneId: string, sceneName: string, snapshot: PrepResetSnapshot[]): HistoryEntry {
  return {
    summary: `reiniciar preparo de "${sceneName}"`,
    async revert() {
      const steps = await restorePrepUsed(snapshot);
      for (const step of steps) io.to(rooms.gm(roomId)).emit("prep:stepUpserted", { sceneId, step });
    },
    async apply() {
      const steps = await zeroPrepUsed(snapshot);
      for (const step of steps) io.to(rooms.gm(roomId)).emit("prep:stepUpserted", { sceneId, step });
    },
  };
}

export function registerPrepHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "prep:list",
    guarded(
      socket,
      PrepListSchema,
      async ({ sceneId }, ctx) => {
        await requireScene(sceneId, ctx.roomId);
        const rows = await prisma.prepStep.findMany({ where: { sceneId, deletedAt: null }, orderBy: { order: "asc" } });
        return rows.map(toPrepStep);
      },
      gmOnly,
    ),
  );

  socket.on(
    "prep:step-create",
    guarded(
      socket,
      PrepStepCreateSchema,
      async ({ sceneId, title, afterStepId }, ctx) => {
        await requireScene(sceneId, ctx.roomId);
        const siblings = await prisma.prepStep.findMany({ where: { sceneId, deletedAt: null } });
        let insertOrder: number;
        if (afterStepId) {
          const after = siblings.find((s) => s.id === afterStepId);
          if (!after) throw new HandlerError("Passo de referência não encontrado");
          insertOrder = after.order + 1;
        } else {
          insertOrder = siblings.length > 0 ? Math.max(...siblings.map((s) => s.order)) + 1 : 0;
        }
        const created = await prisma.$transaction(async (tx) => {
          await tx.prepStep.updateMany({ where: { sceneId, deletedAt: null, order: { gte: insertOrder } }, data: { order: { increment: 1 } } });
          return tx.prepStep.create({ data: { sceneId, title, order: insertOrder } });
        });
        const step = toPrepStep(created);
        io.to(rooms.gm(ctx.roomId)).emit("prep:stepUpserted", { sceneId, step });
        return step;
      },
      gmOnly,
    ),
  );

  socket.on(
    "prep:step-update",
    guarded(
      socket,
      PrepStepUpdateSchema,
      async ({ stepId, patch }, ctx) => {
        const row = await requirePrepStep(stepId, ctx.roomId);
        const step = toPrepStep(await prisma.prepStep.update({ where: { id: stepId }, data: patch }));
        io.to(rooms.gm(ctx.roomId)).emit("prep:stepUpserted", { sceneId: row.sceneId, step });
        return step;
      },
      gmOnly,
    ),
  );

  socket.on(
    "prep:step-delete",
    guarded(
      socket,
      PrepStepDeleteSchema,
      async ({ stepId }, ctx) => {
        const row = await requirePrepStep(stepId, ctx.roomId);
        await prisma.prepStep.update({ where: { id: stepId }, data: { deletedAt: new Date() } });
        io.to(rooms.gm(ctx.roomId)).emit("prep:stepRemoved", { sceneId: row.sceneId, stepId });
        pushEntry(ctx.roomId, buildPrepStepDeleteHistoryEntry(io, ctx.roomId, row.sceneId, stepId, row.title));
        emitHistoryUpdated(io, ctx.roomId);
      },
      gmOnly,
    ),
  );

  socket.on(
    "prep:step-reorder",
    guarded(
      socket,
      PrepStepReorderSchema,
      async ({ sceneId, stepIds }, ctx) => {
        await requireScene(sceneId, ctx.roomId);
        const current = await prisma.prepStep.findMany({ where: { sceneId, deletedAt: null }, select: { id: true } });
        const result = reorderPrepSteps(current, stepIds);
        if (!result.ok) throw new HandlerError(result.error);
        await prisma.$transaction(result.order.map((o) => prisma.prepStep.update({ where: { id: o.stepId }, data: { order: o.order } })));
        io.to(rooms.gm(ctx.roomId)).emit("prep:reordered", { sceneId, order: result.order });
        const rows = await prisma.prepStep.findMany({ where: { sceneId, deletedAt: null }, orderBy: { order: "asc" } });
        return rows.map(toPrepStep);
      },
      gmOnly,
    ),
  );

  socket.on(
    "prep:step-copy",
    guarded(
      socket,
      PrepStepCopySchema,
      async ({ stepId, targetSceneId }, ctx) => {
        const original = await requirePrepStep(stepId, ctx.roomId);
        await requireScene(targetSceneId, ctx.roomId);
        const sameMap = original.sceneId === targetSceneId;
        // Referências são copiadas como estão (nada duplicado no acervo, §2.4). Um item `pin`
        // copiado pra OUTRO mapa fica quebrado de propósito (o pino é daquele mapa específico) —
        // o ack avisa com `brokenPinRefs`.
        const items = prepItemsOf(original).map((item) => ({ ...item, id: randomUUID(), used: false }));
        const brokenPinRefs = !sameMap && items.some((item) => item.ref.kind === "pin");

        const created = await prisma.$transaction(async (tx) => {
          if (sameMap) {
            const insertOrder = original.order + 1;
            await tx.prepStep.updateMany({ where: { sceneId: targetSceneId, deletedAt: null, order: { gte: insertOrder } }, data: { order: { increment: 1 } } });
            return tx.prepStep.create({
              data: { sceneId: targetSceneId, title: `${original.title} (cópia)`, order: insertOrder, notes: original.notes, items: prepItemsJson(items) },
            });
          }
          const siblings = await tx.prepStep.findMany({ where: { sceneId: targetSceneId, deletedAt: null } });
          const insertOrder = siblings.length > 0 ? Math.max(...siblings.map((s) => s.order)) + 1 : 0;
          return tx.prepStep.create({
            data: { sceneId: targetSceneId, title: original.title, order: insertOrder, notes: original.notes, items: prepItemsJson(items) },
          });
        });
        const step = toPrepStep(created);
        io.to(rooms.gm(ctx.roomId)).emit("prep:stepUpserted", { sceneId: targetSceneId, step });
        return { step, brokenPinRefs };
      },
      gmOnly,
    ),
  );

  socket.on(
    "prep:item-add",
    guarded(
      socket,
      PrepItemAddSchema,
      async ({ stepId, ref, index }, ctx) => {
        const stepRow = await requirePrepStep(stepId, ctx.roomId);
        const room = await prisma.room.findUniqueOrThrow({ where: { id: ctx.roomId } });
        const label = await resolveRefLabel(ref, ctx, room);
        const newItem: PrepItem = { id: randomUUID(), ref, label, used: false, auto: false, options: {} };
        const step = await updatePrepItems(stepId, (items) => {
          const clamped = Math.max(0, Math.min(index ?? items.length, items.length));
          const copy = [...items];
          copy.splice(clamped, 0, newItem);
          return copy;
        });
        io.to(rooms.gm(ctx.roomId)).emit("prep:stepUpserted", { sceneId: stepRow.sceneId, step });
        return step;
      },
      gmOnly,
    ),
  );

  socket.on(
    "prep:item-update",
    guarded(
      socket,
      PrepItemUpdateSchema,
      async ({ stepId, itemId, patch }, ctx) => {
        const stepRow = await requirePrepStep(stepId, ctx.roomId);
        const step = await updatePrepItems(stepId, (items) => {
          const idx = items.findIndex((i) => i.id === itemId);
          if (idx < 0) throw new HandlerError("Item não encontrado");
          const next = [...items];
          next[idx] = { ...next[idx]!, ...patch };
          return next;
        });
        io.to(rooms.gm(ctx.roomId)).emit("prep:stepUpserted", { sceneId: stepRow.sceneId, step });
        return step;
      },
      gmOnly,
    ),
  );

  socket.on(
    "prep:item-remove",
    guarded(
      socket,
      PrepItemRemoveSchema,
      async ({ stepId, itemId }, ctx) => {
        const stepRow = await requirePrepStep(stepId, ctx.roomId);
        let removedItem: PrepItem | undefined;
        let removedIndex = -1;
        const step = await updatePrepItems(stepId, (items) => {
          removedIndex = items.findIndex((i) => i.id === itemId);
          if (removedIndex < 0) throw new HandlerError("Item não encontrado");
          removedItem = items[removedIndex];
          return items.filter((i) => i.id !== itemId);
        });
        io.to(rooms.gm(ctx.roomId)).emit("prep:stepUpserted", { sceneId: stepRow.sceneId, step });
        pushEntry(ctx.roomId, buildPrepItemRemoveHistoryEntry(io, ctx.roomId, stepId, stepRow.sceneId, removedItem!, removedIndex));
        emitHistoryUpdated(io, ctx.roomId);
        return step;
      },
      gmOnly,
    ),
  );

  socket.on(
    "prep:item-move",
    guarded(
      socket,
      PrepItemMoveSchema,
      async ({ stepId, itemId, toStepId, index }, ctx) => {
        const fromRow = await requirePrepStep(stepId, ctx.roomId);
        if (toStepId !== stepId) await requirePrepStep(toStepId, ctx.roomId);
        const steps = await movePrepItem(stepId, itemId, toStepId, index);
        for (const step of steps) io.to(rooms.gm(ctx.roomId)).emit("prep:stepUpserted", { sceneId: fromRow.sceneId, step });
        return steps;
      },
      gmOnly,
    ),
  );

  socket.on(
    "prep:reset",
    guarded(
      socket,
      PrepResetSchema,
      async ({ sceneId }, ctx) => {
        const sceneRow = await requireScene(sceneId, ctx.roomId);
        const snapshot = await loadPrepResetSnapshot(sceneId);
        const updated = await zeroPrepUsed(snapshot);
        for (const step of updated) io.to(rooms.gm(ctx.roomId)).emit("prep:stepUpserted", { sceneId, step });
        pushEntry(ctx.roomId, buildPrepResetHistoryEntry(io, ctx.roomId, sceneId, sceneRow.name, snapshot));
        emitHistoryUpdated(io, ctx.roomId);
        return updated;
      },
      gmOnly,
    ),
  );
}
