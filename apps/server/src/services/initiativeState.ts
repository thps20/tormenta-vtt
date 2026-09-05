import type { InitiativeEntry, InitiativeState } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { toInitiativeEntry } from "./serialize.js";

/**
 * currentIndex e round ficam em memória por sala (SPEC §4): perdem-se ao
 * reiniciar o servidor, aceitável no MVP. As entradas ficam no banco.
 */
const cursors = new Map<string, { currentIndex: number | null; round: number }>();

export function getCursor(roomId: string) {
  let c = cursors.get(roomId);
  if (!c) cursors.set(roomId, (c = { currentIndex: null, round: 0 }));
  return c;
}

/** Ordem oficial: value desc, depois tiebreak desc. */
export function sortEntries(entries: InitiativeEntry[]): InitiativeEntry[] {
  return [...entries].sort((a, b) => (b.value !== a.value ? b.value - a.value : b.tiebreak - a.tiebreak));
}

/** Carrega o estado completo. Para jogadores, esconde entradas invisíveis (mantendo o índice coerente). */
export async function loadInitiativeState(roomId: string, forGm: boolean): Promise<InitiativeState> {
  const rows = await prisma.initiativeEntry.findMany({ where: { roomId } });
  const all = sortEntries(rows.map(toInitiativeEntry));
  const cursor = getCursor(roomId);

  if (forGm) return { roomId, entries: all, currentIndex: cursor.currentIndex, round: cursor.round };

  // Jogador: recalcula o índice na lista filtrada. Se quem age está oculto, não destaca ninguém.
  const visible = all.filter((e) => e.visible);
  const current = cursor.currentIndex === null ? undefined : all[cursor.currentIndex];
  const idx = current && current.visible ? visible.findIndex((e) => e.id === current.id) : -1;
  return { roomId, entries: visible, currentIndex: idx >= 0 ? idx : null, round: cursor.round };
}
