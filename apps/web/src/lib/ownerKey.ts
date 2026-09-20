/**
 * Identidade local do Mestre (docs/SPEC.md §3.1): uma string gerada uma vez neste navegador e
 * guardada no localStorage (chave GLOBAL, não por sala — diferente de `session.ts`, que é por
 * `inviteCode`). É o que liga "Minhas mesas" a este navegador; quem tiver essa string vê e
 * gerencia as mesmas salas, então tratamos como credencial (aviso na UI ao exportar).
 */
const OWNER_KEY_STORAGE_KEY = "tvtt:ownerKey";

/** Devolve a chave já salva, ou null se este navegador nunca criou/adotou nenhuma sala. */
export function getOwnerKey(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Devolve a chave salva, gerando (e salvando) uma nova na primeira vez que for chamada — é o que
 * "Criar Sala" e "Adicionar mesa que já tenho" usam pra sempre terem uma chave pra mandar.
 */
export function getOrCreateOwnerKey(): string {
  const existing = getOwnerKey();
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  setOwnerKey(fresh);
  return fresh;
}

export function setOwnerKey(key: string): void {
  try {
    localStorage.setItem(OWNER_KEY_STORAGE_KEY, key);
  } catch {
    /* ignora */
  }
}
