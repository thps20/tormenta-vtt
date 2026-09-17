import { TabletopPrefsSchema, type TabletopPrefs } from "@tormenta-vtt/shared";

/**
 * Calibração de mesa física da tela de exibição (docs/plano-cast.md §3.3): 100% local a ESTA tela
 * — uma chave só, NÃO por sala (é gosto do projetor/mesa, não da campanha; mesmo espírito de
 * `lib/immersiveMode.ts`). `TabletopPrefsSchema` é a fronteira: localStorage pode estar corrompido
 * ou ser de uma versão antiga, então valida (com defaults) em vez de confiar cegamente.
 */
const KEY = "tvtt:cast:tabletop";

export function loadTabletopPrefs(): TabletopPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return TabletopPrefsSchema.parse({});
    const parsed = TabletopPrefsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : TabletopPrefsSchema.parse({});
  } catch {
    return TabletopPrefsSchema.parse({});
  }
}

/** Nunca lança: estourar a cota do localStorage não pode derrubar a tela. */
export function saveTabletopPrefs(prefs: TabletopPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignora */
  }
}
