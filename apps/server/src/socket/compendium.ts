import { randomUUID } from "node:crypto";
import {
  CompendiumSpawnCreatureSchema,
  DEFAULT_MAP_SIZE,
  EmptySchema,
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
import { broadcastCharacter, toCharacter, toJson } from "../services/characters.js";
import { cellAt, cellRect, cellToPoint, effectiveCellSize } from "../services/grid.js";
import { toScene, toToken } from "../services/serialize.js";
import { guarded, HandlerError } from "./ack.js";
import { broadcastToken } from "./token.js";
import type { TypedServer, TypedSocket } from "./types.js";

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
        if (!sceneRow || sceneRow.roomId !== ctx.roomId) throw new HandlerError("Cena não encontrada");

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

        const existingTokens = await prisma.token.findMany({ where: { sceneId: data.sceneId } });
        const occupied: CellRect[] = existingTokens.map((t) => cellRect(t, scene.grid));
        // Lado em células: arredonda pro grid (tokenCells pode ser fracionário, ex.: Minúsculo =
        // 0,5) — a espiral trabalha em células inteiras; o token continua com o tamanho exato em
        // pixels (width/height abaixo), só a RESERVA na espiral vira 1 célula no mínimo.
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
              data: { roomId: ctx.roomId, ownerId: null, name: copy.name, kind: copy.kind, data: toJson(copy.data) },
            });
            const tokenRow = await tx.token.create({
              data: {
                sceneId: data.sceneId,
                name,
                imageUrl: null,
                x: point.x,
                y: point.y,
                width: cellsPerSide * cellSize,
                height: cellsPerSide * cellSize,
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
          broadcastToken(io, ctx.roomId, token, "token:created", scene.fog);
        }

        return results.map((r) => r.token);
      },
      { gmOnly: true },
    ),
  );
}
