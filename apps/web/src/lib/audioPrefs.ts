import { AudioUiPrefsSchema, type AudioUiPrefs } from "@tormenta-vtt/shared";

/**
 * Volume/silenciar dos Sons (docs/plano-preparo.md §3.3): 100% local a ESTE navegador — por
 * usuário, NÃO por sala (mesmo espírito de `lib/tabletopPrefs.ts`). `AudioUiPrefsSchema` é a
 * fronteira: localStorage pode estar corrompido ou de uma versão antiga, então valida (com
 * defaults) em vez de confiar cegamente.
 */
const KEY = "tvtt:audio";

export function loadAudioPrefs(): AudioUiPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return AudioUiPrefsSchema.parse({});
    const parsed = AudioUiPrefsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : AudioUiPrefsSchema.parse({});
  } catch {
    return AudioUiPrefsSchema.parse({});
  }
}

/** Nunca lança: estourar a cota do localStorage não pode quebrar o áudio. */
export function saveAudioPrefs(prefs: AudioUiPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignora */
  }
}
