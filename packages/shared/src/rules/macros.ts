/** Próximo `order` livre pra uma macro nova (fim da barra): sempre maior que todas as já existentes
 *  do mesmo participante (lista vazia = 0). Mesmo raciocínio de `nextSceneOrder` (rules/scenes.ts). */
export function nextMacroOrder(current: { order: number }[]): number {
  return current.length === 0 ? 0 : Math.max(...current.map((m) => m.order)) + 1;
}

export type ReorderMacrosResult = { ok: true; order: { id: string; order: number }[] } | { ok: false; error: string };

/**
 * Nova ordem completa da barra de macros (arrastar, `macro:reorder`): `requestedIds` precisa ser
 * uma permutação exata das macros já existentes, sem sumir nem repetir nenhuma — mesma régua de
 * `reorderScenes` (rules/scenes.ts) e `reorderParty` (rules/party.ts).
 */
export function reorderMacros(current: { id: string }[], requestedIds: string[]): ReorderMacrosResult {
  const unique = new Set(requestedIds);
  if (unique.size !== requestedIds.length) return { ok: false, error: "A lista não pode repetir macros" };
  const known = new Set(current.map((m) => m.id));
  if (unique.size !== known.size || !requestedIds.every((id) => known.has(id))) {
    return { ok: false, error: "A nova ordem precisa conter todas as macros, sem repetir" };
  }
  return { ok: true, order: requestedIds.map((id, order) => ({ id, order })) };
}
