import { randomUUID } from "node:crypto";
import {
  CompendiumFavoriteToggleSchema,
  CompendiumSpawnCreatureSchema,
  DEFAULT_MAP_SIZE,
  EmptySchema,
  RoomCompendiumCreateSchema,
  RoomCompendiumDeleteSchema,
  RoomCompendiumImportSchema,
  RoomCompendiumUpdateSchema,
  creatureColor,
  entryToCharacter,
  findFreeCells,
  getSystemDefinition,
  numberedNames,
  type CellRect,
  type Character,
  type Token,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { listCompendium } from "../services/compendium.js";
import { listFavoriteEntryIds } from "../services/compendiumFavorites.js";
import { broadcastCharacter, toCharacter, toJson } from "../services/characters.js";
import { cellAt, cellRect, cellToPoint, effectiveCellSize, sceneGeometry } from "../services/grid.js";
import { describeSpawn, pushEntry, type HistoryEntry } from "../services/history.js";
import {
  createRoomCompendiumEntry,
  importRoomCompendium,
  nextEntryId,
  requireRoomCompendiumEntry,
  roomCompendiumEntries,
  toCompendiumEntry,
  updateRoomCompendiumEntry,
  validateRoomEntry,
} from "../services/roomCompendium.js";
import { toScene, toToken } from "../services/serialize.js";
import { guarded, HandlerError } from "./ack.js";
import { emitHistoryUpdated } from "./history.js";
import { buildMultiSpawnHistoryEntry } from "./spawnHistory.js";
import { broadcastToken } from "./token.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

const gmOnly = { gmOnly: true };

/** Carrega a sala e devolve a definição do sistema, ou lança se a sala não existir. */
async function requireRoomDef(roomId: string) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) throw new HandlerError("Sala não encontrada");
  return getSystemDefinition(room.systemId);
}

/**
 * `compendium:room-delete`: soft delete + entrada no desfazer (mesmo padrão de
 * buildHandoutDeleteHistoryEntry, socket/handout.ts) — `revert` volta `deletedAt: null` e reemite
 * como se tivesse acabado de ser criada; `apply` marca `deletedAt` e emite o `deleted`.
 */
function buildRoomCompendiumDeleteHistoryEntry(io: TypedServer, roomId: string, entryId: string, name: string): HistoryEntry {
  return {
    summary: `apagar "${name}" do compêndio da sala`,
    async revert() {
      const row = await prisma.roomCompendiumEntry.findUnique({ where: { roomId_entryId: { roomId, entryId } } });
      if (!row || row.deletedAt === null) throw new Error(`"${name}" não está mais apagada`);
      const updated = await prisma.roomCompendiumEntry.update({ where: { roomId_entryId: { roomId, entryId } }, data: { deletedAt: null } });
      io.to(rooms.gm(roomId)).emit("compendium:room-created", toCompendiumEntry(updated));
    },
    async apply() {
      const row = await prisma.roomCompendiumEntry.findUnique({ where: { roomId_entryId: { roomId, entryId } } });
      if (!row || row.deletedAt !== null) throw new Error(`"${name}" não existe mais`);
      await prisma.roomCompendiumEntry.update({ where: { roomId_entryId: { roomId, entryId } }, data: { deletedAt: new Date() } });
      io.to(rooms.gm(roomId)).emit("compendium:room-deleted", { entryId });
    },
  };
}

