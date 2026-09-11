import type { PartyEntry } from "../schemas/party.js";

export type ReorderPartyResult = { ok: true; entries: PartyEntry[] } | { ok: false; error: string };

/**
 * Nova ordem completa do grupo (arrastar na faixa, `party:reorder`): `requestedIds` precisa ser uma
 * permutação exata dos `characterId` já no grupo — sem sumir nem repetir nenhum, mesma régua de
 * `reorderScenes` (rules/scenes.ts). Preserva `hidden` de cada entrada, só reordena.
 */
export function reorderParty(current: PartyEntry[], requestedIds: string[]): ReorderPartyResult {
  const unique = new Set(requestedIds);
  if (unique.size !== requestedIds.length) return { ok: false, error: "A lista não pode repetir personagens" };
  const byId = new Map(current.map((e) => [e.characterId, e]));
  if (unique.size !== byId.size || !requestedIds.every((id) => byId.has(id))) {
    return { ok: false, error: "A nova ordem precisa conter todo o grupo, sem repetir" };
  }
  return { ok: true, entries: requestedIds.map((id) => byId.get(id) as PartyEntry) };
}

/** Adiciona no fim do grupo; idempotente (já estar lá não é erro nem duplica ou reordena). */
export function addToParty(current: PartyEntry[], characterId: string): PartyEntry[] {
  if (current.some((e) => e.characterId === characterId)) return current;
  return [...current, { characterId, hidden: false }];
}

/** Remove do grupo; idempotente (não estar lá não é erro). */
export function removeFromParty(current: PartyEntry[], characterId: string): PartyEntry[] {
  return current.filter((e) => e.characterId !== characterId);
}

/** Marca oculto/visível; entrada inexistente não é erro (fica sem efeito — o chamador decide se avisa). */
export function setPartyHidden(current: PartyEntry[], characterId: string, hidden: boolean): PartyEntry[] {
  return current.map((e) => (e.characterId === characterId ? { ...e, hidden } : e));
}
