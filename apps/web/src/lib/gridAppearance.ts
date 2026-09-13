import type { GridConfig } from "@tormenta-vtt/shared";

/**
 * Aparência do grid é preferência PESSOAL (localStorage, por sala) — não é regra de sistema nem
 * config de sala, então fica fora de `packages/shared` (regra número 1 do CLAUDE.md é só pra regras
 * de RPG). O padrão é sempre seguir o que o Mestre configurou no mapa (`Scene.grid`); só grava algo
 * aqui quando o jogador explicitamente sobrepõe pelo menu do botão "Grid" (`GridAppearanceMenu`).
 */

export type GridLineStyle = "lines" | "dashed" | "crosses";

export interface GridAppearanceOverride {
  style: GridLineStyle;
  /** "#rrggbb", sem alfa — a opacidade é campo separado (mesma convenção da "Cor do Grid" do Mestre
   *  em `MapConfigModal`, onde cor e opacidade também são dois controles distintos). */
  color: string;
  opacity: number; // 0..1
  /** Espessura em pixels de TELA (não de pixel do mapa) — constante com o zoom, ver `GridLayer`. */
  thickness: number; // 1..3
}

export interface GridAppearancePrefs {
  /** Mostrar/ocultar o grid só pra mim. Independente do `override`: não desliga snap nem medidas,
   *  só não desenha (ver docs/SPEC.md §9.21). */
  visible: boolean;
  /** null = seguir o padrão do mapa (estilo "linhas", cor/opacidade do Mestre, espessura padrão). */
  override: GridAppearanceOverride | null;
}

export const DEFAULT_GRID_APPEARANCE_PREFS: GridAppearancePrefs = { visible: true, override: null };

const KEY_PREFIX = "vtt:gridAppearance:";

/** Nunca lança: localStorage bloqueado/indisponível cai no padrão (mostrar, seguindo o mapa). */
export function loadGridAppearancePrefs(roomId: string): GridAppearancePrefs {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + roomId);
    if (!raw) return DEFAULT_GRID_APPEARANCE_PREFS;
    const parsed = JSON.parse(raw) as Partial<GridAppearancePrefs> | null;
    return {
      visible: typeof parsed?.visible === "boolean" ? parsed.visible : true,
      override: parsed?.override ?? null,
    };
  } catch {
    return DEFAULT_GRID_APPEARANCE_PREFS;
  }
}

export function saveGridAppearancePrefs(roomId: string, prefs: GridAppearancePrefs): void {
  try {
    localStorage.setItem(KEY_PREFIX + roomId, JSON.stringify(prefs));
  } catch {
    /* estourou a cota do localStorage: a preferência só não sobrevive à próxima sessão */
  }
}

export interface ResolvedGridAppearance {
  visible: boolean;
  style: GridLineStyle;
  color: string;
  opacity: number;
  thickness: number;
}

/** "Padrão do mapa": sempre linhas sólidas na cor que o Mestre escolheu, opacidade cheia (a
 *  transparência do Mestre já pode estar embutida no próprio `color`, ex. "#00000055") e 1px de
 *  tela — mesmo visual de sempre pra quem nunca abriu o menu. */
const MAP_DEFAULT_STYLE: GridLineStyle = "lines";
const MAP_DEFAULT_OPACITY = 1;
const MAP_DEFAULT_THICKNESS = 1;

/** Junta a preferência do usuário com o grid do MAPA atual — puro (sem localStorage), fácil de testar. */
export function resolveGridAppearance(prefs: GridAppearancePrefs, mapGrid: GridConfig): ResolvedGridAppearance {
  if (!prefs.override) {
    return { visible: prefs.visible, style: MAP_DEFAULT_STYLE, color: mapGrid.color, opacity: MAP_DEFAULT_OPACITY, thickness: MAP_DEFAULT_THICKNESS };
  }
  return { visible: prefs.visible, ...prefs.override };
}
