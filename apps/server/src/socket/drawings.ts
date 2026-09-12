/**
 * Traços de desenho livre no mapa (docs/SPEC.md §9.17): persistidos por mapa (diferente dos
 * gabaritos, que são efêmeros — socket/templates.ts), um por linha do banco. GM sempre pode criar/
 * mover/redimensionar/apagar qualquer traço; jogador só os PRÓPRIOS, e só enquanto "jogadores podem
 * desenhar" estiver ligado (drawingPermission.ts) e no mapa ATIVO da sala (requirePlayerOnActiveScene,
 * mesma regra de ruler/gabarito). Visibilidade "todos"/"só GM" é decisão exclusiva do GM — o
 * servidor força `visible: true` em qualquer traço criado por jogador e recusa um jogador tentando
 * mudar isso depois.
 *
 * Desfazer (docs/plano-desfazer.md §6): só ações do GM empilham na pilha geral da sala — jogador tem
 * sua própria pilha, só no cliente (apps/web/src/store/drawingHistory.ts), mesma regra de gabaritos.
 */
import {
  DRAWING_MAX_PER_SCENE,
  DrawingClearAllSchema,
  DrawingClearMineSchema,
  DrawingCreateSchema,
  DrawingPatchSchema,
  DrawingRemoveSchema,
  DrawingSetPlayerPermissionSchema,
  type Drawing,
} from "@tormenta-vtt/shared";
import type { Drawing as DbDrawing, Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { requirePlayerOnActiveScene } from "../services/combat.js";
import { isPlayerDrawingEnabled, setPlayerDrawingEnabled } from "../services/drawingPermission.js";
import { requireDrawing, toDrawing } from "../services/drawings.js";
import { pushEntry, type HistoryEntry } from "../services/history.js";
import { isActiveScene } from "../services/visibility.js";
import { guarded, HandlerError } from "./ack.js";
import { emitHistoryUpdated } from "./history.js";
import { requireScene } from "./scene.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

/** Broadcast de mapa de sempre: GM recebe qualquer traço; jogador só se `visible` e o mapa é o ATIVO. */
export function emitDrawingCreated(io: TypedServer, roomId: string, sceneId: string, drawing: Drawing, visibleToPlayers: boolean): void {
  io.to(rooms.gm(roomId)).emit("drawing:created", { sceneId, drawing });
  if (visibleToPlayers) io.to(rooms.players(roomId)).emit("drawing:created", { sceneId, drawing });
}

export function emitDrawingUpdated(io: TypedServer, roomId: string, sceneId: string, drawing: Drawing, visibleToPlayers: boolean): void {
  io.to(rooms.gm(roomId)).emit("drawing:updated", { sceneId, drawing });
  if (visibleToPlayers) io.to(rooms.players(roomId)).emit("drawing:updated", { sceneId, drawing });
}

export function emitDrawingRemoved(io: TypedServer, roomId: string, sceneId: string, drawingId: string, notifyPlayers: boolean): void {
  io.to(rooms.gm(roomId)).emit("drawing:removed", { sceneId, drawingId });
  if (notifyPlayers) io.to(rooms.players(roomId)).emit("drawing:removed", { sceneId, drawingId });
}

/** "Limpar meus desenhos"/"Limpar tudo": um evento de lote só, não N `drawing:removed` — o cliente
 *  remove todos os ids de uma vez. Ids que o destinatário nunca teve (traço "só GM" pra um jogador)
 *  são um no-op inofensivo do lado dele, então manda a lista inteira pra quem vê o mapa ativo. */
export function emitDrawingCleared(io: TypedServer, roomId: string, sceneId: string, drawingIds: string[], notifyPlayers: boolean): void {
  io.to(rooms.gm(roomId)).emit("drawing:cleared", { sceneId, drawingIds });
  if (notifyPlayers) io.to(rooms.players(roomId)).emit("drawing:cleared", { sceneId, drawingIds });
}

/** Campos de geometria/aparência específicos do `kind` — mesmo formato do patch e das colunas do
 *  banco, então servem tanto pra montar o `create` quanto pra aplicar um `revert`/`apply` de undo. */
function drawingShapeData(d: Drawing): Prisma.DrawingUncheckedCreateInput {
  const base = { sceneId: d.sceneId, ownerId: d.ownerId, color: d.color, strokeWidth: d.strokeWidth, visible: d.visible };
  switch (d.kind) {
    case "pen":
      return { ...base, kind: "pen", points: d.points };
    case "line":
      return { ...base, kind: "line", x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 };
    case "arrow":
      return { ...base, kind: "arrow", x1: d.x1, y1: d.y1, x2: d.x2, y2: d.y2 };
    case "rect":
      return { ...base, kind: "rect", x: d.x, y: d.y, width: d.width, height: d.height, filled: d.filled };
    case "ellipse":
      return { ...base, kind: "ellipse", cx: d.cx, cy: d.cy, rx: d.rx, ry: d.ry, filled: d.filled };
    case "text":
      return { ...base, kind: "text", x: d.x, y: d.y, text: d.text };
  }
}

/** Alterna `deletedAt` de um traço já existente (criar/restaurar vs. apagar) e reemite — mesmo
 *  padrão de `setPinDeleted`. Usado pelos dois sentidos do histórico de `drawing:create`/`remove`. */
async function setDrawingDeleted(io: TypedServer, roomId: string, sceneId: string, drawing: Drawing, deleted: boolean): Promise<void> {
  const row = await prisma.drawing.findUnique({ where: { id: drawing.id } });
  if (!row) throw new Error(`o traço "${drawing.id}" não existe mais`);
  if (deleted === (row.deletedAt !== null)) throw new Error(deleted ? "o traço já está apagado" : "o traço já existe");
  await prisma.drawing.update({ where: { id: drawing.id }, data: { deletedAt: deleted ? new Date() : null } });
  const activeNow = await isActiveScene(roomId, sceneId);
  if (deleted) emitDrawingRemoved(io, roomId, sceneId, drawing.id, activeNow);
  else emitDrawingCreated(io, roomId, sceneId, drawing, drawing.visible && activeNow);
}

function buildDrawingCreateHistoryEntry(io: TypedServer, roomId: string, sceneId: string, drawing: Drawing): HistoryEntry {
  return {
    summary: "desenhar",
    revert: () => setDrawingDeleted(io, roomId, sceneId, drawing, true),
    apply: () => setDrawingDeleted(io, roomId, sceneId, drawing, false),
  };
}

function buildDrawingRemoveHistoryEntry(io: TypedServer, roomId: string, sceneId: string, drawing: Drawing): HistoryEntry {
  return {
    summary: "apagar desenho",
    revert: () => setDrawingDeleted(io, roomId, sceneId, drawing, false),
    apply: () => setDrawingDeleted(io, roomId, sceneId, drawing, true),
  };
}

/** Campos de um `Drawing` que entram no desfazer do GM: geometria + aparência (mesmo espírito de
 *  `TRACKABLE_PIN_FIELDS`, mas aqui o `kind` nunca muda entre before/after, então basta comparar
 *  todas as colunas de geometria de uma vez). */
const TRACKABLE_DRAWING_FIELDS = [
  "points",
  "x1",
  "y1",
  "x2",
  "y2",
  "x",
  "y",
  "width",
  "height",
  "cx",
  "cy",
  "rx",
  "ry",
  "text",
  "color",
  "strokeWidth",
  "filled",
  "visible",
] as const;
type TrackableDrawingField = (typeof TRACKABLE_DRAWING_FIELDS)[number];
type TrackableDrawingPatch = Partial<Pick<DbDrawing, TrackableDrawingField>>;

function pickTrackableDrawingPatch(before: DbDrawing, after: DbDrawing): { before: TrackableDrawingPatch; after: TrackableDrawingPatch } | null {
  const b: TrackableDrawingPatch = {};
  const a: TrackableDrawingPatch = {};
  for (const f of TRACKABLE_DRAWING_FIELDS) {
    const changed = f === "points" ? JSON.stringify(before[f]) !== JSON.stringify(after[f]) : before[f] !== after[f];
    if (changed) {
      (b as Record<string, unknown>)[f] = before[f];
      (a as Record<string, unknown>)[f] = after[f];
    }
  }
  return Object.keys(b).length > 0 ? { before: b, after: a } : null;
}

async function writeTrackableDrawingPatch(io: TypedServer, roomId: string, drawingId: string, patch: TrackableDrawingPatch): Promise<void> {
  const row = await prisma.drawing.findUnique({ where: { id: drawingId } });
  if (!row || row.deletedAt !== null) throw new Error(`o traço "${drawingId}" não existe mais`);
  const updated = toDrawing(await prisma.drawing.update({ where: { id: drawingId }, data: patch }));
  const activeNow = await isActiveScene(roomId, updated.sceneId);
  emitDrawingUpdated(io, roomId, updated.sceneId, updated, updated.visible && activeNow);
}

function buildDrawingPatchHistoryEntry(io: TypedServer, roomId: string, drawingId: string, diff: { before: TrackableDrawingPatch; after: TrackableDrawingPatch }): HistoryEntry {
  const isMoveOnly = Object.keys(diff.after).every((k) => ["x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "points"].includes(k));
  return {
    summary: isMoveOnly ? "mover desenho" : "editar desenho",
    revert: () => writeTrackableDrawingPatch(io, roomId, drawingId, diff.before),
    apply: () => writeTrackableDrawingPatch(io, roomId, drawingId, diff.after),
  };
}

/** "Limpar meus desenhos"/"Limpar tudo" do GM: uma entrada só pro lote inteiro, mesmo padrão de
 *  `buildHandoutDeleteHistoryEntry` — os ids já vieram capturados de antes da transação; revert/apply
 *  recarregam cada linha (tolerantes a uma já ter sido mexida por outra ação no meio tempo). */
function buildDrawingClearHistoryEntry(io: TypedServer, roomId: string, sceneId: string, drawingIds: string[], summary: string): HistoryEntry {
  return {
    summary,
    async revert() {
      for (const id of drawingIds) {
        const row = await prisma.drawing.findUnique({ where: { id } });
        if (!row || row.deletedAt === null) continue;
        const updated = toDrawing(await prisma.drawing.update({ where: { id }, data: { deletedAt: null } }));
        const activeNow = await isActiveScene(roomId, sceneId);
        emitDrawingCreated(io, roomId, sceneId, updated, updated.visible && activeNow);
      }
    },
    async apply() {
      for (const id of drawingIds) {
        const row = await prisma.drawing.findUnique({ where: { id } });
        if (!row || row.deletedAt !== null) continue;
        await prisma.drawing.update({ where: { id }, data: { deletedAt: new Date() } });
        const activeNow = await isActiveScene(roomId, sceneId);
        emitDrawingRemoved(io, roomId, sceneId, id, activeNow);
      }
    },
  };
}

export function registerDrawingHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "drawing:create",
    guarded(socket, DrawingCreateSchema, async ({ sceneId, drawing }, ctx) => {
      await requireScene(sceneId, ctx.roomId);
      await requirePlayerOnActiveScene(ctx.roomId, sceneId, ctx.role);
      if (ctx.role !== "gm" && !isPlayerDrawingEnabled(ctx.roomId)) {
        throw new HandlerError("O Mestre desativou o desenho para jogadores");
      }

      const count = await prisma.drawing.count({ where: { sceneId, deletedAt: null } });
      if (count >= DRAWING_MAX_PER_SCENE) throw new HandlerError("Limite de desenhos neste mapa atingido");

      // Nunca confia no payload: dono é sempre quem chamou; jogador nunca cria "só GM".
      const saved: Drawing = { ...drawing, sceneId, ownerId: ctx.participantId, visible: ctx.role === "gm" ? drawing.visible : true };
      const row = await prisma.drawing.create({ data: { id: saved.id, ...drawingShapeData(saved) } });
      const created = toDrawing(row);

      const activeNow = await isActiveScene(ctx.roomId, sceneId);
      emitDrawingCreated(io, ctx.roomId, sceneId, created, created.visible && activeNow);

      if (ctx.role === "gm") {
        pushEntry(ctx.roomId, buildDrawingCreateHistoryEntry(io, ctx.roomId, sceneId, created));
        emitHistoryUpdated(io, ctx.roomId);
      }
      return created;
    }),
  );

  socket.on(
    "drawing:update",
    guarded(socket, DrawingPatchSchema, async ({ sceneId, drawingId, patch, live }, ctx) => {
      await requireScene(sceneId, ctx.roomId);
      await requirePlayerOnActiveScene(ctx.roomId, sceneId, ctx.role);
      const row = await requireDrawing(drawingId, sceneId);
      if (ctx.role !== "gm" && row.ownerId !== ctx.participantId) {
        throw new HandlerError("Você só pode editar seus próprios desenhos");
      }
      if (patch.visible !== undefined && ctx.role !== "gm") {
        throw new HandlerError("Só o Mestre pode mudar a visibilidade de um desenho");
      }

      const updatedRow = await prisma.drawing.update({ where: { id: drawingId }, data: patch as Prisma.DrawingUpdateInput });
      const updated = toDrawing(updatedRow);
      const activeNow = await isActiveScene(ctx.roomId, sceneId);
      emitDrawingUpdated(io, ctx.roomId, sceneId, updated, updated.visible && activeNow);

      // `live` (eco de arraste/redimensionamento em andamento) nunca empilha — só o commit final do
      // gesto, mesmo motivo de `TemplateUpsertSchema.live`. Só o GM empilha na pilha geral.
      if (ctx.role === "gm" && !live) {
        const diff = pickTrackableDrawingPatch(row, updatedRow);
        if (diff) {
          pushEntry(ctx.roomId, buildDrawingPatchHistoryEntry(io, ctx.roomId, drawingId, diff));
          emitHistoryUpdated(io, ctx.roomId);
        }
      }
      return updated;
    }),
  );

  socket.on(
    "drawing:remove",
    guarded(socket, DrawingRemoveSchema, async ({ sceneId, drawingId }, ctx) => {
      await requireScene(sceneId, ctx.roomId);
      await requirePlayerOnActiveScene(ctx.roomId, sceneId, ctx.role);
      const row = await requireDrawing(drawingId, sceneId);
      if (ctx.role !== "gm" && row.ownerId !== ctx.participantId) {
        throw new HandlerError("Você só pode apagar seus próprios desenhos");
      }
      const drawing = toDrawing(row);

      await prisma.drawing.update({ where: { id: drawingId }, data: { deletedAt: new Date() } });
      const activeNow = await isActiveScene(ctx.roomId, sceneId);
      emitDrawingRemoved(io, ctx.roomId, sceneId, drawingId, drawing.visible && activeNow);

      if (ctx.role === "gm") {
        pushEntry(ctx.roomId, buildDrawingRemoveHistoryEntry(io, ctx.roomId, sceneId, drawing));
        emitHistoryUpdated(io, ctx.roomId);
      }
    }),
  );

  socket.on(
    "drawing:clear-mine",
    guarded(socket, DrawingClearMineSchema, async ({ sceneId }, ctx) => {
      await requireScene(sceneId, ctx.roomId);
      await requirePlayerOnActiveScene(ctx.roomId, sceneId, ctx.role);

      const rows = await prisma.drawing.findMany({ where: { sceneId, ownerId: ctx.participantId, deletedAt: null } });
      if (rows.length === 0) return;
      const ids = rows.map((r) => r.id);

      await prisma.$transaction(ids.map((id) => prisma.drawing.update({ where: { id }, data: { deletedAt: new Date() } })));
      const activeNow = await isActiveScene(ctx.roomId, sceneId);
      emitDrawingCleared(io, ctx.roomId, sceneId, ids, activeNow);

      // Só o GM empilha na pilha geral (mesma regra §6): "limpar meus" de um jogador fica de fora —
      // ele tem a própria pilha local, no cliente (store/drawingHistory.ts).
      if (ctx.role === "gm") {
        pushEntry(ctx.roomId, buildDrawingClearHistoryEntry(io, ctx.roomId, sceneId, ids, `limpar ${ids.length === 1 ? "1 desenho" : `${ids.length} desenhos`} (meus)`));
        emitHistoryUpdated(io, ctx.roomId);
      }
    }),
  );

  socket.on(
    "drawing:clear-all",
    guarded(
      socket,
      DrawingClearAllSchema,
      async ({ sceneId }, ctx) => {
        await requireScene(sceneId, ctx.roomId);

        const rows = await prisma.drawing.findMany({ where: { sceneId, deletedAt: null } });
        if (rows.length === 0) return;
        const ids = rows.map((r) => r.id);

        await prisma.$transaction(ids.map((id) => prisma.drawing.update({ where: { id }, data: { deletedAt: new Date() } })));
        emitDrawingCleared(io, ctx.roomId, sceneId, ids, await isActiveScene(ctx.roomId, sceneId));

        pushEntry(ctx.roomId, buildDrawingClearHistoryEntry(io, ctx.roomId, sceneId, ids, ids.length === 1 ? "limpar 1 desenho" : `limpar ${ids.length} desenhos`));
        emitHistoryUpdated(io, ctx.roomId);
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "drawing:set-player-permission",
    guarded(
      socket,
      DrawingSetPlayerPermissionSchema,
      async ({ enabled }, ctx) => {
        setPlayerDrawingEnabled(ctx.roomId, enabled);
        io.to(rooms.all(ctx.roomId)).emit("drawing:playerPermissionChanged", { enabled });
        return { enabled };
      },
      { gmOnly: true },
    ),
  );
}
