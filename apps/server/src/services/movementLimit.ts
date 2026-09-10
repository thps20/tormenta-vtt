/**
 * Trava de orçamento de deslocamento (docs/plano-movimento.md §4.3): liga/desliga NA SALA, em
 * memória — não sobrevive a um restart do servidor, mesmo padrão de `templates.ts` (gabaritos) e
 * `presence.ts` (quem está online). Padrão: ligada (o orçamento vale) até o GM desligar.
 */
const enabledByRoom = new Map<string, boolean>();

export function isMovementLimitEnabled(roomId: string): boolean {
  return enabledByRoom.get(roomId) ?? true;
}

export function setMovementLimitEnabled(roomId: string, enabled: boolean): void {
  enabledByRoom.set(roomId, enabled);
}
