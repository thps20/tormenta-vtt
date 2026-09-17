/**
 * Sons (docs/plano-preparo.md §3.3): helpers puros usados por `components/AudioEngine.tsx` (o
 * componente que de fato possui os `<audio>` — dois por montagem: trilha e efeito, fora do React
 * pelo mesmo motivo de `@3d-dice/dice-box-threejs` em `DiceOverlay3D.tsx`, só que aqui é a API
 * nativa do navegador, sem lib nenhuma).
 */

/** 0 quando silenciado, senão o volume da preferência — os dois `<audio>` (trilha/efeito) usam o mesmo. */
export function effectiveVolume(prefs: { volume: number; muted: boolean }): number {
  return prefs.muted ? 0 : prefs.volume;
}

/**
 * Tenta tocar; devolve `true` se conseguiu, `false` se o navegador bloqueou (autoplay antes do
 * primeiro gesto do usuário — `NotAllowedError`). Qualquer outro erro (ex.: `url` 404) também
 * conta como "não tocou" pro chamador decidir o que fazer, mas não é o caso do aviso de autoplay.
 */
export async function tryPlay(audio: HTMLAudioElement): Promise<boolean> {
  try {
    await audio.play();
    return true;
  } catch {
    return false;
  }
}
