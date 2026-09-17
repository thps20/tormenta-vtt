/**
 * Preparo do mapa (docs/plano-preparo.md §2): passos por mapa, cada item APONTA pra algo que já
 * existe (nunca reimplementa a ação — ver comentário em packages/shared/src/schemas/prep.ts).
 * Mesmo espírito de services/handouts.ts (linha do Prisma -> tipo do shared, Zod na saída), mais os
 * helpers de concorrência: toda alteração de `items` (Json) relê a linha DENTRO de uma transação
 * antes de reescrever (§2.1 — "duas abas do GM não se atropelam").
 */
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { PrepStep as DbPrepStep, Room as DbRoom } from "@prisma/client";
import {
  PrepItemSchema,
  PrepStepSchema,
  insertPrepItemAt,
  removePrepItemById,
  type PrepItem,
  type PrepRef,
  type PrepStep,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { HandlerError, type Ctx } from "../socket/ack.js";
import { requireAsset } from "./library.js";
import { requireHandout } from "./handouts.js";
import { requireEncounter } from "./encounters.js";
import { canEditMacro, requireMacro } from "./macros.js";
import { requireCharacter } from "./characters.js";
import { listCompendium } from "./compendium.js";

export function toPrepStep(row: DbPrepStep): PrepStep {
  return PrepStepSchema.parse({
    id: row.id,
    sceneId: row.sceneId,
    order: row.order,
    title: row.title,
    notes: row.notes,
    items: row.items,
    used: row.used,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/** `items` já validado (a coluna é Json; o schema garante a forma na saída) — mesmo truque de
 *  services/encounters.ts#encounterEntriesOf. */
export function prepItemsOf(row: Pick<DbPrepStep, "items">): PrepItem[] {
  return PrepItemSchema.array().parse(row.items);
}

/** `items` pronto pra coluna Json (mesmo truque de services/characters.ts#toJson). */
export function prepItemsJson(items: PrepItem[]): Prisma.InputJsonValue {
  return items as unknown as Prisma.InputJsonValue;
}

/** Carrega o passo e confirma que é desta sala e não está apagado (passo E mapa dele). */
export async function requirePrepStep(stepId: string, roomId: string): Promise<DbPrepStep & { scene: { roomId: string; deletedAt: Date | null } }> {
  const row = await prisma.prepStep.findUnique({ where: { id: stepId }, include: { scene: { select: { roomId: true, deletedAt: true } } } });
  if (!row || row.scene.roomId !== roomId || row.deletedAt !== null || row.scene.deletedAt !== null) throw new HandlerError("Passo não encontrado");
  return row;
}

/**
 * Nome ATUAL da referência, copiado pra `PrepItem.label` no momento de adicionar (§2.6) — nunca
 * usado depois pra executar, só pra continuar mostrando algo quando a referência quebrar. Recusa
 * referência que já não existe (diferente de quebrar DEPOIS por ser apagada — não faz sentido
 * adicionar algo já quebrado).
 */
export async function resolveRefLabel(ref: PrepRef, ctx: Ctx, room: DbRoom): Promise<string> {
  switch (ref.kind) {
    case "asset":
      return (await requireAsset(ref.assetId, ctx.roomId)).name;
    case "handout":
      return (await requireHandout(ref.handoutId, ctx.roomId)).name;
    case "encounter":
      return (await requireEncounter(ref.encounterId, ctx.roomId)).name;
    case "creature": {
      const { entries } = await listCompendium(room.systemId, ctx.roomId, "gm");
      const entry = entries.find((e) => e.id === ref.entryId && e.type === "creature");
      if (!entry) throw new HandlerError("Criatura não encontrada");
      return entry.name;
    }
    case "macro": {
      const row = await requireMacro(ref.macroId, ctx.roomId);
      // Macro é estritamente pessoal (§2.1: "macro do próprio GM") — mesma mensagem de "não
      // encontrada" pra não vazar que a macro existe mas é de outro participante.
      if (!canEditMacro(ctx, row)) throw new HandlerError("Macro não encontrada");
      return row.label;
    }
    case "pin": {
      const row = await prisma.pin.findUnique({ where: { id: ref.pinId }, include: { scene: { select: { roomId: true } } } });
      if (!row || row.scene.roomId !== ctx.roomId || row.deletedAt !== null) throw new HandlerError("Pino não encontrado");
      return row.name ?? "Pino";
    }
    case "npc":
      return (await requireCharacter(ref.characterId, ctx.roomId)).name;
    case "note":
      return ref.text.length > 80 ? `${ref.text.slice(0, 79)}…` : ref.text;
  }
}

/**
 * Relê `items` do banco e reescreve com `mutate` DENTRO de uma transação (§2.1: nunca confia numa
 * lista vinda do cliente como base) — usada por item-add/update/remove. `mutate` pode lançar
 * `HandlerError` (ex.: item não encontrado), que aborta a transação normalmente.
 */
export async function updatePrepItems(stepId: string, mutate: (items: PrepItem[]) => PrepItem[]): Promise<PrepStep> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.prepStep.findUniqueOrThrow({ where: { id: stepId } });
    const items = mutate(prepItemsOf(row));
    const updated = await tx.prepStep.update({ where: { id: stepId }, data: { items: prepItemsJson(items) } });
    return toPrepStep(updated);
  });
}

/** `prep:item-move`: dentro do passo (`stepId === toStepId`) ou pra outro passo do MESMO mapa. */
export async function movePrepItem(stepId: string, itemId: string, toStepId: string, index: number): Promise<PrepStep[]> {
  return prisma.$transaction(async (tx) => {
    const fromRow = await tx.prepStep.findUniqueOrThrow({ where: { id: stepId } });
    const fromItems = prepItemsOf(fromRow);
    const item = fromItems.find((i) => i.id === itemId);
    if (!item) throw new HandlerError("Item não encontrado");
    const remaining = removePrepItemById(fromItems, itemId);

    if (stepId === toStepId) {
      const updated = await tx.prepStep.update({ where: { id: stepId }, data: { items: prepItemsJson(insertPrepItemAt(remaining, item, index)) } });
      return [toPrepStep(updated)];
    }
    const toRow = await tx.prepStep.findUniqueOrThrow({ where: { id: toStepId } });
    if (toRow.sceneId !== fromRow.sceneId) throw new HandlerError("Os passos precisam ser do mesmo mapa");
    const toItems = insertPrepItemAt(prepItemsOf(toRow), item, index);
    const updatedFrom = await tx.prepStep.update({ where: { id: stepId }, data: { items: prepItemsJson(remaining) } });
    const updatedTo = await tx.prepStep.update({ where: { id: toStepId }, data: { items: prepItemsJson(toItems) } });
    return [toPrepStep(updatedFrom), toPrepStep(updatedTo)];
  });
}

/** Foto de `used` (passo + cada item) antes de um `prep:reset`, pra desfazer restaurar exatamente. */
export interface PrepResetSnapshot {
  stepId: string;
  used: boolean;
  itemUsed: { id: string; used: boolean }[];
}

export async function loadPrepResetSnapshot(sceneId: string): Promise<PrepResetSnapshot[]> {
  const rows = await prisma.prepStep.findMany({ where: { sceneId, deletedAt: null } });
  return rows.map((row) => ({ stepId: row.id, used: row.used, itemUsed: prepItemsOf(row).map((item) => ({ id: item.id, used: item.used })) }));
}

/** Zera `used` de todos os passos/itens do snapshot (`prep:reset`). Passo apagado entre o
 *  carregamento do snapshot e a escrita é pulado, não trava o resto do lote. */
export async function zeroPrepUsed(snapshot: PrepResetSnapshot[]): Promise<PrepStep[]> {
  const result: PrepStep[] = [];
  for (const { stepId } of snapshot) {
    const row = await prisma.prepStep.findUnique({ where: { id: stepId } });
    if (!row) continue;
    const items = prepItemsOf(row).map((item) => ({ ...item, used: false }));
    result.push(toPrepStep(await prisma.prepStep.update({ where: { id: stepId }, data: { used: false, items: prepItemsJson(items) } })));
  }
  return result;
}

/** Restaura `used` do snapshot (desfazer de `prep:reset`). */
export async function restorePrepUsed(snapshot: PrepResetSnapshot[]): Promise<PrepStep[]> {
  const result: PrepStep[] = [];
  for (const { stepId, used, itemUsed } of snapshot) {
    const row = await prisma.prepStep.findUnique({ where: { id: stepId } });
    if (!row) continue;
    const usedById = new Map(itemUsed.map((i) => [i.id, i.used]));
    const items = prepItemsOf(row).map((item) => (usedById.has(item.id) ? { ...item, used: usedById.get(item.id)! } : item));
    result.push(toPrepStep(await prisma.prepStep.update({ where: { id: stepId }, data: { used, items: prepItemsJson(items) } })));
  }
  return result;
}

/**
 * Copia TODOS os passos não-apagados de um mapa pra outro, todos pendentes (used:false, itens
 * used:false, ids de item novos) — usada por `scene:duplicate` (§2.4: "duplicar um mapa copia o
 * preparo junto"). Roda DENTRO da transação que o chamador já tem aberta (precisa do id do mapa
 * novo, criado na mesma transação).
 */
export async function copyAllPrepStepsInTx(tx: Prisma.TransactionClient, sourceSceneId: string, targetSceneId: string): Promise<void> {
  const rows = await tx.prepStep.findMany({ where: { sceneId: sourceSceneId, deletedAt: null }, orderBy: { order: "asc" } });
  for (const row of rows) {
    const items = prepItemsOf(row).map((item) => ({ ...item, id: randomUUID(), used: false }));
    await tx.prepStep.create({ data: { sceneId: targetSceneId, title: row.title, order: row.order, notes: row.notes, items: prepItemsJson(items) } });
  }
}
