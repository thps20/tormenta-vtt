/**
 * Acervo da sala (docs/plano-preparo.md §1): `asset:*` (mapa/token/áudio) e `library:*`
 * (favoritos, funciona sobre asset/handout/encontro/criatura/macro). Só o GM: tudo `gmOnly`,
 * broadcast só pra `rooms.gm` — igual socket/handout.ts.
 */
import { AssetCreateSchema, AssetDeleteSchema, AssetUpdateSchema, EmptySchema, LibraryFavoriteSetSchema, type AssetKind } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { pushEntry, type HistoryEntry } from "../services/history.js";
import { canChangeAssetKind, requireAsset, toAsset, toLibraryFavorite } from "../services/library.js";
import { guarded, HandlerError } from "./ack.js";
import { emitHistoryUpdated } from "./history.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

const gmOnly = { gmOnly: true };

async function listFavorites(roomId: string) {
  const rows = await prisma.libraryFavorite.findMany({ where: { roomId }, orderBy: { createdAt: "asc" } });
  return rows.map(toLibraryFavorite);
}

/** `asset:delete`: soft delete + desfazer (mesmo padrão de buildHandoutDeleteHistoryEntry). Ao
 *  contrário do handout, um asset apagado não arrasta pino/passo de preparo nenhum aqui — quem
 *  referencia (PrepItem, etapa 3) resolve a referência quebrada sozinho (§2.6 do plano). */
function buildAssetDeleteHistoryEntry(io: TypedServer, roomId: string, assetId: string, assetName: string): HistoryEntry {
  return {
    summary: `apagar do acervo "${assetName}"`,
    async revert() {
      const row = await prisma.asset.findUnique({ where: { id: assetId } });
      if (!row || row.deletedAt === null) throw new Error(`o item "${assetName}" não está mais apagado`);
      const asset = toAsset(await prisma.asset.update({ where: { id: assetId }, data: { deletedAt: null } }));
      io.to(rooms.gm(roomId)).emit("asset:created", asset);
    },
    async apply() {
      const row = await prisma.asset.findUnique({ where: { id: assetId } });
      if (!row || row.deletedAt !== null) throw new Error(`o item "${assetName}" não existe mais`);
      await prisma.asset.update({ where: { id: assetId }, data: { deletedAt: new Date() } });
      io.to(rooms.gm(roomId)).emit("asset:deleted", { id: assetId });
    },
  };
}

export function registerLibraryHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "asset:list",
    guarded(
      socket,
      EmptySchema,
      async (_input, ctx) => {
        const rows = await prisma.asset.findMany({ where: { roomId: ctx.roomId, deletedAt: null }, orderBy: { createdAt: "asc" } });
        return rows.map(toAsset);
      },
      gmOnly,
    ),
  );

  socket.on(
    "asset:create",
    guarded(
      socket,
      AssetCreateSchema,
      async (data, ctx) => {
        const asset = toAsset(
          await prisma.asset.create({
            data: {
              roomId: ctx.roomId,
              kind: data.kind,
              name: data.name,
              url: data.url,
              tags: data.tags,
              width: data.kind === "map" || data.kind === "token" ? data.width : null,
              height: data.kind === "map" || data.kind === "token" ? data.height : null,
              durationMs: data.kind === "audio" ? data.durationMs : null,
            },
          }),
        );
        io.to(rooms.gm(ctx.roomId)).emit("asset:created", asset);
        return asset;
      },
      gmOnly,
    ),
  );

  socket.on(
    "asset:update",
    guarded(
      socket,
      AssetUpdateSchema,
      async ({ id, patch }, ctx) => {
        const row = await requireAsset(id, ctx.roomId);
        if (!canChangeAssetKind(row.kind as AssetKind, patch.kind)) throw new HandlerError("Não é possível trocar o tipo de um áudio");
        const asset = toAsset(await prisma.asset.update({ where: { id }, data: patch }));
        io.to(rooms.gm(ctx.roomId)).emit("asset:updated", asset);
        return asset;
      },
      gmOnly,
    ),
  );

  socket.on(
    "asset:delete",
    guarded(
      socket,
      AssetDeleteSchema,
      async ({ id }, ctx) => {
        const row = await requireAsset(id, ctx.roomId);
        await prisma.asset.update({ where: { id }, data: { deletedAt: new Date() } });
        io.to(rooms.gm(ctx.roomId)).emit("asset:deleted", { id });
        pushEntry(ctx.roomId, buildAssetDeleteHistoryEntry(io, ctx.roomId, id, row.name));
        emitHistoryUpdated(io, ctx.roomId);
      },
      gmOnly,
    ),
  );

  socket.on(
    "library:favorites",
    guarded(
      socket,
      EmptySchema,
      async (_input, ctx) => listFavorites(ctx.roomId),
      gmOnly,
    ),
  );

  socket.on(
    "library:favorite-set",
    guarded(
      socket,
      LibraryFavoriteSetSchema,
      async ({ refKind, refId, favorite }, ctx) => {
        if (favorite) {
          await prisma.libraryFavorite.upsert({
            where: { roomId_refKind_refId: { roomId: ctx.roomId, refKind, refId } },
            create: { roomId: ctx.roomId, refKind, refId },
            update: {},
          });
        } else {
          await prisma.libraryFavorite.deleteMany({ where: { roomId: ctx.roomId, refKind, refId } });
        }
        const favorites = await listFavorites(ctx.roomId);
        io.to(rooms.gm(ctx.roomId)).emit("library:favoritesChanged", { favorites });
        return favorites;
      },
      gmOnly,
    ),
  );
}
