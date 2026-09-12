/**
 * Homebrew da sala (docs/plano-compendio-sala.md, SPEC §9.18): entradas de compêndio próprias da
 * sala, gravadas em `RoomCompendiumEntry`. Mesmo espírito de services/handouts.ts — linha do Prisma
 * -> tipo do shared, passando pelo Zod na saída — mas aqui o Prisma guarda só a chave composta
 * (roomId, entryId) e colunas de índice; o corpo mecânico (fields/actions/sheet...) vive em `data`.
 */
import type { RoomCompendiumEntry as DbRoomCompendiumEntry } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { CompendiumEntrySchema, slugify, validateCompendiumEntry, type CompendiumEntry, type RoomCompendiumEntryInput, type SystemDefinition } from "@tormenta-vtt/shared";
import { getSystemCompendium } from "@tormenta-vtt/shared/compendium";
import { prisma } from "../db.js";
import { HandlerError } from "../socket/ack.js";

/** Colunas + `data` prontos pra `create`/`update`, a partir de uma entrada sem `roomId`/`entryId`. */
function entryColumns(entry: RoomCompendiumEntryInput): {
  type: string;
  kind: string | null;
  name: string;
  tags: string[];
  description: string;
  page: number | null;
  data: Prisma.InputJsonValue;
} {
  const { name, tags, description, page } = entry;
  if (entry.type === "creature") {
    return { type: "creature", kind: null, name, tags, description, page, data: { sheet: entry.sheet } as unknown as Prisma.InputJsonValue };
  }
  const { fields, actions, activation, enhancements, save, statBonuses, slots, price } = entry;
  return {
    type: "item",
    kind: entry.kind,
    name,
    tags,
    description,
    page,
    data: { fields, actions, activation, enhancements, save, statBonuses, slots, price } as unknown as Prisma.InputJsonValue,
  };
}

/** Linha do Prisma -> CompendiumEntry do shared (junta as colunas com o corpo guardado em `data`). */
export function toCompendiumEntry(row: DbRoomCompendiumEntry): CompendiumEntry {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return CompendiumEntrySchema.parse(
    row.type === "creature"
      ? { type: "creature", id: row.entryId, name: row.name, tags: row.tags, description: row.description, page: row.page, sheet: data.sheet }
      : { type: "item", id: row.entryId, name: row.name, tags: row.tags, kind: row.kind, description: row.description, page: row.page, ...data },
  );
}

/**
 * Mesmo que `toCompendiumEntry`, mas nunca lança: uma linha corrompida (não deveria acontecer — já
 * validamos na gravação) fica de fora com um aviso no log, em vez de derrubar a sala inteira
 * (`compendium:list`) ou o lote de exportação.
 */
function toCompendiumEntrySafe(row: DbRoomCompendiumEntry): CompendiumEntry | null {
  try {
    return toCompendiumEntry(row);
  } catch (err) {
    console.error(`[compendium] entrada "${row.entryId}" da sala ${row.roomId} inválida, ignorada:`, err);
    return null;
  }
}

/** Todas as entradas não apagadas da sala, já no formato do shared (linhas ruins ficam de fora). */
export async function roomCompendiumEntries(roomId: string): Promise<CompendiumEntry[]> {
  const rows = await prisma.roomCompendiumEntry.findMany({ where: { roomId, deletedAt: null }, orderBy: { createdAt: "asc" } });
  return rows.map(toCompendiumEntrySafe).filter((e): e is CompendiumEntry => e !== null);
}

/** Confere a entrada contra o sistema (mesma regra que valida o compêndio do sistema). */
export function validateRoomEntry(def: SystemDefinition, entryId: string, entry: RoomCompendiumEntryInput): string | null {
  return validateCompendiumEntry(def, { ...entry, id: entryId } as CompendiumEntry);
}

/**
 * Id novo a partir do nome (`slugify`): colisão com QUALQUER id já usado na sala — inclusive de uma
 * entrada apagada, porque a chave primária (roomId, entryId) não distingue — OU já usado pelo
 * compêndio do SISTEMA ganha sufixo numérico, mesma regra do importador offline
 * (scripts/import-foundry-compendium.ts). Checar o sistema também é o que evita "Duplicar para a
 * sala" (ou só um nome parecido) sobrepor uma entrada do sistema sem o GM ter escolhido isso de
 * propósito — decisão confirmada em docs/plano-compendio-sala.md (id da sala é fixo, sem edição).
 */
