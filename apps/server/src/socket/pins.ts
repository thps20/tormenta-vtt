/**
 * Pinos no mapa (docs/plano-narracao.md): unifica o antigo handout:pin/unpin com o pino de nota.
 * `kind: "handout"` no payload de criação vira um pino "image"/"text" (cópia denormalizada do
 * Handout); `kind: "note"` cria um pino com o conteúdo direto. Só o GM cria/edita/apaga. Broadcast
 * segue a regra de mapa de sempre (GM sempre recebe; jogador só se `visible` e `sceneId` é o mapa
 * ATIVO da sala) — entra no desfazer do GM, mesmo mecanismo de handout:pin/unpin de antes.
 */
import type { Pin as DbPin } from "@prisma/client";
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

/**
 * Campos de um `Pin` que entram no desfazer do GM: posição (`x`/`y` — mover, QUALQUER `kind`) e
 * conteúdo de nota (`name`/`text`/`icon`/`color` — só `kind: "note"`, mas comparar por linha crua
 * do banco não precisa saber disso: um handout nunca tem esses campos mudados, então a diferença
 * dá vazia sozinha). `visible` também é trackable (mesmo padrão de `Token.visible`).
 */
const TRACKABLE_PIN_FIELDS = ["x", "y", "name", "text", "icon", "color", "visible"] as const;
type TrackablePinField = (typeof TRACKABLE_PIN_FIELDS)[number];
type TrackablePinPatch = Partial<Pick<DbPin, TrackablePinField>>;

/** Mesmo padrão de `pickTrackableTokenPatch` (services/history.ts, docs/plano-desfazer.md §3): só
 *  os campos que de fato mudaram entre a linha ANTES e DEPOIS do update. `null` = nada trackable
 *  mudou (patch só tocou um campo que não entra no histórico — não deveria acontecer hoje, mas não
 *  trava o resto do handler por isso). */
function pickTrackablePinPatch(before: DbPin, after: DbPin): { before: TrackablePinPatch; after: TrackablePinPatch } | null {
  const b: TrackablePinPatch = {};
  const a: TrackablePinPatch = {};
  for (const f of TRACKABLE_PIN_FIELDS) {
    if (before[f] !== after[f]) {
      // A união discriminada do Prisma não deixa TS provar que os dois lados do mesmo campo `f`
      // batem tipo a tipo aqui (ele só sabe que cada um É um valor de Pin, não QUAL). Seguro na
      // prática: os dois vêm da mesma coluna da mesma tabela.
      (b as Record<string, unknown>)[f] = before[f];
      (a as Record<string, unknown>)[f] = after[f];
    }
  }
  return Object.keys(b).length > 0 ? { before: b, after: a } : null;
}

/** `pin:update`: revert/apply trocam o patch aplicado — mesmo padrão de `buildUpdateHistoryEntry`
 *  do token (docs/plano-desfazer.md §3). Resumo diferencia "mover" (só x/y) de "editar" (conteúdo). */
function buildPinPatchHistoryEntry(io: TypedServer, roomId: string, label: string, pinId: string, diff: { before: TrackablePinPatch; after: TrackablePinPatch }): HistoryEntry {
  const isMoveOnly = Object.keys(diff.after).every((k) => k === "x" || k === "y");
  return {
    summary: `${isMoveOnly ? "mover" : "editar"} pino "${label}"`,
    revert: () => writeTrackablePinPatch(io, roomId, pinId, diff.before),
    apply: () => writeTrackablePinPatch(io, roomId, pinId, diff.after),
  };
}

/** Reaplica só os campos rastreados capturados (before OU after) num pino — usado por revert/apply.
 *  Pino apagado nesse meio tempo invalida a entrada inteira (mesmo espírito de writeTrackablePatch
 *  do token). */
async function writeTrackablePinPatch(io: TypedServer, roomId: string, pinId: string, patch: TrackablePinPatch): Promise<void> {
  const row = await prisma.pin.findUnique({ where: { id: pinId } });
  if (!row || row.deletedAt !== null) throw new Error(`o pino "${pinId}" não existe mais`);
  const updated = toPin(await prisma.pin.update({ where: { id: pinId }, data: patch }));
  const activeNow = await isActiveScene(roomId, updated.sceneId);
  emitPinUpdated(io, roomId, updated.sceneId, updated, updated.visible && activeNow);
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

        // Mover (x/y) vale pra QUALQUER kind (docs/plano-narracao.md — pino se comporta como
        // token: arrastar move); editar CONTEÚDO (título/texto/ícone/cor) continua só pra nota —
        // handout é cópia denormalizada de outra entidade, "apague e fixe de novo" pra atualizar.
        const isContentPatch = patch.title !== undefined || patch.text !== undefined || patch.icon !== undefined || patch.color !== undefined;
        if (isContentPatch && before.kind !== "note") {
          throw new HandlerError("Só um pino de nota pode ser editado no lugar — apague e fixe o handout de novo");
        }

        const data = {
          ...(patch.x !== undefined ? { x: patch.x } : {}),
          ...(patch.y !== undefined ? { y: patch.y } : {}),
          ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
          ...(before.kind === "note" && patch.title !== undefined ? { name: patch.title } : {}),
          ...(before.kind === "note" && patch.text !== undefined ? { text: patch.text } : {}),
          ...(before.kind === "note" && patch.icon !== undefined ? { icon: patch.icon } : {}),
          ...(before.kind === "note" && patch.color !== undefined ? { color: patch.color } : {}),
        };
        const updatedRow = await prisma.pin.update({ where: { id: pinId }, data });
        const updated = toPin(updatedRow);
        const activeNow = await isActiveScene(ctx.roomId, sceneId);
        emitPinUpdated(io, ctx.roomId, sceneId, updated, updated.visible && activeNow);

        const diff = pickTrackablePinPatch(row, updatedRow);
        if (diff) {
          const label = before.kind === "note" ? before.title : (before.name ?? "");
          pushEntry(ctx.roomId, buildPinPatchHistoryEntry(io, ctx.roomId, label, pinId, diff));
          emitHistoryUpdated(io, ctx.roomId);
        }
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
