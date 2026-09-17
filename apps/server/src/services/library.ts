/**
 * Acervo da sala (docs/plano-preparo.md §1): `Asset` (mapa/token/áudio subidos pelo GM) e
 * `LibraryFavorite` (estrela sobre qualquer item do acervo, inclusive handout/encontro/criatura/
 * macro — que já têm tabela própria). Mesmo espírito de services/handouts.ts — linha do Prisma ->
 * tipo do shared, passando pelo Zod na saída.
 */
import type { Asset as DbAsset, LibraryFavorite as DbLibraryFavorite } from "@prisma/client";
import { AssetSchema, LibraryFavoriteSchema, type Asset, type AssetKind, type LibraryFavorite } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { HandlerError } from "../socket/ack.js";

export function toAsset(row: DbAsset): Asset {
  return AssetSchema.parse({
    id: row.id,
    roomId: row.roomId,
    kind: row.kind,
    name: row.name,
    url: row.url,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    tags: row.tags,
    createdAt: row.createdAt.toISOString(),
  });
}

export function toLibraryFavorite(row: DbLibraryFavorite): LibraryFavorite {
  return LibraryFavoriteSchema.parse({ refKind: row.refKind, refId: row.refId });
}

/** Carrega o asset e confirma que é desta sala e não está apagado. */
export async function requireAsset(assetId: string, roomId: string): Promise<DbAsset> {
  const row = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!row || row.roomId !== roomId || row.deletedAt !== null) throw new HandlerError("Item do acervo não encontrado");
  return row;
}

/** `asset:update`: `kind` só troca entre "map"↔"token" (§1.2 do plano) — um áudio nunca vira
 *  mapa/token (nem o contrário) por aqui, só apagando e subindo de novo. `nextKind` ausente
 *  (patch sem `kind`) sempre é permitido, não muda nada. */
export function canChangeAssetKind(current: AssetKind, nextKind: AssetKind | undefined): boolean {
  if (nextKind === undefined) return true;
  return current !== "audio" && nextKind !== "audio";
}
