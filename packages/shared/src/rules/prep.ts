/**
 * Preparo do mapa (docs/plano-preparo.md §2): funções puras de resolução de referência e
 * reordenação. Persistir e validar contra o banco é do servidor (services/prep.ts, etapa 3) —
 * aqui só a lógica que não depende de I/O, testável isolada (mesmo padrão de rules/scenes.ts).
 */
import type { PrepRef, PrepStep } from "../schemas/prep.js";

/** Ids ainda existentes de cada tipo de referência, já filtrados por quem chama (só o que a store
 *  carregou) — o chamador (painel do preparo, ou o servidor antes de executar um item) monta isto
 *  a partir dos mesmos dados que a tela já tem. */
export interface PrepRefPools {
  assetIds: string[];
  handoutIds: string[];
  encounterIds: string[];
  creatureIds: string[];
  macroIds: string[];
  pinIds: string[];
  npcIds: string[];
}

/**
 * A referência ainda existe? `note` nunca quebra (não aponta pra nada, §2.1). Quando `false`, o
 * chamador mostra o `PrepItem.label` guardado (último nome conhecido) com o aviso "Apagado do
 * acervo" (§2.6) — esta função não sabe de UI, só responde a pergunta binária.
 */
export function resolvePrepRef(ref: PrepRef, pools: PrepRefPools): boolean {
  switch (ref.kind) {
    case "asset":
      return pools.assetIds.includes(ref.assetId);
    case "handout":
      return pools.handoutIds.includes(ref.handoutId);
    case "encounter":
      return pools.encounterIds.includes(ref.encounterId);
    case "creature":
      return pools.creatureIds.includes(ref.entryId);
    case "macro":
      return pools.macroIds.includes(ref.macroId);
    case "pin":
      return pools.pinIds.includes(ref.pinId);
    case "npc":
      return pools.npcIds.includes(ref.characterId);
    case "note":
      return true;
  }
}

export type ReorderPrepStepsResult = { ok: true; order: { stepId: string; order: number }[] } | { ok: false; error: string };

/** Renumera 0..n-1 seguindo `requestedIds`; mesma régua de `reorderScenes` (rules/scenes.ts) —
 *  rejeita se o conjunto não bater exatamente com os passos atuais do mapa. */
export function reorderPrepSteps(current: Pick<PrepStep, "id">[], requestedIds: string[]): ReorderPrepStepsResult {
  const unique = new Set(requestedIds);
  if (unique.size !== requestedIds.length) return { ok: false, error: "A lista não pode repetir passos" };
  const known = new Set(current.map((s) => s.id));
  if (unique.size !== known.size || !requestedIds.every((id) => known.has(id))) {
    return { ok: false, error: "A nova ordem precisa conter todos os passos do mapa, sem repetir" };
  }
  return { ok: true, order: requestedIds.map((stepId, order) => ({ stepId, order })) };
}

/** Remove um item de uma lista pelo id; idempotente (id ausente não é erro, devolve a lista igual). */
export function removePrepItemById<T extends { id: string }>(items: T[], itemId: string): T[] {
  return items.filter((item) => item.id !== itemId);
}

/** Insere um item numa posição (fora do intervalo é fixado no início/fim) — usado tanto para
 *  reordenar dentro do passo quanto para mover entre passos (§2.4 `prep:item-move`). */
export function insertPrepItemAt<T>(items: T[], item: T, index: number): T[] {
  const clamped = Math.max(0, Math.min(index, items.length));
  const copy = [...items];
  copy.splice(clamped, 0, item);
  return copy;
}
