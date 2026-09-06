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
