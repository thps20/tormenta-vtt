/**
 * Pilha de desfazer/refazer por sala (docs/plano-desfazer.md), só do GM. Em memória no processo do
 * servidor — mesmo padrão de services/presence.ts (quem está online): se perde num restart, o que é
 * aceitável aqui (conveniência do GM, não dado de jogo).
 *
 * Cada handler que quer ser desfazível monta a `HistoryEntry` no próprio lugar onde já tem os dados
 * em mãos (mesmo espírito de `guarded`), em vez de um formato genérico de "before/after" — os
 * formatos são bem diferentes entre apagar token, mover e spawnar criatura.
 */
import type { Token } from "@tormenta-vtt/shared";

export interface HistoryEntry {
  /** Pronto pro toast: "apagar Goblin 3", "mover Herói", "soltar 5 cópias de Goblin". */
  summary: string;
  /** Reaplica a ação (redo). Reconfere premissas antes de escrever (linha ainda existe etc.). */
  apply: () => Promise<void>;
  /** Desfaz a ação (undo). Idem. */
  revert: () => Promise<void>;
}

interface RoomHistory {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

/** ~50 pedido: cap na pilha de undo. Redo não tem cap próprio (nunca passa do que já foi desfeito). */
const MAX_UNDO_ENTRIES = 50;

const rooms = new Map<string, RoomHistory>();

function roomHistory(roomId: string): RoomHistory {
  let h = rooms.get(roomId);
  if (!h) rooms.set(roomId, (h = { undo: [], redo: [] }));
  return h;
}

function capUndo(h: RoomHistory): void {
  if (h.undo.length > MAX_UNDO_ENTRIES) h.undo.splice(0, h.undo.length - MAX_UNDO_ENTRIES);
}

/** Ação nova do GM: empilha em undo, corta o fundo acima do cap e limpa redo (uma ação nova
 *  invalida o que dava pra refazer). */
export function pushEntry(roomId: string, entry: HistoryEntry): void {
  const h = roomHistory(roomId);
  h.undo.push(entry);
  h.redo = [];
  capUndo(h);
}

/** Tira do topo da pilha de undo (undefined = pilha vazia). NÃO move pra redo sozinho — quem chama
 *  decide isso depois de `entry.revert()` ter dado certo (ver `moveToRedo`). */
export function popUndo(roomId: string): HistoryEntry | undefined {
  return roomHistory(roomId).undo.pop();
}

/** Tira do topo da pilha de redo (undefined = pilha vazia). Simétrico a `popUndo`. */
export function popRedo(roomId: string): HistoryEntry | undefined {
  return roomHistory(roomId).redo.pop();
}

/** Undo bem-sucedido (já saiu do undo via `popUndo`): volta pro topo do redo. */
export function moveToRedo(roomId: string, entry: HistoryEntry): void {
  roomHistory(roomId).redo.push(entry);
}

/** Redo bem-sucedido (já saiu do redo via `popRedo`): volta pro topo do undo (com o mesmo cap). */
export function moveToUndo(roomId: string, entry: HistoryEntry): void {
  const h = roomHistory(roomId);
  h.undo.push(entry);
  capUndo(h);
}

/** Estado pra Toolbar (botões habilitados/desabilitados + tooltip) — emitido em `history:updated`. */
export function peekSummaries(roomId: string): { canUndo: boolean; canRedo: boolean; undoSummary?: string; redoSummary?: string } {
  const h = roomHistory(roomId);
  const undoTop = h.undo[h.undo.length - 1];
  const redoTop = h.redo[h.redo.length - 1];
  return {
    canUndo: h.undo.length > 0,
    canRedo: h.redo.length > 0,
    ...(undoTop ? { undoSummary: undoTop.summary } : {}),
    ...(redoTop ? { redoSummary: redoTop.summary } : {}),
  };
}

// --- Diff de token (mover/redimensionar/condição/visibilidade, docs/plano-desfazer.md §3) --------

/** Únicos campos de Token que geram entrada de histórico. Nome/cor/imagem/dono/ficha ficam fora
 *  (editados pelo TokenInspector, fora do escopo deste plano). */
export const TRACKABLE_TOKEN_FIELDS = ["x", "y", "cells", "conditions", "visible"] as const;
export type TrackableTokenField = (typeof TRACKABLE_TOKEN_FIELDS)[number];

export type TrackableTokenPatch = Partial<Pick<Token, TrackableTokenField>>;

function trackableFieldChanged(before: Token, after: Token, field: TrackableTokenField): boolean {
  if (field === "conditions") return JSON.stringify(before.conditions) !== JSON.stringify(after.conditions);
  return before[field] !== after[field];
}

/**
 * Quais campos rastreados mudaram entre `before` e `after`. `null` = nada rastreável mudou (patch
 * só mexeu em nome/cor/imagem/dono, ou não mudou nada) — o chamador não empilha entrada nenhuma.
 */
export function pickTrackableTokenPatch(before: Token, after: Token): { before: TrackableTokenPatch; after: TrackableTokenPatch } | null {
  const changed: TrackableTokenField[] = TRACKABLE_TOKEN_FIELDS.filter((f) => trackableFieldChanged(before, after, f));
  if (changed.length === 0) return null;
  const pick = (t: Token): TrackableTokenPatch => Object.fromEntries(changed.map((f) => [f, t[f]])) as TrackableTokenPatch;
  return { before: pick(before), after: pick(after) };
}

/** Resumo pro toast a partir dos campos rastreados que mudaram (um token ou um lote). */
export function describeTokenChange(subject: string, fields: Iterable<TrackableTokenField>): string {
  const set = new Set(fields);
  if (set.has("x") || set.has("y")) return `mover ${subject}`;
  if (set.has("cells")) return `redimensionar ${subject}`;
  if (set.has("conditions")) return `alterar condição de ${subject}`;
  if (set.has("visible")) return `alterar visibilidade de ${subject}`;
  return `atualizar ${subject}`;
}

/** "apagar Goblin 3" (um) ou "apagar N tokens" (lote). */
export function describeDelete(names: string[]): string {
  return names.length === 1 ? `apagar ${names[0]}` : `apagar ${names.length} tokens`;
}

/** "soltar Goblin" (uma cópia) ou "soltar N cópias de Goblin" (compendium:spawn-creature). */
export function describeSpawn(count: number, creatureName: string): string {
  return count === 1 ? `soltar ${creatureName}` : `soltar ${count} cópias de ${creatureName}`;
}

/** "soltar encontro <nome>" (encounter:spawn — várias criaturas, uma entrada de histórico só). */
export function describeEncounterSpawn(encounterName: string): string {
  return `soltar encontro ${encounterName}`;
}
