import { isPointRevealed, tokenCenter, type FogConfig, type Token } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { rooms, type TypedServer } from "../socket/types.js";

export interface Viewer {
  role: "gm" | "player";
  participantId: string;
}

/**
 * Este mapa é o ATIVO da sala agora? Broadcast de coisa de mapa (token:*, fog:updated,
 * combat:updated, ruler:updated) pra jogador só vale se for — o GM sempre recebe, é quem pode
 * estar preparando um mapa que a mesa ainda não vê (docs/plano-mapas.md §5).
 */
export async function isActiveScene(roomId: string, sceneId: string): Promise<boolean> {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { activeSceneId: true } });
  return room?.activeSceneId === sceneId;
}

/**
 * Regra pura por trás da checagem acima combinada com o papel: GM sempre pode agir/receber;
 * jogador só quando `isActive` já confirmou (via `isActiveScene`) que o mapa é o ATIVO da sala.
 * Separada pra testar a tabela "GM/jogador × ativo/inativo" sem banco (docs/plano-mapas.md §15) —
 * usada por `requirePlayerOnActiveScene` (combat.ts), `requirePlayerTokenOnActiveScene` (token.ts)
 * e `ruler:update`.
 */
export function canAccessScene(role: "gm" | "player", isActive: boolean): boolean {
  return role === "gm" || isActive;
}

/**
 * Quem pode ver um token. GM vê tudo. Jogador vê se o token é `visible` e
 * (é dono dele, ou a névoa está desligada, ou o CENTRO do token está em área revelada).
 * A mesma função pura `isPointRevealed` roda no cliente (packages/shared).
 */
export function tokenVisibleTo(token: Token, viewer: Viewer, fog: FogConfig): boolean {
  if (viewer.role === "gm") return true;
  if (!token.visible) return false;
  if (token.ownerId === viewer.participantId) return true;
  return isPointRevealed(fog, tokenCenter(token));
}

/** Um token está escondido de jogadores (que não sejam o dono) pela névoa? */
function hiddenByFog(token: Token, fog: FogConfig): boolean {
  return !isPointRevealed(fog, tokenCenter(token));
}

/**
 * Envia o token aos JOGADORES respeitando a visibilidade. Quem não pode ver
 * recebe `token:deleted` (caso tivesse o token em cache), nunca o token em si:
 * assim nem nome nem existência vazam. Como "é dono" varia por pessoa, usamos
 * a sala do dono + `players` exceto o dono. O GM é tratado pelo chamador.
 */
export function emitTokenToPlayers(io: TypedServer, roomId: string, token: Token, event: "token:created" | "token:updated", fog: FogConfig): void {
  const players = rooms.players(roomId);
  const hide = (except?: string) => {
    // Em token:created ninguém tinha o token; não há o que apagar.
    if (event !== "token:updated") return;
    const target = except ? io.to(players).except(except) : io.to(players);
    target.emit("token:deleted", { tokenId: token.id });
  };

  if (!token.visible) return hide();
  if (!hiddenByFog(token, fog)) return void io.to(players).emit(event, token);

  // Oculto pela névoa: só o dono (se houver) recebe o token; os outros jogadores apagam.
  if (token.ownerId) {
    const ownerRoom = rooms.participant(token.ownerId);
    io.to(ownerRoom).emit(event, token);
    hide(ownerRoom);
  } else {
    hide();
  }
}
