/**
 * Persistência leve no localStorage: o sessionToken de cada sala (para
 * reconectar como o mesmo participante) e o último nickname usado.
 * Tudo em try/catch porque o localStorage pode estar bloqueado.
 */
const key = (inviteCode: string) => `tvtt:session:${inviteCode.toUpperCase()}`;
const NICK_KEY = "tvtt:nickname";

export function getSessionToken(inviteCode: string): string | null {
  try {
    return localStorage.getItem(key(inviteCode));
  } catch {
    return null;
  }
}

export function setSessionToken(inviteCode: string, token: string): void {
  try {
    localStorage.setItem(key(inviteCode), token);
  } catch {
    /* ignora */
  }
}

export function clearSessionToken(inviteCode: string): void {
  try {
    localStorage.removeItem(key(inviteCode));
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
