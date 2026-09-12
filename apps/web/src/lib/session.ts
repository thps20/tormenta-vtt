/**
 * Persistência leve no localStorage: o sessionToken de cada sala (para
 * reconectar como o mesmo participante) e o último nickname usado.
 * Tudo em try/catch porque o localStorage pode estar bloqueado.
 */
/**
 * A chave inclui o papel: assim dá para abrir a mesa como GM numa aba e como
 * jogador em outra, no mesmo navegador, sem uma sessão sobrescrever a outra.
 */
export type SessionRole = "gm" | "player";
const key = (inviteCode: string, role: SessionRole) => `tvtt:session:${inviteCode.toUpperCase()}:${role}`;
const NICK_KEY = "tvtt:nickname";

export function getSessionToken(inviteCode: string, role: SessionRole): string | null {
  try {
    return localStorage.getItem(key(inviteCode, role));
  } catch {
    return null;
  }
}

export function setSessionToken(inviteCode: string, role: SessionRole, token: string): void {
  try {
    localStorage.setItem(key(inviteCode, role), token);
  } catch {
    /* ignora */
  }
}

export function clearSessionToken(inviteCode: string, role: SessionRole): void {
  try {
    localStorage.removeItem(key(inviteCode, role));
  } catch {
    /* ignora */
  }
}

export function getLastNickname(): string {
  try {
    return localStorage.getItem(NICK_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setLastNickname(nickname: string): void {
  try {
    localStorage.setItem(NICK_KEY, nickname);
  } catch {
    /* ignora */
  }
}

/**
 * Mapa que o GM estava vendo (docs/plano-mapas.md §4): `sessionStorage`, não `localStorage` —
 * cada aba tem sua própria "onde eu estava", igual à sessão de jogador poder ser diferente em
 * abas diferentes. Um F5 no meio da preparação volta pro mesmo mapa; se ele foi apagado nesse
 * meio-tempo, o chamador cai para o ativo (o id salvo simplesmente não bate com nenhum mapa vivo).
 */
const viewingKey = (roomId: string) => `tvtt:viewing:${roomId}`;

export function getViewingScene(roomId: string): string | null {
  try {
    return sessionStorage.getItem(viewingKey(roomId));
  } catch {
    return null;
  }
}

export function setViewingScene(roomId: string, sceneId: string): void {
  try {
    sessionStorage.setItem(viewingKey(roomId), sceneId);
  } catch {
    /* ignora */
  }
}

/**
 * Enquadramento (zoom/pan) do mapa, por sala+mapa, nesta aba (`sessionStorage`, mesmo raciocínio de
 * `getViewingScene`/`setViewingScene`: cada aba/usuário tem o seu, sobrevive a F5, não é a fonte da
 * verdade de nada no servidor). `VttCanvas` grava a cada mudança de zoom/pan e restaura ao entrar
 * num mapa (`scene:enter`, ativação, jogador seguindo o ativo); mapa nunca visto nesta sessão cai no
 * padrão (ajustar à tela).
 */
export interface SavedView {
  x: number;
  y: number;
  scale: number;
}

const viewKey = (roomId: string, sceneId: string) => `tvtt:view:${roomId}:${sceneId}`;

export function getSavedView(roomId: string, sceneId: string): SavedView | null {
  try {
    const raw = sessionStorage.getItem(viewKey(roomId, sceneId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as SavedView).x === "number" &&
      typeof (parsed as SavedView).y === "number" &&
      typeof (parsed as SavedView).scale === "number"
    ) {
      return parsed as SavedView;
    }
    return null;
  } catch {
    return null;
  }
}

export function setSavedView(roomId: string, sceneId: string, view: SavedView): void {
  try {
    sessionStorage.setItem(viewKey(roomId, sceneId), JSON.stringify(view));
  } catch {
    /* ignora */
  }
}