export function registerCompendiumHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "compendium:list",
    guarded(socket, EmptySchema, async (_input, ctx) => {
      const room = await prisma.room.findUnique({ where: { id: ctx.roomId } });
      if (!room) throw new HandlerError("Sala não encontrada");
      return listCompendium(room.systemId, room.id, ctx.role);
    }),
  );

  socket.on(
    "compendium:spawn-creature",
    guarded(
      socket,
      CompendiumSpawnCreatureSchema,
      async (data, ctx) => {
        const room = await prisma.room.findUnique({ where: { id: ctx.roomId } });
        if (!room) throw new HandlerError("Sala não encontrada");
        const sceneRow = await prisma.scene.findUnique({ where: { id: data.sceneId } });
        if (!sceneRow || sceneRow.roomId !== ctx.roomId || sceneRow.deletedAt !== null) throw new HandlerError("Mapa não encontrado");

        const def = getSystemDefinition(room.systemId);
        const { entries } = await listCompendium(room.systemId, room.id, "gm");
        const entry = entries.find((e) => e.id === data.entryId);
        if (!entry || entry.type !== "creature") throw new HandlerError("Criatura não encontrada no compêndio");

        const scene = toScene(sceneRow);
        const cellSize = effectiveCellSize(scene.grid);
        // Mapa sem imagem (mapWidth/Height null): mesmo tamanho padrão que o cliente desenha
        // (DEFAULT_MAP_SIZE) — usar outro aqui faria o servidor confinar tudo num canto que o
        // cliente nem mostra como limite.
        const map = { width: sceneRow.mapWidth ?? DEFAULT_MAP_SIZE.width, height: sceneRow.mapHeight ?? DEFAULT_MAP_SIZE.height };
        const bounds = { cols: Math.max(1, Math.ceil(map.width / cellSize)), rows: Math.max(1, Math.ceil(map.height / cellSize)) };

        const existingTokens = await prisma.token.findMany({ where: { sceneId: data.sceneId, deletedAt: null } });
        const occupied: CellRect[] = existingTokens.map((t) => cellRect(t, scene.grid));
        // Lado em células: arredonda (tokenCells pode ser fracionário, ex.: Minúsculo = 0,5) —
        // vira o `Token.cells` gravado (docs/plano-grid.md), mínimo 1 (docs/backlog.md).
        const sizeDef = def.sizes.find((s) => s.key === entry.sheet.size);
        const cellsPerSide = Math.max(1, Math.round(sizeDef?.tokenCells ?? 1));

        const start = cellAt({ x: data.x, y: data.y }, scene.grid);
        const positions = findFreeCells({ start, cells: cellsPerSide, count: data.count, occupied, bounds });
        // Pode devolver menos que `count` (espiral estourou o raio máximo): cria só o que coube.
        const names = numberedNames(
          entry.name,
          positions.length,
          existingTokens.map((t) => t.name),
        );

        const color = creatureColor(def, entry);

        const results: { character: Character; token: Token }[] = await prisma.$transaction(async (tx) => {
          const created: { character: Character; token: Token }[] = [];
          for (let i = 0; i < positions.length; i++) {
            const point = cellToPoint(positions[i]!, scene.grid);
            const name = names[i] ?? entry.name;
            const copy = entryToCharacter(def, entry, randomUUID, { name });
            const characterRow = await tx.character.create({
              data: { roomId: ctx.roomId, ownerId: null, name: copy.name, kind: copy.kind, data: toJson(copy.data), compendiumEntryId: entry.id },
            });
            const tokenRow = await tx.token.create({
              data: {
                sceneId: data.sceneId,
                name,
                imageUrl: null,
                x: point.x,
                y: point.y,
                cells: cellsPerSide,
                zIndex: existingTokens.length + i + 1,
                visible: data.visible,
                ownerId: null,
                color,
                characterId: characterRow.id,
              },
            });
            created.push({ character: toCharacter(characterRow), token: toToken(tokenRow) });
          }
          return created;
        });

        // Broadcast fora da transação: character:created (broadcastCharacter já manda NPC só pro
        // GM) e token:created (visibilidade normal — respeita `visible` e a névoa da cena).
        for (const { character, token } of results) {
          broadcastCharacter(io, ctx.roomId, character, "character:created");
          broadcastToken(io, ctx.roomId, token, "token:created", sceneGeometry(scene));
        }

        // compendium:spawn-creature já é gmOnly (guarded abaixo), então sempre empilha.
        if (results.length > 0) {
          pushEntry(ctx.roomId, buildMultiSpawnHistoryEntry(io, ctx.roomId, data.sceneId, def, describeSpawn(results.length, entry.name), results));
          emitHistoryUpdated(io, ctx.roomId);
        }

        return results.map((r) => r.token);
      },
      { gmOnly: true },
    ),
  );

  // Favoritos (docs/SPEC.md §9.19): 100% pessoal, sem gmOnly — cada participante mexe só nos
  // próprios. Sem broadcast (o ack já devolve a lista atualizada pra quem chamou).
  socket.on(
    "compendium:favorite-add",
    guarded(socket, CompendiumFavoriteToggleSchema, async ({ entryId }, ctx) => {
      await prisma.compendiumFavorite.upsert({
        where: { participantId_entryId: { participantId: ctx.participantId, entryId } },
        update: {},
        create: { roomId: ctx.roomId, participantId: ctx.participantId, entryId },
      });
      return listFavoriteEntryIds(ctx.roomId, ctx.participantId);
    }),
  );

  socket.on(
    "compendium:favorite-remove",
    guarded(socket, CompendiumFavoriteToggleSchema, async ({ entryId }, ctx) => {
      await prisma.compendiumFavorite.deleteMany({ where: { participantId: ctx.participantId, entryId } });
      return listFavoriteEntryIds(ctx.roomId, ctx.participantId);
    }),
  );

  // Homebrew da sala (docs/plano-compendio-sala.md, §9.18): mesmo desenho de handout:* — GM only,
  // broadcast pra rooms.gm (pode haver mais de uma aba/GM olhando a sala).
  socket.on(
    "compendium:room-create",
    guarded(
      socket,
      RoomCompendiumCreateSchema,
      async ({ entry }, ctx) => {
        const def = await requireRoomDef(ctx.roomId);
        const entryId = await nextEntryId(def.id, ctx.roomId, entry.name);
        const err = validateRoomEntry(def, entryId, entry);
        if (err) throw new HandlerError(err);
        const row = await createRoomCompendiumEntry(ctx.roomId, entryId, entry);
        const created = toCompendiumEntry(row);
        io.to(rooms.gm(ctx.roomId)).emit("compendium:room-created", created);
        return created;
      },
      gmOnly,
    ),
  );

  socket.on(
    "compendium:room-update",
    guarded(
      socket,
      RoomCompendiumUpdateSchema,
      async ({ entryId, entry }, ctx) => {
        await requireRoomCompendiumEntry(ctx.roomId, entryId);
        const def = await requireRoomDef(ctx.roomId);
        const err = validateRoomEntry(def, entryId, entry);
        if (err) throw new HandlerError(err);
        const row = await updateRoomCompendiumEntry(ctx.roomId, entryId, entry);
        const updated = toCompendiumEntry(row);
        io.to(rooms.gm(ctx.roomId)).emit("compendium:room-updated", updated);
        return updated;
      },
      gmOnly,
    ),
  );

  socket.on(
    "compendium:room-delete",
    guarded(
      socket,
      RoomCompendiumDeleteSchema,
      async ({ entryId }, ctx) => {
        const row = await requireRoomCompendiumEntry(ctx.roomId, entryId);
        await prisma.roomCompendiumEntry.update({ where: { roomId_entryId: { roomId: ctx.roomId, entryId } }, data: { deletedAt: new Date() } });
        io.to(rooms.gm(ctx.roomId)).emit("compendium:room-deleted", { entryId });
        pushEntry(ctx.roomId, buildRoomCompendiumDeleteHistoryEntry(io, ctx.roomId, entryId, row.name));
        emitHistoryUpdated(io, ctx.roomId);
      },
      gmOnly,
    ),
  );

  socket.on(
    "compendium:room-export",
    guarded(
      socket,
      EmptySchema,
      async (_input, ctx) => ({ entries: await roomCompendiumEntries(ctx.roomId) }),
      gmOnly,
    ),
  );

  socket.on(
    "compendium:room-import",
    guarded(
      socket,
      RoomCompendiumImportSchema,
      async ({ entries, overwriteConflicts }, ctx) => {
        const def = await requireRoomDef(ctx.roomId);
        const { outcome, changed } = await importRoomCompendium(def, ctx.roomId, entries, overwriteConflicts);
        for (const { kind, entry } of changed) {
          io.to(rooms.gm(ctx.roomId)).emit(kind === "created" ? "compendium:room-created" : "compendium:room-updated", entry);
        }
        return outcome;
      },
      gmOnly,
    ),
  );
}