export async function nextEntryId(systemId: string, roomId: string, name: string): Promise<string> {
  const roomIds = (await prisma.roomCompendiumEntry.findMany({ where: { roomId }, select: { entryId: true } })).map((r) => r.entryId);
  const systemIds = getSystemCompendium(systemId).entries.map((e) => e.id);
  const used = new Set([...roomIds, ...systemIds]);
  const base = slugify(name);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** Cria a linha nova (id já decidido por `nextEntryId`, entrada já validada por `validateRoomEntry`). */
export async function createRoomCompendiumEntry(roomId: string, entryId: string, entry: RoomCompendiumEntryInput): Promise<DbRoomCompendiumEntry> {
  return prisma.roomCompendiumEntry.create({ data: { roomId, entryId, ...entryColumns(entry) } });
}

/** Substitui o corpo inteiro de uma linha existente (entryId não muda). */
export async function updateRoomCompendiumEntry(roomId: string, entryId: string, entry: RoomCompendiumEntryInput): Promise<DbRoomCompendiumEntry> {
  return prisma.roomCompendiumEntry.update({ where: { roomId_entryId: { roomId, entryId } }, data: entryColumns(entry) });
}

/** Revive uma linha soft-deletada com um corpo novo (import de um id que só existe apagado na sala). */
async function reviveRoomCompendiumEntry(roomId: string, entryId: string, entry: RoomCompendiumEntryInput): Promise<DbRoomCompendiumEntry> {
  return prisma.roomCompendiumEntry.update({ where: { roomId_entryId: { roomId, entryId } }, data: { ...entryColumns(entry), deletedAt: null } });
}

/** Carrega a linha (viva) e confirma que é desta sala. */
export async function requireRoomCompendiumEntry(roomId: string, entryId: string): Promise<DbRoomCompendiumEntry> {
  const row = await prisma.roomCompendiumEntry.findUnique({ where: { roomId_entryId: { roomId, entryId } } });
  if (!row || row.deletedAt !== null) throw new HandlerError("Entrada não encontrada no compêndio da sala");
  return row;
}

export interface ImportOutcome {
  imported: number;
  overwritten: number;
  skipped: { id: string; name: string; reason: string }[];
}

/**
 * Importa um lote (`compendium:room-import`): cada entrada é validada e resolvida sozinha — uma
 * ruim não derruba as boas. Id sem linha nenhuma na sala = criada (`imported`); id só apagado =
 * revivido (`imported` também, do ponto de vista do GM não havia nada ali); id ativo = pulado
 * (`skipped`, motivo "já existe na sala") a menos que `overwriteConflicts` (`overwritten`).
 */
export async function importRoomCompendium(def: SystemDefinition, roomId: string, entries: CompendiumEntry[], overwriteConflicts: boolean): Promise<{ outcome: ImportOutcome; changed: { kind: "created" | "updated"; entry: CompendiumEntry }[] }> {
  const outcome: ImportOutcome = { imported: 0, overwritten: 0, skipped: [] };
  const changed: { kind: "created" | "updated"; entry: CompendiumEntry }[] = [];

  for (const entry of entries) {
    const err = validateCompendiumEntry(def, entry);
    if (err) {
      outcome.skipped.push({ id: entry.id, name: entry.name, reason: err });
      continue;
    }
    const existing = await prisma.roomCompendiumEntry.findUnique({ where: { roomId_entryId: { roomId, entryId: entry.id } } });
    if (!existing) {
      const row = await createRoomCompendiumEntry(roomId, entry.id, entry);
      outcome.imported++;
      changed.push({ kind: "created", entry: toCompendiumEntry(row) });
    } else if (existing.deletedAt !== null) {
      const row = await reviveRoomCompendiumEntry(roomId, entry.id, entry);
      outcome.imported++;
      changed.push({ kind: "created", entry: toCompendiumEntry(row) });
    } else if (overwriteConflicts) {
      const row = await updateRoomCompendiumEntry(roomId, entry.id, entry);
      outcome.overwritten++;
      changed.push({ kind: "updated", entry: toCompendiumEntry(row) });
    } else {
      outcome.skipped.push({ id: entry.id, name: entry.name, reason: "já existe na sala" });
    }
  }
  return { outcome, changed };
}
