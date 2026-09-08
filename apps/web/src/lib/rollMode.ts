/**
 * Modo de rolagem do participante (Pública / Secreta / Própria).
 * O valor vai no payload de toda rolagem (chat:send, character:roll) e o
 * servidor decide quem recebe. Persistido em sessionStorage: sobrevive ao
 * F5 da aba, mas não vaza para outra aba (GM e jogador no mesmo navegador).
 */
import { RollVisibilitySchema, type RollVisibility } from "@tormenta-vtt/shared";
import { EyeOff, Globe, Lock, type LucideIcon } from "lucide-react";

export interface RollModeInfo {
  id: RollVisibility;
  label: string;
  description: string;
  icon: LucideIcon;
}

/** Ordem do ciclo do botão (clique simples avança para o próximo). */
export const ROLL_MODES: readonly RollModeInfo[] = [
  { id: "all", label: "Pública", description: "Todos veem o resultado.", icon: Globe },
  { id: "gm", label: "Secreta", description: "Só o GM vê. Jogador rola às cegas: nem ele vê o resultado.", icon: EyeOff },
  { id: "self", label: "Própria", description: "Só você vê o resultado.", icon: Lock },
];

export function rollModeInfo(id: RollVisibility): RollModeInfo {
  return ROLL_MODES.find((m) => m.id === id) ?? ROLL_MODES[0]!;
}

export function nextRollMode(id: RollVisibility): RollVisibility {
  const i = ROLL_MODES.findIndex((m) => m.id === id);
  return ROLL_MODES[(i + 1) % ROLL_MODES.length]!.id;
}

const KEY = "tvtt:rollMode";

export function loadRollMode(): RollVisibility {
  try {
    const parsed = RollVisibilitySchema.safeParse(sessionStorage.getItem(KEY));
    return parsed.success ? parsed.data : "all";
  } catch {
    return "all";
  }
}

export function saveRollMode(mode: RollVisibility): void {
  try {
    sessionStorage.setItem(KEY, mode);
  } catch {
    /* ignora */
  }
}
