/**
 * Encontros salvos (docs/SPEC.md §9.14): biblioteca por sala, mesmo espírito de services/handouts.ts
 * — linha do Prisma -> tipo do shared, passando pelo Zod na saída.
 */
import type { SavedEncounter as DbSavedEncounter } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { SavedEncounterEntrySchema, SavedEncounterSchema, type SavedEncounter, type SavedEncounterEntry } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { HandlerError } from "../socket/ack.js";

export function toEncounter(row: DbSavedEncounter): SavedEncounter {
  return SavedEncounterSchema.parse({
    id: row.id,
    roomId: row.roomId,
    name: row.name,
    tags: row.tags,
    notes: row.notes,
    entries: row.entries,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** Entradas do encontro já validadas (a coluna é `Json`; o schema garante a forma na saída). */
export function encounterEntriesOf(row: Pick<DbSavedEncounter, "entries">): SavedEncounterEntry[] {
  return SavedEncounterEntrySchema.array().parse(row.entries);
}

/** Carrega o encontro e confirma que é desta sala e não está apagado. */
export async function requireEncounter(id: string, roomId: string): Promise<DbSavedEncounter> {
  const row = await prisma.savedEncounter.findUnique({ where: { id } });
  if (!row || row.roomId !== roomId || row.deletedAt !== null) throw new HandlerError("Encontro não encontrado");
  return row;
}

/** `entries` pronto pra coluna Json (mesmo truque de services/characters.ts#toJson). */
export function entriesJson(entries: SavedEncounterEntry[]): Prisma.InputJsonValue {
  return entries as unknown as Prisma.InputJsonValue;
}
