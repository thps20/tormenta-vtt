import { entryToItem, type Character, type CharacterItem, type CharacterPatch, type CompendiumEntry, type SystemDefinition } from "@tormenta-vtt/shared";

/**
 * Regras de inserção de uma entrada do compêndio numa ficha. Funções puras
 * (testáveis) usadas por insertFromCompendium na store de fichas. Nada aqui
 * conhece "classe" ou "raça": lê level.classes e itemKinds[].maxCount.
 */

export interface InsertCheck {
  /** Pode inserir direto (Enter, "+", soltar). */
  ok: boolean;
  /** Motivo quando não pode; a paleta mostra a entrada em cinza com este texto. */
  reason: string | null;
  /** Item que seria substituído se o usuário confirmar (tipos com maxCount = 1). */
  replaces: CharacterItem | null;
}

export function checkInsert(def: SystemDefinition, character: Pick<Character, "items">, entry: CompendiumEntry): InsertCheck {
  const kind = def.itemKinds.find((k) => k.key === entry.kind);
  if (!kind) return { ok: false, reason: `Tipo de item desconhecido: ${entry.kind}`, replaces: null };
  if (kind.maxCount === undefined) return { ok: true, reason: null, replaces: null };
  const existing = character.items.filter((i) => i.kind === kind.key);
  if (existing.length < kind.maxCount) return { ok: true, reason: null, replaces: null };
  if (kind.maxCount === 1) {
    const current = existing[0] ?? null;
    return { ok: false, reason: `A ficha já tem ${kind.label}: ${current?.name ?? ""}`, replaces: current };
  }
  return { ok: false, reason: `A ficha só aceita ${kind.maxCount} itens do tipo ${kind.label}`, replaces: null };
}

export interface InsertResult {
  item: CharacterItem;
  patch: CharacterPatch;
}

/**
 * Monta o patch de character:update que insere a cópia da entrada:
 *  - `replace` remove antes o item que checkInsert apontou (ex.: trocar a raça);
 *  - a primeira classe da ficha nasce marcada como inicial (level.classes.initialField);
 *  - um item com campo `size` aplica o tamanho à ficha, como o editor de raça já faz.
 */
export function buildInsertPatch(
  def: SystemDefinition,
  character: Pick<Character, "items">,
  entry: CompendiumEntry,
  newId: () => string,
  opts: { replace?: CharacterItem | null } = {},
): InsertResult {
  const item = entryToItem(def, entry, newId);
  const items = opts.replace ? character.items.filter((i) => i.id !== opts.replace?.id) : character.items;

  const classes = def.level.classes;
  if (classes && item.kind === classes.kind && !items.some((i) => i.kind === classes.kind)) {
    item.fields[classes.initialField] = true;
  }

  const patch: CharacterPatch = { items: [...items, item] };
  const kind = def.itemKinds.find((k) => k.key === item.kind);
  const sizeField = kind?.fields.find((f) => f.type === "size");
  const size = sizeField ? item.fields[sizeField.key] : undefined;
  if (typeof size === "string" && def.sizes.some((s) => s.key === size)) patch.size = size;

  return { item, patch };
}

/** Busca simples: todas as palavras da consulta aparecem no nome, nas tags ou no id (sem acento, sem caixa). */
export function matchesQuery(entry: CompendiumEntry, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalize([entry.name, entry.id, ...entry.tags].join(" "));
  return words.every((w) => haystack.includes(w));
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
