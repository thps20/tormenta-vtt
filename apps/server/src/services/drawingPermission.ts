/**
 * "Jogadores podem desenhar" (SPEC §9.17): liga/desliga NA SALA, em memória — não sobrevive a um
 * restart do servidor, mesmo padrão de `movementLimit.ts`/`autoRollNpcInitiative.ts`. Padrão:
 * ligada. Só trava CRIAR um traço novo — mover/apagar os que o jogador já tinha antes de o GM
 * desligar continuam permitidos (não trava no meio de um gesto).
 */
const enabledByRoom = new Map<string, boolean>();

export function isPlayerDrawingEnabled(roomId: string): boolean {
  return enabledByRoom.get(roomId) ?? true;
}

export function setPlayerDrawingEnabled(roomId: string, enabled: boolean): void {
  enabledByRoom.set(roomId, enabled);
}
