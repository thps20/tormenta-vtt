/**
 * Favoritos do compêndio (docs/SPEC.md §9.19): estrela por entrada, por PARTICIPANTE — não valida
 * se `entryId` ainda existe (favoritar é só uma marca; uma entrada apagada depois só deixa de
 * aparecer na paleta, o favorito órfão não quebra nada até o participante desfavoritar).
 */
import { prisma } from "../db.js";

/** Ids favoritados por um participante nesta sala, na ordem em que foram marcados. */
export async function listFavoriteEntryIds(roomId: string, participantId: string): Promise<string[]> {
  const rows = await prisma.compendiumFavorite.findMany({ where: { roomId, participantId }, orderBy: { createdAt: "asc" }, select: { entryId: true } });
  return rows.map((r) => r.entryId);
}
