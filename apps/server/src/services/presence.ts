/**
 * Quem está online. Estado em memória (não persistido): um participante pode
 * ter várias abas, então contamos sockets por participante.
 */
const online = new Map<string, Map<string, Set<string>>>(); // roomId -> participantId -> socketIds

export function addSocket(roomId: string, participantId: string, socketId: string): void {
  let room = online.get(roomId);
  if (!room) online.set(roomId, (room = new Map()));
  let sockets = room.get(participantId);
  if (!sockets) room.set(participantId, (sockets = new Set()));
  sockets.add(socketId);
}

/** Remove o socket; devolve true se o participante ficou totalmente offline. */
export function removeSocket(roomId: string, participantId: string, socketId: string): boolean {
  const sockets = online.get(roomId)?.get(participantId);
  if (!sockets) return true;
  sockets.delete(socketId);
  if (sockets.size > 0) return false;
  online.get(roomId)?.delete(participantId);
  return true;
}

export function isConnected(roomId: string, participantId: string): boolean {
  return (online.get(roomId)?.get(participantId)?.size ?? 0) > 0;
}
