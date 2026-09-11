/**
 * "Rolar dano junto com o ataque" (SPEC §9.13): preferência por usuário, ligada por padrão — igual
 * às outras (RoomPage.tsx: `showOtherTargets`, `centerOnActiveTurn`...), só que em funções puras (e
 * não `useState` de um componente só) porque tanto a store (`store/characters.ts#roll`, decide se
 * combina a ação de dano irmã) quanto o checkbox da UI (ChatTab) precisam ler o mesmo valor.
 */
const KEY = "tvtt:rollDamageWithAttack";

export function loadRollDamageWithAttack(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

export function saveRollDamageWithAttack(value: boolean): void {
  try {
    localStorage.setItem(KEY, value ? "1" : "0");
  } catch {
    /* ignora */
  }
}
