/**
 * Alvos marcados por participante (docs/plano-alvos.md): efêmeros, em memória — mesmo padrão de
 * `templates.ts`/`presence.ts`. `Map<roomId, Map<participantId, { sceneId, tokenIds }>>`. Sobrevive
 * a F5/reconexão (vem no `RoomSnapshot`), não a um restart do servidor.
 */
export interface TargetState {
  sceneId: string;
  tokenIds: string[];
}

const byRoomAndParticipant = new Map<string, Map<string, TargetState>>();

/** Lista de todos os que têm alvo marcado nesta sala (para o snapshot). */
export function listTargets(roomId: string): { participantId: string; sceneId: string; tokenIds: string[] }[] {
  const room = byRoomAndParticipant.get(roomId);
  if (!room) return [];
  return [...room.entries()].map(([participantId, state]) => ({ participantId, ...state }));
}

export function getTargets(roomId: string, participantId: string): TargetState | undefined {
  return byRoomAndParticipant.get(roomId)?.get(participantId);
}

/** `tokenIds` vazio apaga a entrada (nada pra listar, mesmo espírito de `removeRemoteRuler`). */
export function setTargets(roomId: string, participantId: string, sceneId: string, tokenIds: string[]): void {
  let room = byRoomAndParticipant.get(roomId);
  if (!room) byRoomAndParticipant.set(roomId, (room = new Map()));
  if (tokenIds.length === 0) room.delete(participantId);
  else room.set(participantId, { sceneId, tokenIds });
}

/**
 * Token apagado (token:delete/delete-many): tira o id de todas as listas da sala. Devolve o novo
 * estado de cada participante cuja lista mudou (pra reemitir `target:updated` só de quem precisa,
 * sem uma segunda consulta — `sceneId` continua o de antes mesmo quando a lista esvaziou).
 */
export function removeTokenFromTargets(roomId: string, tokenId: string): { participantId: string; sceneId: string; tokenIds: string[] }[] {
  const room = byRoomAndParticipant.get(roomId);
  if (!room) return [];
  const changed: { participantId: string; sceneId: string; tokenIds: string[] }[] = [];
  for (const [participantId, state] of room) {
    if (!state.tokenIds.includes(tokenId)) continue;
    const tokenIds = state.tokenIds.filter((id) => id !== tokenId);
    if (tokenIds.length === 0) room.delete(participantId);
    else room.set(participantId, { ...state, tokenIds });
    changed.push({ participantId, sceneId: state.sceneId, tokenIds });
  }
  return changed;
}

/** `scene:activate` (jogador mudou de mapa ativo): limpa os alvos de todo jogador — o GM mantém os
 *  dele (pode estar preparando o mapa seguinte). Devolve o `sceneId` de ANTES de cada um que mudou,
 *  pra broadcastTargets ter algo pra mandar junto do `tokenIds: []`. */
export function clearPlayerTargets(roomId: string, playerIds: Set<string>): { participantId: string; sceneId: string }[] {
  const room = byRoomAndParticipant.get(roomId);
  if (!room) return [];
  const changed: { participantId: string; sceneId: string }[] = [];
  for (const [participantId, state] of [...room.entries()]) {
    if (!playerIds.has(participantId)) continue;
    room.delete(participantId);
    changed.push({ participantId, sceneId: state.sceneId });
  }
  return changed;
}

/** `scene:delete`: apaga toda entrada apontando pro mapa apagado (não sobra referência a um mapa morto). */
export function clearSceneTargets(roomId: string, sceneId: string): void {
  const room = byRoomAndParticipant.get(roomId);
  if (!room) return;
  for (const [participantId, state] of room) if (state.sceneId === sceneId) room.delete(participantId);
}

/** Sala inteira saiu (limpeza, se algum dia existir) — sem chamador hoje, mas evita vazar memória. */
export function clearRoomTargets(roomId: string): void {
  byRoomAndParticipant.delete(roomId);
}

/**
 * `character:roll` (docs/revisao-alvos.md §5.2): filtra e ORDENA as linhas de token pelos ids que
 * o autor marcou, descartando as que não estão no mapa que ele está VENDO agora — o `sceneId`
 * gravado da última vez que ele chamou `target:set`, não o mapa do personagem nem o da ação. Sem
 * isso, um alvo marcado num mapa e esquecido lá (o GM não tem os alvos limpos ao trocar de mapa,
 * §2.2) continuava entrando na conta de um ataque feito depois, em outro mapa (achado na revisão).
 * `viewingSceneId` ausente (autor nunca chamou `target:set` nesta sala) descarta tudo — sem um
 * mapa pra comparar, nenhum alvo tem como ser validado. Pura: sem I/O, fácil de testar.
 */
export function filterTargetTokensByScene<T extends { id: string; sceneId: string }>(
  targetTokenIds: string[],
  rows: T[],
  viewingSceneId: string | undefined,
): T[] {
  if (viewingSceneId === undefined) return [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return targetTokenIds.flatMap((id) => {
    const row = byId.get(id);
    return row && row.sceneId === viewingSceneId ? [row] : [];
  });
}
