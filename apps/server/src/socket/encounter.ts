/**
 * Encontros salvos (docs/SPEC.md §9.14): biblioteca por sala (list/create/create-from-tokens/
 * update/delete, mesmo desenho de handout:* — gmOnly, broadcast pra rooms.gm) + `spawn`, que solta
 * TODAS as criaturas do encontro na cena numa transação só (mesmo princípio de
 * compendium:spawn-creature, mas para várias entradas de uma vez — ver rules/encounter.ts).
 */
import { randomUUID } from "node:crypto";
import {
  DEFAULT_MAP_SIZE,
  EmptySchema,
  EncounterCreateFromTokensSchema,
  EncounterCreateSchema,
  EncounterDeleteSchema,
  EncounterSpawnSchema,
  EncounterUpdateSchema,
  creatureColor,
  entryToCharacter,
  expandEncounterEntries,
  getSystemDefinition,
  type CellRect,
  type Character,
  type CompendiumCreatureEntry,
  type Token,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { listCompendium } from "../services/compendium.js";
import { broadcastCharacter, toCharacter, toJson } from "../services/characters.js";
import { encounterEntriesOf, entriesJson, requireEncounter, toEncounter } from "../services/encounters.js";
import { cellAt, cellRect, cellToPoint, effectiveCellSize, sceneGeometry } from "../services/grid.js";
import { describeEncounterSpawn, pushEntry } from "../services/history.js";
import { toScene, toToken } from "../services/serialize.js";
import { guarded, HandlerError } from "./ack.js";
import { emitHistoryUpdated } from "./history.js";
import { buildMultiSpawnHistoryEntry } from "./spawnHistory.js";
import { broadcastToken } from "./token.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

const gmOnly = { gmOnly: true };

export function registerEncounterHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "encounter:list",
    guarded(
      socket,
      EmptySchema,
      async (_input, ctx) => {
        const rows = await prisma.savedEncounter.findMany({ where: { roomId: ctx.roomId, deletedAt: null }, orderBy: { createdAt: "asc" } });
        return rows.map(toEncounter);
      },
      gmOnly,
    ),
  );

  socket.on(
    "encounter:create",
    guarded(
      socket,
      EncounterCreateSchema,
      async (data, ctx) => {
        const row = await prisma.savedEncounter.create({
          data: { roomId: ctx.roomId, name: data.name, tags: data.tags, notes: data.notes, entries: entriesJson(data.entries) },
        });
        const encounter = toEncounter(row);
        io.to(rooms.gm(ctx.roomId)).emit("encounter:created", encounter);
        return encounter;
      },
      gmOnly,
    ),
  );

  socket.on(
    "encounter:create-from-tokens",
    guarded(
      socket,
      EncounterCreateFromTokensSchema,
      async (data, ctx) => {
        const tokens = await prisma.token.findMany({ where: { id: { in: data.tokenIds }, deletedAt: null, scene: { roomId: ctx.roomId } } });
        const characterIds = tokens.map((t) => t.characterId).filter((id): id is string => id !== null);
        const characters = characterIds.length > 0 ? await prisma.character.findMany({ where: { id: { in: characterIds } } }) : [];
        const characterById = new Map(characters.map((c) => [c.id, c]));

        // Agrupa por entrada de compêndio (Character.compendiumEntryId): tokens sem ficha, ou cuja
        // ficha não veio do compêndio, e ids que não existem mais (apagados/de outra sala) entram em
        // `ignored`, para o ack avisar o GM em vez de falhar a criação inteira por causa deles.
        const groups = new Map<string, { count: number; visible: boolean }>();
        let ignored = data.tokenIds.length - tokens.length;
        for (const token of tokens) {
          const entryId = token.characterId ? characterById.get(token.characterId)?.compendiumEntryId : null;
          if (!entryId) {
            ignored++;
            continue;
          }
          const group = groups.get(entryId);
          if (group) group.count++;
          else groups.set(entryId, { count: 1, visible: token.visible });
        }
        if (groups.size === 0) throw new HandlerError("Nenhum token selecionado veio do compêndio");

        const entries = [...groups.entries()].map(([entryId, g]) => ({ entryId, count: g.count, visibleOnSpawn: g.visible, nameOverride: null }));
        const over = entries.find((e) => e.count > 20);
        if (over) throw new HandlerError(`Mais de 20 tokens da mesma criatura selecionados (máximo por entrada de encontro)`);

        const row = await prisma.savedEncounter.create({
          data: { roomId: ctx.roomId, name: data.name, tags: data.tags, notes: data.notes, entries: entriesJson(entries) },
        });
        const encounter = toEncounter(row);
        io.to(rooms.gm(ctx.roomId)).emit("encounter:created", encounter);
        return { encounter, ignoredTokens: ignored };
      },
      gmOnly,
    ),
  );

  socket.on(
    "encounter:update",
    guarded(
      socket,
      EncounterUpdateSchema,
      async ({ id, patch }, ctx) => {
        await requireEncounter(id, ctx.roomId);
        const row = await prisma.savedEncounter.update({
          where: { id },
          data: { name: patch.name, tags: patch.tags, notes: patch.notes, entries: patch.entries ? entriesJson(patch.entries) : undefined },
        });
        const encounter = toEncounter(row);
        io.to(rooms.gm(ctx.roomId)).emit("encounter:updated", encounter);
        return encounter;
      },
      gmOnly,
    ),
  );

  socket.on(
    "encounter:delete",
    guarded(
      socket,
      EncounterDeleteSchema,
      async ({ id }, ctx) => {
        await requireEncounter(id, ctx.roomId);
        await prisma.savedEncounter.update({ where: { id }, data: { deletedAt: new Date() } });
        io.to(rooms.gm(ctx.roomId)).emit("encounter:deleted", { id });
      },
      gmOnly,
    ),
  );

  socket.on(
    "encounter:spawn",
    guarded(
      socket,
      EncounterSpawnSchema,
      async (data, ctx) => {
        const encounterRow = await requireEncounter(data.id, ctx.roomId);
        const encounterEntries = encounterEntriesOf(encounterRow);

        const room = await prisma.room.findUnique({ where: { id: ctx.roomId } });
        if (!room) throw new HandlerError("Sala não encontrada");
        const sceneRow = await prisma.scene.findUnique({ where: { id: data.sceneId } });
        if (!sceneRow || sceneRow.roomId !== ctx.roomId || sceneRow.deletedAt !== null) throw new HandlerError("Mapa não encontrado");

        const def = getSystemDefinition(room.systemId);
        const { entries: compendiumEntries } = await listCompendium(room.systemId, room.id, "gm");
        const creatureById = new Map(
          compendiumEntries.filter((e): e is CompendiumCreatureEntry => e.type === "creature").map((e) => [e.id, e]),
        );

        const scene = toScene(sceneRow);
        const cellSize = effectiveCellSize(scene.grid);
        // Mesma conta de compendium:spawn-creature: mapa sem imagem usa o tamanho padrão do cliente.
        const map = { width: sceneRow.mapWidth ?? DEFAULT_MAP_SIZE.width, height: sceneRow.mapHeight ?? DEFAULT_MAP_SIZE.height };
        const bounds = { cols: Math.max(1, Math.ceil(map.width / cellSize)), rows: Math.max(1, Math.ceil(map.height / cellSize)) };

        const existingTokens = await prisma.token.findMany({ where: { sceneId: data.sceneId, deletedAt: null } });
        const occupied: CellRect[] = existingTokens.map((t) => cellRect(t, scene.grid));
        const start = cellAt({ x: data.x, y: data.y }, scene.grid);

        const { placements, missingIds } = expandEncounterEntries({
          encounterEntries,
          compendiumEntries,
          def,
          start,
          occupied,
          existingNames: existingTokens.map((t) => t.name),
          bounds,
        });

        const results: { character: Character; token: Token }[] = await prisma.$transaction(async (tx) => {
          const created: { character: Character; token: Token }[] = [];
          for (let i = 0; i < placements.length; i++) {
            const placement = placements[i]!;
            const creature = creatureById.get(placement.entryId);
            if (!creature) continue; // expandEncounterEntries só resolve entradas que existem no compêndio (o resto já foi pra missingIds)
            const point = cellToPoint({ col: placement.col, row: placement.row }, scene.grid);
            const copy = entryToCharacter(def, creature, randomUUID, { name: placement.name });
            const characterRow = await tx.character.create({
              data: { roomId: ctx.roomId, ownerId: null, name: copy.name, kind: copy.kind, data: toJson(copy.data), compendiumEntryId: creature.id },
            });
            const tokenRow = await tx.token.create({
              data: {
                sceneId: data.sceneId,
                name: placement.name,
                imageUrl: null,
                x: point.x,
                y: point.y,
                cells: placement.cellsPerSide,
                zIndex: existingTokens.length + i + 1,
                visible: placement.visible,
                ownerId: null,
                color: creatureColor(def, creature),
                characterId: characterRow.id,
              },
            });
            created.push({ character: toCharacter(characterRow), token: toToken(tokenRow) });
          }
          return created;
        });

        // Broadcast fora da transação, mesmo padrão de compendium:spawn-creature.
        for (const { character, token } of results) {
          broadcastCharacter(io, ctx.roomId, character, "character:created");
          broadcastToken(io, ctx.roomId, token, "token:created", sceneGeometry(scene));
        }

        // encounter:spawn já é gmOnly, então sempre empilha (uma entrada só pro encontro inteiro).
        if (results.length > 0) {
          const summary = describeEncounterSpawn(toEncounter(encounterRow).name);
          pushEntry(ctx.roomId, buildMultiSpawnHistoryEntry(io, ctx.roomId, data.sceneId, def, summary, results));
          emitHistoryUpdated(io, ctx.roomId);
        }

        return { tokens: results.map((r) => r.token), skippedEntryIds: missingIds };
      },
      gmOnly,
    ),
  );
}
