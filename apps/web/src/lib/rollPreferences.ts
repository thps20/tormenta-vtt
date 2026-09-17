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

/**
 * Animação ao revelar o resultado de uma rolagem (docs/SPEC.md): "simple" (padrão) é a transição
 * curta no próprio cartão; "3d" são dados físicos sobre o mapa (`DiceOverlay3D`); "off" desliga.
 * Mesmo padrão de preferência por usuário que `rollDamageWithAttack` acima.
 */
export type DiceAnimationMode = "off" | "simple" | "3d";
const ANIMATION_KEY = "tvtt:diceAnimationMode";

export function loadDiceAnimationMode(): DiceAnimationMode {
  try {
    const raw = localStorage.getItem(ANIMATION_KEY);
    return raw === "off" || raw === "simple" || raw === "3d" ? raw : "simple";
  } catch {
    return "simple";
  }
}

export function saveDiceAnimationMode(value: DiceAnimationMode): void {
  try {
    localStorage.setItem(ANIMATION_KEY, value);
  } catch {
    /* ignora */
  }
}

/** `prefers-reduced-motion` do SO/navegador — derruba a animação de rolagem (simples ou 3D)
 *  mesmo com a preferência salva ligada (RollCardMessage/InitiativeBatchMessage). */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
