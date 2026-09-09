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
  type SystemDefinition,
  type Token,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { listCompendium } from "../services/compendium.js";
import { broadcastCharacter, characterDataOf, toCharacter, toJson } from "../services/characters.js";
import { cellAt, cellRect, cellToPoint, effectiveCellSize } from "../services/grid.js";
import { describeSpawn, pushEntry, type HistoryEntry } from "../services/history.js";
import { emitCombat } from "../services/combat.js";
import { toScene, toToken } from "../services/serialize.js";
import { guarded, HandlerError } from "./ack.js";
import { emitHistoryUpdated } from "./history.js";
import { adjustCombatForTokenRemoval, broadcastToken, hpJson } from "./token.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

/**
 * Desfazer o spawn (docs/plano-desfazer.md §4): diferente de token:delete (soft delete), aqui é
 * HARD delete — cópias recém-criadas, sem histórico próprio ainda (dano recebido, condições...),
 * então apagar de vez é seguro e não precisa esticar o conceito de "lixeira com prazo" pra
 * Character (que não tem deletedAt). O redo recria as MESMAS linhas (mesmos ids) a partir do
 * snapshot capturado na hora do spawn.
 */
function buildSpawnHistoryEntry(
  io: TypedServer,
  roomId: string,
  sceneId: string,
  def: SystemDefinition,
  creatureName: string,
  results: { character: Character; token: Token }[],
): HistoryEntry {
  return {
    summary: describeSpawn(results.length, creatureName),
    async revert() {
      // Um token spawnado pode ter entrado num combate depois (combat:add, manual — spawn nunca
      // entra sozinho, §9.5): mesmo ajuste de round/activeCombatantId/order de sempre ANTES do hard
      // delete (o snapshot devolvido não serve pra nada aqui — não tem "restaurar" num hard delete,
      // só evita o combate ficar com um combatente fantasma).
      let combatAffected = false;
      for (const { token } of results) {
        if (await adjustCombatForTokenRemoval(def, token.sceneId, token.id)) combatAffected = true;
      }
      const tokenIds = results.map((r) => r.token.id);
      const characterIds = results.map((r) => r.character.id);
      await prisma.token.deleteMany({ where: { id: { in: tokenIds } } });
      await prisma.character.deleteMany({ where: { id: { in: characterIds } } });
      for (const { token, character } of results) {
        io.to(rooms.all(roomId)).emit("token:deleted", { tokenId: token.id });
        // Mesmo padrão de character:delete (socket/character.ts): broadcast geral, sem vazar nada
        // (é só o id) — jogador nunca teve o NPC no cache, então o remove() dele é um no-op.
        io.to(rooms.all(roomId)).emit("character:deleted", { characterId: character.id });
      }
      if (combatAffected) await emitCombat(io, roomId, sceneId, { role: "gm", participantId: "" });
    },
    async apply() {
      const scene = await prisma.scene.findUniqueOrThrow({ where: { id: sceneId } });
      const fog = toScene(scene).fog;
      for (const { character, token } of results) {
        const characterRow = await prisma.character.create({
          data: { id: character.id, roomId: character.roomId, ownerId: character.ownerId, name: character.name, kind: character.kind, data: toJson(characterDataOf(character)) },
        });
        const tokenRow = await prisma.token.create({
          data: {
            id: token.id,
            sceneId: token.sceneId,
            name: token.name,
            imageUrl: token.imageUrl,
            x: token.x,
            y: token.y,
            width: token.width,
            height: token.height,
            rotation: token.rotation,
            zIndex: token.zIndex,
            visible: token.visible,
            ownerId: token.ownerId,
            color: token.color,
            characterId: token.characterId,
            hp: hpJson(token.hp),
            conditions: token.conditions,
          },
        });
        broadcastCharacter(io, roomId, toCharacter(characterRow), "character:created");
        broadcastToken(io, roomId, toToken(tokenRow), "token:created", fog);
      }
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

        // compendium:spawn-creature já é gmOnly (guarded abaixo), então sempre empilha.
        if (results.length > 0) {
          pushEntry(ctx.roomId, buildSpawnHistoryEntry(io, ctx.roomId, data.sceneId, def, entry.name, results));
          emitHistoryUpdated(io, ctx.roomId);
        }

        return results.map((r) => r.token);
      },
      { gmOnly: true },
    ),
  );
}
