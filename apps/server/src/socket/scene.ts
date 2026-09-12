/**
 * Mapas de uma sala (docs/plano-mapas.md). `Scene` é o nome interno (modelo Prisma, eventos
 * `scene:*`); na UI e em toda mensagem que chega ao cliente é sempre "mapa" — "cena" continua
 * sendo a unidade de tempo de jogo em Tormenta20 (ver SPEC §1).
 */
import { Prisma } from "@prisma/client";
import type { Token as DbToken } from "@prisma/client";
import {
  DEFAULT_MAP_SIZE,
  EmptySchema,
  SceneActivateSchema,
  SceneCreateSchema,
  SceneDeleteSchema,
  SceneDuplicateSchema,
  SceneEnterSchema,
  SceneRenameSchema,
  SceneReorderSchema,
  SceneSetArrivalSchema,
  SceneSetMapSchema,
  SceneUpdateGridSchema,
  canDeleteScene,
  duplicateScene,
  duplicateSceneName,
  findFreeCells,
  nextSceneOrder,
  reorderScenes,
  type ArrivalPoint,
  type CellRect,
  type CharacterKind,
  type CombatStatus,
  type GridConfig,
  type Scene,
  type SceneDeleteResult,
  type SceneListItem,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { requireSystem } from "../services/characters.js";
import { emitCombat, loadCombatRow, removeTokenFromSceneCombat, toCombat } from "../services/combat.js";
import { cellAt, cellRect, cellToPoint, effectiveCellSize, resnapTokenPosition, sceneGeometry } from "../services/grid.js";
import { reanchorActiveCombatant } from "../services/movement.js";
import { pushEntry, type HistoryEntry } from "../services/history.js";
import { toScene, toToken } from "../services/serialize.js";
import { clearTemplates, listTemplates } from "../services/templates.js";
import { redactTokenForViewer, tokenVisibleTo } from "../services/visibility.js";
import { pinVisibleTo, toPin } from "../services/pins.js";
import { clearSceneTargets } from "../services/targets.js";
import { guarded, HandlerError } from "./ack.js";
import { emitHistoryUpdated } from "./history.js";
import { clearPlayerTargetsOnActivate } from "./targets.js";
import { broadcastToken } from "./token.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

/**
 * Existe, não está apagado e é desta sala. É a checagem que sustenta o invariante "`activeSceneId`
 * sempre aponta pra um mapa vivo da sala" (docs/plano-mapas.md §15): `scene:activate` só troca o
 * ativo pra um mapa que passa aqui (via `requireScene`); do outro lado, `scene:delete` nunca deixa
 * apagar o mapa que já é o ativo (`canDeleteScene`, packages/shared) — as duas pontas juntas
 * garantem que o invariante nunca quebra. Separada de `requireScene` pra testar sem banco.
 */
export function isLiveSceneInRoom(scene: { roomId: string; deletedAt: Date | null } | null, roomId: string): boolean {
  return scene !== null && scene.roomId === roomId && scene.deletedAt === null;
}

/** Garante que o mapa existe, não está apagado e pertence à sala do socket. */
export async function requireScene(sceneId: string, roomId: string) {
  const scene = await prisma.scene.findUnique({ where: { id: sceneId } });
  if (!isLiveSceneInRoom(scene, roomId)) throw new HandlerError("Mapa não encontrado");
  return scene!;
}

/**
 * Onde `count` (aqui sempre 1 por token, chamada em loop) tokens caem no mapa de destino: mesma
 * espiral do spawn de criaturas (`findFreeCells`), a partir de `destScene.arrival ?? dropPoint ??
 * centro do mapa`, pulando os tokens que já estão lá E os que a própria função já posicionou nesta
 * chamada (pra dois tokens movidos juntos não caírem um em cima do outro). Como `cells` (fonte da
 * verdade do tamanho, docs/plano-grid.md) não muda ao trocar de mapa, não há mais tamanho pra
 * converter aqui — só a posição, em células do grid de DESTINO. Devolve o ponto de cada token, na
 * mesma ordem de `tokenRows`.
 */
async function placeTokensAtArrival(
  destScene: Scene,
  tokenRows: Pick<DbToken, "id" | "cells">[],
  dropPoint: ArrivalPoint | null | undefined,
): Promise<Map<string, { x: number; y: number }>> {
  const destGrid = destScene.grid;
  const destCellSize = effectiveCellSize(destGrid);
  const destExisting = await prisma.token.findMany({ where: { sceneId: destScene.id, deletedAt: null } });
  let occupied: CellRect[] = destExisting.map((t) => cellRect(t, destGrid));
  const destMap = { width: destScene.mapWidth ?? DEFAULT_MAP_SIZE.width, height: destScene.mapHeight ?? DEFAULT_MAP_SIZE.height };
  const bounds = { cols: Math.max(1, Math.ceil(destMap.width / destCellSize)), rows: Math.max(1, Math.ceil(destMap.height / destCellSize)) };
  const arrivalPoint = destScene.arrival ?? dropPoint ?? { x: destMap.width / 2, y: destMap.height / 2 };
  const startCell = cellAt(arrivalPoint, destGrid);

  const points = new Map<string, { x: number; y: number }>();
  for (const row of tokenRows) {
    const [pos] = findFreeCells({ start: startCell, cells: row.cells, count: 1, occupied, bounds });
    // Estourou o raio máximo (12 anéis): cai no próprio ponto de chegada, nunca fora do mapa
    // (mesmo comportamento de compendium:spawn-creature).
    const point = pos ? cellToPoint(pos, destGrid) : arrivalPoint;
    if (pos) occupied = [...occupied, { ...pos, cells: row.cells }];
    points.set(row.id, point);
  }
  return points;
}

interface SceneDeleteMoveTarget {
  sceneId: string;
  x: number;
  y: number;
}

export interface SceneDeleteMove {
  tokenId: string;
  before: SceneDeleteMoveTarget;
  after: SceneDeleteMoveTarget;
}

/**
 * Pra onde um token movido ao apagar mapa deve ir em cada direção: `revert` (undo) devolve
 * `before` (posição/mapa de origem); `apply` (redo) refaz `after`. Só posição — `cells` (tamanho,
 * docs/plano-grid.md) nunca muda ao trocar de mapa. Extraída pra testar sem banco que as duas
 * metades de `buildSceneDeleteHistoryEntry` não trocam a direção entre si — um copy-paste errado
 * aqui moveria o token pro lado contrário do esperado (docs/plano-mapas.md §15).
 */
export function sceneDeleteMoveTarget(move: SceneDeleteMove, direction: "revert" | "apply"): SceneDeleteMoveTarget {
  return direction === "revert" ? move.before : move.after;
}

/**
 * Entrada de histórico de apagar mapa (docs/plano-mapas.md §10.3) — a ÚNICA ação de mapa que entra
 * na pilha de desfazer. `revert`: `deletedAt = null` + devolve cada token movido à posição/mapa de
 * origem. `apply` (redo): reconfere que o mapa ativo não mudou desde então (senão a entrada é
 * descartada, mesmo padrão do resto do histórico) e refaz a mesma mudança de mapa + `deletedAt`.
 */
function buildSceneDeleteHistoryEntry(
  io: TypedServer,
  roomId: string,
  sceneId: string,
  sceneName: string,
  activeSceneIdAtDelete: string,
  moves: SceneDeleteMove[],
): HistoryEntry {
  return {
    summary: `apagar o mapa "${sceneName}"`,
    async revert() {
      const sceneRow = await prisma.scene.findUnique({ where: { id: sceneId } });
      if (!sceneRow || sceneRow.deletedAt === null) throw new Error(`o mapa "${sceneName}" não está mais apagado`);
      const reopened = toScene(await prisma.scene.update({ where: { id: sceneId }, data: { deletedAt: null } }));
      io.to(rooms.all(roomId)).emit("scene:updated", reopened);

      const affectedScenes = new Set<string>([sceneId]);
      for (const move of moves) {
        const row = await prisma.token.findUnique({ where: { id: move.tokenId } });
        if (!row || row.deletedAt !== null) throw new Error("um token movido não existe mais");
        const target = sceneDeleteMoveTarget(move, "revert");
        const scene = await prisma.scene.findUniqueOrThrow({ where: { id: target.sceneId } });
        const updated = toToken(
          await prisma.token.update({ where: { id: move.tokenId }, data: { sceneId: target.sceneId, x: target.x, y: target.y } }),
        );
        broadcastToken(io, roomId, updated, "token:updated", sceneGeometry(toScene(scene)));
        affectedScenes.add(move.after.sceneId);
      }
      for (const sid of affectedScenes) await emitCombat(io, roomId, sid, { role: "gm", participantId: "" });
    },
    async apply() {
      const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
      if (room.activeSceneId !== activeSceneIdAtDelete) throw new Error("o mapa ativo mudou desde então");
      const sceneRow = await prisma.scene.findUnique({ where: { id: sceneId } });
      if (!sceneRow || sceneRow.deletedAt !== null) throw new Error(`o mapa "${sceneName}" não existe mais`);

      const affectedScenes = new Set<string>();
      for (const move of moves) {
        const row = await prisma.token.findUnique({ where: { id: move.tokenId } });
        if (!row || row.deletedAt !== null) throw new Error("um token movido não existe mais");
        const target = sceneDeleteMoveTarget(move, "apply");
        const scene = await prisma.scene.findUniqueOrThrow({ where: { id: target.sceneId } });
        const updated = toToken(
          await prisma.token.update({ where: { id: move.tokenId }, data: { sceneId: target.sceneId, x: target.x, y: target.y } }),
        );
        broadcastToken(io, roomId, updated, "token:updated", sceneGeometry(toScene(scene)));
        affectedScenes.add(move.before.sceneId);
      }
      await prisma.scene.update({ where: { id: sceneId }, data: { deletedAt: new Date() } });
      io.to(rooms.all(roomId)).emit("scene:deleted", { sceneId });
      affectedScenes.add(sceneId);
      for (const sid of affectedScenes) await emitCombat(io, roomId, sid, { role: "gm", participantId: "" });
    },
  };
}

interface GridTokenMove {
  tokenId: string;
  before: { x: number; y: number };
  after: { x: number; y: number };
}

/**
 * Entrada de histórico de trocar o grid de um mapa (docs/plano-mapas.md): `revert` devolve o grid
 * anterior e a posição/tamanho de cada token que foi reencaixado por causa da troca; `apply`
 * (redo) refaz os dois juntos — nunca só um dos dois, senão o grid e os tokens ficam
 * inconsistentes entre si. Só é empilhada quando a troca de fato reencaixou algum token
 * (`moves.length > 0`, ver `scene:updateGrid`) — cor/`snap` sozinhos continuam triviais de
 * desfazer à mão (§9.6 do SPEC).
 */
function buildUpdateGridHistoryEntry(
  io: TypedServer,
  roomId: string,
  sceneId: string,
  sceneName: string,
  beforeGrid: GridConfig,
  afterGrid: GridConfig,
  moves: GridTokenMove[],
): HistoryEntry {
  async function writeGrid(grid: GridConfig): Promise<Scene> {
    const sceneRow = await prisma.scene.findUnique({ where: { id: sceneId } });
    if (!sceneRow || sceneRow.deletedAt !== null) throw new Error("o mapa não existe mais");
    const scene = toScene(await prisma.scene.update({ where: { id: sceneId }, data: { grid } }));
    io.to(rooms.all(roomId)).emit("scene:updated", scene);
    return scene;
  }
  async function writeMoves(scene: Scene, pick: (m: GridTokenMove) => GridTokenMove["before"]): Promise<void> {
    for (const move of moves) {
      const row = await prisma.token.findUnique({ where: { id: move.tokenId } });
      if (!row || row.deletedAt !== null) throw new Error("um token reencaixado não existe mais");
      const updated = toToken(await prisma.token.update({ where: { id: move.tokenId }, data: pick(move) }));
      broadcastToken(io, roomId, updated, "token:updated", sceneGeometry(scene));
    }
  }
  return {
    summary: `ajustar o grid do mapa "${sceneName}"`,
    async revert() {
      await writeMoves(await writeGrid(beforeGrid), (m) => m.before);
    },
    async apply() {
      await writeMoves(await writeGrid(afterGrid), (m) => m.after);
    },
  };
}

export function registerSceneHandlers(io: TypedServer, socket: TypedSocket): void {
  const gmOnly = { gmOnly: true };

  socket.on(
    "scene:create",
    guarded(
      socket,
      SceneCreateSchema,
      async ({ name, mapUrl, mapWidth, mapHeight }, ctx) => {
        const siblings = await prisma.scene.findMany({ where: { roomId: ctx.roomId, deletedAt: null }, select: { order: true } });
        const scene = toScene(
          await prisma.scene.create({
            data: { roomId: ctx.roomId, name, order: nextSceneOrder(siblings), mapUrl: mapUrl ?? null, mapWidth: mapWidth ?? null, mapHeight: mapHeight ?? null },
          }),
        );
        io.to(rooms.all(ctx.roomId)).emit("scene:created", scene);
        return scene;
      },
      gmOnly,
    ),
  );

  socket.on(
    "scene:activate",
    guarded(
      socket,
      SceneActivateSchema,
      async ({ sceneId, moveTokenIds = [], dropPoint }, ctx) => {
        const destScene = toScene(await requireScene(sceneId, ctx.roomId));
        const room = await prisma.room.findUniqueOrThrow({ where: { id: ctx.roomId } });
        const originSceneId = room.activeSceneId;

        const uniqueMoveIds = [...new Set(moveTokenIds)];
        if (uniqueMoveIds.length > 0) {
          if (!originSceneId) throw new HandlerError("Não há mapa ativo para levar tokens dele");
          const rows = await prisma.token.findMany({ where: { id: { in: uniqueMoveIds }, sceneId: originSceneId, deletedAt: null } });
          if (rows.length !== uniqueMoveIds.length) throw new HandlerError("Token não encontrado no mapa ativo atual");

          const def = await requireSystem(ctx.roomId);
          const points = await placeTokensAtArrival(destScene, rows, dropPoint);
          // Ativa o mapa novo ANTES de emitir: assim os broadcasts de token abaixo já refletem
          // "o destino é o mapa ativo" (jogadores que vão seguir pra lá recebem os tokens levados).
          await prisma.room.update({ where: { id: ctx.roomId }, data: { activeSceneId: sceneId } });
          for (const row of rows) {
            await removeTokenFromSceneCombat(def, originSceneId, row.id);
            const point = points.get(row.id)!;
            const updated = toToken(
              await prisma.token.update({
                where: { id: row.id },
                data: { sceneId, x: point.x, y: point.y },
              }),
            );
            broadcastToken(io, ctx.roomId, updated, "token:updated", sceneGeometry(destScene));
          }
          // O combate de origem pode ter perdido combatentes (ou sumido de vez, se ficou vazio) —
          // não é encerrado (§7.6), só reemitido com a lista atual.
          await emitCombat(io, ctx.roomId, originSceneId, { role: "gm", participantId: "" });
        } else {
          await prisma.room.update({ where: { id: ctx.roomId }, data: { activeSceneId: sceneId } });
        }

        io.to(rooms.all(ctx.roomId)).emit("room:activeSceneChanged", { sceneId });
        // Mapa ativo mudou: os alvos dos jogadores (do mapa anterior) deixam de fazer sentido —
        // o GM mantém os dele, pode estar preparando o próximo (docs/plano-alvos.md §2.2).
        await clearPlayerTargetsOnActivate(io, ctx.roomId);
      },
      gmOnly,
    ),
  );

  socket.on(
    "scene:enter",
    guarded(socket, SceneEnterSchema, async ({ sceneId }, ctx) => {
      const sceneRow = await requireScene(sceneId, ctx.roomId);
      if (ctx.role === "player") {
        const room = await prisma.room.findUniqueOrThrow({ where: { id: ctx.roomId } });
        if (room.activeSceneId !== sceneId) throw new HandlerError("Este mapa não está ativo");
      }
      const scene = toScene(sceneRow);
      const geom = sceneGeometry(scene);
      const viewer = { role: ctx.role, participantId: ctx.participantId };
      const [tokenRows, combatRow, def, pinRows] = await Promise.all([
        prisma.token.findMany({ where: { sceneId, deletedAt: null }, orderBy: { zIndex: "asc" } }),
        loadCombatRow(sceneId),
        requireSystem(ctx.roomId),
        prisma.pin.findMany({ where: { sceneId, deletedAt: null } }),
      ]);
      const tokens = tokenRows
        .map(toToken)
        .filter((t) => tokenVisibleTo(t, viewer, geom))
        .map((t) => redactTokenForViewer(t, viewer));
      const combat = combatRow ? toCombat(combatRow, def, viewer, geom) : null;
      const pins = pinRows.map(toPin).filter((p) => pinVisibleTo(p, viewer, sceneId));
      return { tokens, combat, templates: listTemplates(sceneId), pins };
    }),
  );

  socket.on(
    "scene:rename",
    guarded(
      socket,
      SceneRenameSchema,
      async ({ sceneId, name }, ctx) => {
        await requireScene(sceneId, ctx.roomId);
        const scene = toScene(await prisma.scene.update({ where: { id: sceneId }, data: { name } }));
        io.to(rooms.all(ctx.roomId)).emit("scene:updated", scene);
        return scene;
      },
      gmOnly,
    ),
  );

  socket.on(
    "scene:duplicate",
    guarded(
      socket,
      SceneDuplicateSchema,
      async ({ sceneId, name }, ctx) => {
        const original = toScene(await requireScene(sceneId, ctx.roomId));
        const siblings = await prisma.scene.findMany({ where: { roomId: ctx.roomId, deletedAt: null } });
        const finalName = name ?? duplicateSceneName(siblings.map((s) => s.name), original.name);
        // A cópia entra logo depois do original (§12): os que vinham depois sobem uma casa.
        const insertOrder = original.order + 1;
        const draft = duplicateScene(original, { id: "pending", name: finalName, order: insertOrder, createdAt: new Date(0).toISOString() });

        const createdRow = await prisma.$transaction(async (tx) => {
          await tx.scene.updateMany({ where: { roomId: ctx.roomId, deletedAt: null, order: { gte: insertOrder } }, data: { order: { increment: 1 } } });
          return tx.scene.create({
            data: {
              roomId: ctx.roomId,
              name: draft.name,
              mapUrl: draft.mapUrl,
              mapWidth: draft.mapWidth,
              mapHeight: draft.mapHeight,
              grid: draft.grid,
              fog: draft.fog,
              arrival: draft.arrival === null ? Prisma.JsonNull : draft.arrival,
              order: insertOrder,
            },
          });
        });
        const scene = toScene(createdRow);
        io.to(rooms.all(ctx.roomId)).emit("scene:created", scene);
        return scene;
      },
      gmOnly,
    ),
  );

  socket.on(
    "scene:delete",
    guarded(
      socket,
      SceneDeleteSchema,
      async ({ sceneId, confirmMovePlayerTokens }, ctx): Promise<SceneDeleteResult> => {
        const sceneRow = await requireScene(sceneId, ctx.roomId);
        const room = await prisma.room.findUniqueOrThrow({ where: { id: ctx.roomId } });
        const [allScenes, tokens, characters] = await Promise.all([
          prisma.scene.findMany({ where: { roomId: ctx.roomId, deletedAt: null }, select: { id: true } }),
          prisma.token.findMany({ where: { sceneId, deletedAt: null } }),
          prisma.character.findMany({ where: { roomId: ctx.roomId }, select: { id: true, kind: true } }),
        ]);

        const check = canDeleteScene({
          sceneId,
          activeSceneId: room.activeSceneId,
          sceneCount: allScenes.length,
          tokens: tokens.map((t) => ({ id: t.id, ownerId: t.ownerId, characterId: t.characterId })),
          characters: characters.map((c) => ({ id: c.id, kind: c.kind as CharacterKind })),
        });

        let playerTokenIds: string[] = [];
        if (!check.ok) {
          if ("blocked" in check) {
            throw new HandlerError(check.blocked === "active" ? "Ative outro mapa antes de apagar este." : "A sala precisa de pelo menos um mapa.");
          }
          if (!confirmMovePlayerTokens) return { status: "needs-confirm", playerTokenIds: check.playerTokenIds };
          playerTokenIds = check.playerTokenIds;
        }

        // Invariante do §3: com sceneCount > 1 e este mapa não sendo o ativo, o ativo é "outro
        // mapa" — o destino natural dos tokens de jogador que ficariam presos num mapa apagado.
        const destSceneId = room.activeSceneId!;
        const moves: SceneDeleteMove[] = [];
        if (playerTokenIds.length > 0) {
          const def = await requireSystem(ctx.roomId);
          const destScene = toScene(await prisma.scene.findUniqueOrThrow({ where: { id: destSceneId } }));
          const movingRows = tokens.filter((t) => playerTokenIds.includes(t.id));
          const points = await placeTokensAtArrival(destScene, movingRows, null);
          for (const row of movingRows) {
            const before = { sceneId: row.sceneId, x: row.x, y: row.y };
            await removeTokenFromSceneCombat(def, sceneId, row.id);
            const point = points.get(row.id)!;
            const updated = toToken(
              await prisma.token.update({
                where: { id: row.id },
                data: { sceneId: destSceneId, x: point.x, y: point.y },
              }),
            );
            broadcastToken(io, ctx.roomId, updated, "token:updated", sceneGeometry(destScene));
            moves.push({ tokenId: row.id, before, after: { sceneId: destSceneId, ...point } });
          }
        }

        await prisma.scene.update({ where: { id: sceneId }, data: { deletedAt: new Date() } });
        io.to(rooms.all(ctx.roomId)).emit("scene:deleted", { sceneId });
        // Gabaritos são efêmeros e nunca voltam (docs/plano-gabaritos.md): diferente de token/combate,
        // não têm undo — o mapa apagado nem entra de novo na pilha de desfazer com eles.
        clearTemplates(sceneId);
        // Idem para alvos apontando pro mapa apagado (docs/plano-alvos.md): sem chamador do lado do
        // cliente pra saber que sumiram, mas nada renderiza um mapa que não existe mais.
        clearSceneTargets(ctx.roomId, sceneId);
        if (moves.length > 0) await emitCombat(io, ctx.roomId, sceneId, { role: "gm", participantId: ctx.participantId });

        pushEntry(ctx.roomId, buildSceneDeleteHistoryEntry(io, ctx.roomId, sceneId, sceneRow.name, destSceneId, moves));
        emitHistoryUpdated(io, ctx.roomId);

        return { status: "deleted" };
      },
      gmOnly,
    ),
  );

  socket.on(
    "scene:reorder",
    guarded(
      socket,
      SceneReorderSchema,
      async ({ sceneIds }, ctx) => {
        const current = await prisma.scene.findMany({ where: { roomId: ctx.roomId, deletedAt: null }, select: { id: true } });
        const result = reorderScenes(current, sceneIds);
        if (!result.ok) throw new HandlerError(result.error);
        await prisma.$transaction(result.order.map((o) => prisma.scene.update({ where: { id: o.sceneId }, data: { order: o.order } })));
        io.to(rooms.all(ctx.roomId)).emit("scene:reordered", { order: result.order });
        return { order: result.order };
      },
      gmOnly,
    ),
  );

  socket.on(
    "scene:setArrival",
    guarded(
      socket,
      SceneSetArrivalSchema,
      async ({ sceneId, arrival }, ctx) => {
        await requireScene(sceneId, ctx.roomId);
        const scene = toScene(await prisma.scene.update({ where: { id: sceneId }, data: { arrival: arrival === null ? Prisma.JsonNull : arrival } }));
        io.to(rooms.all(ctx.roomId)).emit("scene:updated", scene);
        return scene;
      },
      gmOnly,
    ),
  );

  socket.on(
    "scene:list",
    guarded(
      socket,
      EmptySchema,
      async (_input, ctx) => {
        const scenes = await prisma.scene.findMany({ where: { roomId: ctx.roomId, deletedAt: null } });
        const items: SceneListItem[] = await Promise.all(
          scenes.map(async (s) => {
            const [tokenCount, playerTokenCount, combat] = await Promise.all([
              prisma.token.count({ where: { sceneId: s.id, deletedAt: null } }),
              prisma.token.count({ where: { sceneId: s.id, deletedAt: null, ownerId: { not: null } } }),
              prisma.combat.findUnique({ where: { sceneId: s.id }, select: { status: true } }),
            ]);
            return { sceneId: s.id, tokenCount, playerTokenCount, combatStatus: (combat?.status as CombatStatus | undefined) ?? null };
          }),
        );
        return { items };
      },
      gmOnly,
    ),
  );

  socket.on(
    "scene:setMap",
    guarded(socket, SceneSetMapSchema, async ({ sceneId, mapUrl, mapWidth, mapHeight }, ctx) => {
      await requireScene(sceneId, ctx.roomId);
      const scene = toScene(
        await prisma.scene.update({ where: { id: sceneId }, data: { mapUrl, mapWidth, mapHeight } }),
      );
      io.to(rooms.all(ctx.roomId)).emit("scene:updated", scene);
      return scene;
    }, gmOnly),
  );

  socket.on(
    "scene:updateGrid",
    guarded(socket, SceneUpdateGridSchema, async ({ sceneId, grid }, ctx) => {
      const current = toScene(await requireScene(sceneId, ctx.roomId));
      // Merge parcial: só os campos enviados mudam.
      const merged = { ...current.grid, ...grid };

      // cellSize/offset (ou o tipo) pode ter mudado de um jeito que afeta a geometria — reencaixa
      // a posição de cada token da cena pra continuar na mesma célula, grudado dentro do mapa
      // (`resnapTokenPosition`, services/grid.ts): sem isso, os tokens ficariam desalinhados do
      // grid novo, ou fora do mapa se a célula nova empurrasse um token que já estava na borda
      // (docs/revisao-grid.md §2). `cells` (tamanho, docs/plano-grid.md) nunca precisa mudar aqui:
      // já é sempre `cells × cellSize do grid ATUAL`. Um patch que só muda cor/`snap` não move
      // token nenhum (`resnapTokenPosition` devolve a mesma referência), então isto não tem custo
      // nesse caso além da própria consulta.
      const map = { width: current.mapWidth ?? DEFAULT_MAP_SIZE.width, height: current.mapHeight ?? DEFAULT_MAP_SIZE.height };
      const tokenRows = await prisma.token.findMany({ where: { sceneId, deletedAt: null } });
      const moves: GridTokenMove[] = [];
      for (const row of tokenRows) {
        const resnapped = resnapTokenPosition(row, current.grid, merged, map);
        if (resnapped === row) continue;
        moves.push({
          tokenId: row.id,
          before: { x: row.x, y: row.y },
          after: { x: resnapped.x, y: resnapped.y },
        });
      }

      const scene = toScene(await prisma.scene.update({ where: { id: sceneId }, data: { grid: merged } }));
      io.to(rooms.all(ctx.roomId)).emit("scene:updated", scene);
      for (const move of moves) {
        const updated = toToken(await prisma.token.update({ where: { id: move.tokenId }, data: move.after }));
        broadcastToken(io, ctx.roomId, updated, "token:updated", sceneGeometry(scene));
        // O token pulou de pixel sem passar por token:update (checkMovement nunca viu isto): se é o
        // combatente da vez, a âncora do orçamento de deslocamento precisa acompanhar (docs/revisao-movimento.md).
        await reanchorActiveCombatant(sceneId, move.tokenId, move.after.x, move.after.y);
      }

      // Reencaixar tokens não é trivial de desfazer à mão (diferente de só mudar cor/snap) —
      // ganha uma entrada de histórico só quando isso de fato aconteceu.
      if (moves.length > 0) {
        pushEntry(ctx.roomId, buildUpdateGridHistoryEntry(io, ctx.roomId, sceneId, current.name, current.grid, merged, moves));
        emitHistoryUpdated(io, ctx.roomId);
      }

      return scene;
    }, gmOnly),
  );
}
