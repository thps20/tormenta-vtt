/**
 * "Rolar iniciativa dos NPCs ao iniciar o combate" (SPEC §3.5): liga/desliga NA SALA, em
 * memória — não sobrevive a um restart do servidor, mesmo padrão de `movementLimit.ts`. Padrão:
 * ligada — `combat:start`/`combat:add` rolam sozinhos os combatentes sem dono; GM desliga no
 * painel de combate pra rolar os NPCs à mão, como antes.
 */
const enabledByRoom = new Map<string, boolean>();

export function isAutoRollNpcInitiativeEnabled(roomId: string): boolean {
  return enabledByRoom.get(roomId) ?? true;
}

export function setAutoRollNpcInitiativeEnabled(roomId: string, enabled: boolean): void {
  enabledByRoom.set(roomId, enabled);
}
