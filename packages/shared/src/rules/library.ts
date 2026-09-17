/**
 * Acervo da sala (docs/plano-preparo.md §1): junta Asset[] + Handout[] + SavedEncounter[] +
 * CompendiumEntry[] (só homebrew da sala) + Macro[] (só do GM dono) numa vista única. Os quatro
 * últimos já chegam pré-filtrados por quem chama (mesmas listas que as telas deles já usam —
 * `useHandouts.library`, `useEncounters.items`, `useCompendium` filtrado por `roomIds`,
 * `useMacros`) — esta função só COMBINA, nunca filtra por dono/sala, então nenhum dado é
 * duplicado. Pura, sem side effect (§1.1).
 */
import type { Asset, AssetKind, LibraryFavorite } from "../schemas/library.js";
import type { Handout } from "../schemas/handout.js";
import type { SavedEncounter } from "../schemas/encounter.js";
import type { CompendiumEntry } from "../schemas/compendium.js";
import type { Macro } from "../schemas/macro.js";

interface LibraryItemBase {
  name: string;
  tags: string[];
  favorite: boolean;
  /** null quando a fonte não tem data própria (criatura/macro, §1.2) — a UI ordena essas por nome. */
  createdAt: string | null;
}

export type LibraryItem =
  | (LibraryItemBase & { kind: "asset"; id: string; assetKind: AssetKind; asset: Asset })
  | (LibraryItemBase & { kind: "handout"; id: string; handout: Handout })
  | (LibraryItemBase & { kind: "encounter"; id: string; encounter: SavedEncounter })
  | (LibraryItemBase & { kind: "creature"; id: string; entry: CompendiumEntry })
  | (LibraryItemBase & { kind: "macro"; id: string; macro: Macro });

export interface BuildLibraryItemsInput {
  assets: Asset[];
  handouts: Handout[];
  encounters: SavedEncounter[];
  /** Já filtrado pelo chamador pra só homebrew da sala (§1.2) — criatura do sistema não entra. */
  creatures: CompendiumEntry[];
  /** Já filtrado pelo chamador pra só as do GM dono (mesma regra de RoomSnapshot.macros). */
  macros: Macro[];
  favorites: LibraryFavorite[];
}

/** Ordem estável e previsível: por tipo (mapa/token/áudio, handout, encontro, criatura, macro),
 *  depois por nome — o plano não define ordenação da vista combinada; busca/filtro (§1.5) é quem
 *  resolve "achar" de verdade, então uma ordem simples e determinística basta aqui. */
const KIND_ORDER: Record<LibraryItem["kind"], number> = { asset: 0, handout: 1, encounter: 2, creature: 3, macro: 4 };

export function buildLibraryItems(input: BuildLibraryItemsInput): LibraryItem[] {
  const favoriteKeys = new Set(input.favorites.map((f) => `${f.refKind}:${f.refId}`));
  const isFavorite = (refKind: LibraryFavorite["refKind"], refId: string) => favoriteKeys.has(`${refKind}:${refId}`);

  const items: LibraryItem[] = [
    ...input.assets.map((asset): LibraryItem => ({
      kind: "asset",
      id: asset.id,
      assetKind: asset.kind,
      asset,
      name: asset.name,
      tags: asset.tags,
      favorite: isFavorite("asset", asset.id),
      createdAt: asset.createdAt,
    })),
    ...input.handouts.map((handout): LibraryItem => ({
      kind: "handout",
      id: handout.id,
      handout,
      name: handout.name,
      tags: handout.tags,
      favorite: isFavorite("handout", handout.id),
      createdAt: handout.createdAt,
    })),
    ...input.encounters.map((encounter): LibraryItem => ({
      kind: "encounter",
      id: encounter.id,
      encounter,
      name: encounter.name,
      tags: encounter.tags,
      favorite: isFavorite("encounter", encounter.id),
      createdAt: encounter.createdAt,
    })),
    ...input.creatures.map((entry): LibraryItem => ({
      kind: "creature",
      id: entry.id,
      entry,
      name: entry.name,
      tags: entry.tags,
      favorite: isFavorite("creature", entry.id),
      createdAt: null,
    })),
    ...input.macros.map((macro): LibraryItem => ({
      kind: "macro",
      id: macro.id,
      macro,
      name: macro.label,
      tags: [],
      favorite: isFavorite("macro", macro.id),
      createdAt: null,
    })),
  ];

  return items.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));
}
