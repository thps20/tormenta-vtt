/**
 * Progressão por itens: classes (nível, PV/PM por nível, perícias concedidas)
 * e campos estruturados que qualquer item ativo pode ter (bônus de atributo,
 * bônus à escolha, perícias treinadas). Nada aqui é gravado na ficha: o
 * computeCharacter chama estas funções a cada cálculo, então remover o item
 * remove o efeito por construção (mesmo padrão dos statBonuses equipados).
 *
 * O código nunca conhece "con", "hpPerLevel" ou "class": lê level.classes,
 * resources[].perLevel e o tipo de cada campo em itemKinds[].fields.
 */
import {
  AttributeBonusesValueSchema,
  AttributeChoiceValueSchema,
  SkillGrantsValueSchema,
  type CharacterData,
  type CharacterItem,
} from "../schemas/character.js";
import type { ItemFieldDef, ItemKindDef, ResourceDef, SystemDefinition } from "../schemas/system.js";

/** Item conta para a ficha? Não físico: sempre. Físico: só equipado e com quantidade. */
export function isItemActive(def: SystemDefinition, item: CharacterItem): boolean {
  const kind = def.itemKinds.find((k) => k.key === item.kind);
  if (kind?.physical === false) return true;
  return item.equipped && item.quantity > 0;
}

function kindOf(def: SystemDefinition, item: CharacterItem): ItemKindDef | undefined {
  return def.itemKinds.find((k) => k.key === item.kind);
}

function numberField(item: CharacterItem, key: string | undefined): number {
  if (key === undefined) return 0;
  const v = item.fields[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Sem repetição, mantendo a ordem da primeira ocorrência. */
function unique(keys: string[]): string[] {
  return keys.filter((k, i) => keys.indexOf(k) === i);
}

// --- Modificadores vindos de itens -----------------------------------------

export interface ItemModifier {
  itemId: string;
  itemName: string;
  /** Seletor no formato de Modifier.target (hoje só attr.<key>). */
  target: string;
  value: number;
}

/**
 * Modificadores gerados pelos campos attributeBonuses e attributeChoice dos
 * itens ativos. Escolhas inválidas (atributo inexistente, excluído, repetido
 * ou além de `count`) são ignoradas em silêncio.
 */
export function itemModifiers(def: SystemDefinition, data: Pick<CharacterData, "items">): ItemModifier[] {
  const attrKeys = new Set(def.attributes.map((a) => a.key));
  const out: ItemModifier[] = [];
  for (const item of data.items) {
    const kind = kindOf(def, item);
    if (!kind || !isItemActive(def, item)) continue;
    for (const field of kind.fields) {
      const raw = item.fields[field.key];
      if (field.type === "attributeBonuses") {
        const parsed = AttributeBonusesValueSchema.safeParse(raw);
        if (!parsed.success) continue;
        for (const [attr, value] of Object.entries(parsed.data)) {
          if (attrKeys.has(attr) && value !== 0) out.push({ itemId: item.id, itemName: item.name, target: `attr.${attr}`, value });
        }
      } else if (field.type === "attributeChoice") {
        const parsed = AttributeChoiceValueSchema.safeParse(raw);
        if (!parsed.success || parsed.data.amount === 0) continue;
        for (const attr of chosenAttributes(def, parsed.data)) {
          out.push({ itemId: item.id, itemName: item.name, target: `attr.${attr}`, value: parsed.data.amount });
        }
      }
    }
  }
  return out;
}

/** Atributos efetivamente escolhidos num attributeChoice (válidos, fora de exclude, até count). */
export function chosenAttributes(def: SystemDefinition, choice: { count: number; exclude: string[]; chosen: string[] }): string[] {
  const attrKeys = new Set(def.attributes.map((a) => a.key));
  return unique(choice.chosen)
    .filter((k) => attrKeys.has(k) && !choice.exclude.includes(k))
    .slice(0, choice.count);
}

// --- Perícias concedidas -----------------------------------------------------

export interface SkillGrant {
  skill: string;
  itemId: string;
  itemName: string;
}

/** Perícias válidas de um grupo de escolha: dentro de `from` (se houver), existentes, até `count`. */
export function chosenSkills(def: SystemDefinition, choice: { count: number; from: string[]; chosen: string[] }): string[] {
  const skillKeys = new Set(def.skills.map((s) => s.key));
  return unique(choice.chosen)
    .filter((k) => skillKeys.has(k.split(":")[0] ?? "") && (choice.from.length === 0 || choice.from.includes(k.split(":")[0] ?? "")))
    .slice(0, choice.count);
}

/** Perícias treinadas por itens ativos (campos skillGrants). O primeiro item que concede vence. */
export function skillGrants(def: SystemDefinition, data: Pick<CharacterData, "items">): Map<string, SkillGrant> {
  const skillKeys = new Set(def.skills.map((s) => s.key));
  const out = new Map<string, SkillGrant>();
  const grant = (skill: string, item: CharacterItem) => {
    if (!out.has(skill)) out.set(skill, { skill, itemId: item.id, itemName: item.name });
  };
  for (const item of data.items) {
    const kind = kindOf(def, item);
    if (!kind || !isItemActive(def, item)) continue;
    for (const field of kind.fields) {
      if (field.type !== "skillGrants") continue;
      const parsed = SkillGrantsValueSchema.safeParse(item.fields[field.key]);
      if (!parsed.success) continue;
      for (const key of parsed.data.fixed) if (skillKeys.has(key.split(":")[0] ?? "")) grant(key, item);
      for (const choice of parsed.data.choices) for (const key of chosenSkills(def, choice)) grant(key, item);
    }
  }
  return out;
}

// --- Escolhas pendentes ------------------------------------------------------

export interface PendingChoice {
  fieldKey: string;
  label: string;
  /** Quantas escolhas ainda faltam. */
  missing: number;
}

/** Campos de escolha do item que ainda não foram preenchidos por completo (para a UI avisar). */
export function pendingChoices(def: SystemDefinition, item: CharacterItem): PendingChoice[] {
  const kind = kindOf(def, item);
  if (!kind) return [];
  const out: PendingChoice[] = [];
  for (const field of kind.fields) {
    const raw = item.fields[field.key];
    if (field.type === "attributeChoice") {
      const parsed = AttributeChoiceValueSchema.safeParse(raw);
      if (!parsed.success) continue;
      const missing = parsed.data.count - chosenAttributes(def, parsed.data).length;
      if (missing > 0) out.push({ fieldKey: field.key, label: field.label, missing });
    } else if (field.type === "skillGrants") {
      const parsed = SkillGrantsValueSchema.safeParse(raw);
      if (!parsed.success) continue;
      const missing = parsed.data.choices.reduce((acc, c) => acc + Math.max(0, c.count - chosenSkills(def, c).length), 0);
      if (missing > 0) out.push({ fieldKey: field.key, label: field.label, missing });
    }
  }
  return out;
}

// --- Classes -----------------------------------------------------------------

export interface ClassEntry {
  itemId: string;
  name: string;
  levels: number;
  /** Classe inicial efetiva: a marcada no item ou, se nenhuma, a primeira da lista. */
  initial: boolean;
}

/** Itens de classe da ficha (level.classes.kind), com níveis saneados. */
export function listClasses(def: SystemDefinition, data: Pick<CharacterData, "items">): ClassEntry[] {
  const cfg = def.level.classes;
  if (!cfg) return [];
  const entries = data.items
    .filter((i) => i.kind === cfg.kind)
    .map((i) => ({ itemId: i.id, name: i.name, levels: Math.max(0, Math.floor(numberField(i, cfg.levelsField))), initial: i.fields[cfg.initialField] === true }));
  if (entries.length > 0 && !entries.some((e) => e.initial)) {
    const first = entries[0];
    if (first) first.initial = true;
  }
  // Só uma classe inicial: a primeira marcada.
  let seen = false;
  for (const e of entries) {
    if (e.initial && seen) e.initial = false;
    if (e.initial) seen = true;
  }
  return entries;
}

/** "Guerreiro 3 / Arcanista 2". Vazio sem classes. */
export function describeClasses(classes: ClassEntry[]): string {
  return classes.map((c) => `${c.name} ${c.levels}`).join(" / ");
}

export interface PerLevelResult {
  max: number;
  /** A conta em texto, para o tooltip da ficha. */
  detail: string;
}

/**
 * Máximo de um recurso acumulado por nível de classe (resources[].perLevel).
 * `attributes` são os valores finais dos atributos (já com modificadores).
 */
export function perLevelMax(
  def: SystemDefinition,
  resource: ResourceDef,
  classes: ClassEntry[],
  data: Pick<CharacterData, "items">,
  attributes: Record<string, number>,
): PerLevelResult {
  const cfg = resource.perLevel;
  if (!cfg) return { max: 0, detail: "" };
  const attrValue = cfg.attribute ? (attributes[cfg.attribute] ?? 0) : 0;
  const attrAbbr = cfg.attribute ? (def.attributes.find((a) => a.key === cfg.attribute)?.abbr ?? cfg.attribute) : null;
  const floor = cfg.minPerLevel;
  const gain = (base: number) => {
    const raw = base + attrValue;
    return floor !== undefined ? Math.max(floor, raw) : raw;
  };
  const term = (base: number) => (attrAbbr ? `(${base} ${attrValue < 0 ? "-" : "+"} ${Math.abs(attrValue)})` : `${base}`);

  let total = 0;
  let floored = false;
  const parts: string[] = [];
  for (const c of classes) {
    const item = data.items.find((i) => i.id === c.itemId);
    if (!item || c.levels === 0) continue;
    const perLevel = numberField(item, cfg.classField);
    const first = c.initial && cfg.firstLevelField !== undefined ? numberField(item, cfg.firstLevelField) : perLevel;
    const firstGain = gain(first);
    const restLevels = c.levels - 1;
    const restGain = gain(perLevel) * restLevels;
    if (firstGain !== first + attrValue || (restLevels > 0 && gain(perLevel) !== perLevel + attrValue)) floored = true;
    const subtotal = firstGain + restGain;
    total += subtotal;
    const text =
      c.initial && cfg.firstLevelField !== undefined
        ? restLevels > 0
          ? `${term(first)} + ${restLevels} × ${term(perLevel)}`
          : term(first)
        : `${c.levels} × ${term(perLevel)}`;
    parts.push(`${c.name} ${c.levels}: ${text} = ${subtotal}`);
  }
  let detail = parts.join("; ");
  if (parts.length > 1) detail += `; total ${total}`;
  if (floored && floor !== undefined) detail += ` (mín. ${floor} por nível)`;
  return { max: total, detail };
}

// --- Validação da ficha contra o sistema ------------------------------------

/**
 * Regras que o Zod da ficha não consegue conferir sozinho porque dependem do
 * sistema: tipo de item existente e limite por tipo (itemKinds[].maxCount).
 * Devolve a mensagem de erro, ou null se está tudo certo.
 */
export function validateCharacterItems(def: SystemDefinition, data: Pick<CharacterData, "items">): string | null {
  const counts = new Map<string, number>();
  for (const item of data.items) {
    const kind = kindOf(def, item);
    if (!kind) return `Tipo de item desconhecido: "${item.kind}"`;
    counts.set(kind.key, (counts.get(kind.key) ?? 0) + 1);
  }
  for (const kind of def.itemKinds) {
    const n = counts.get(kind.key) ?? 0;
    if (kind.maxCount !== undefined && n > kind.maxCount) {
      return kind.maxCount === 1 ? `A ficha só pode ter 1 item do tipo ${kind.label}` : `A ficha só pode ter ${kind.maxCount} itens do tipo ${kind.label}`;
    }
  }
  return null;
}

/** Valor inicial de um campo estruturado (os escalares usam ItemFieldDef.default). */
export function emptyFieldValue(def: SystemDefinition, field: ItemFieldDef): CharacterItem["fields"][string] {
  switch (field.type) {
    case "attributeBonuses":
      return {};
    case "attributeChoice":
      return { amount: 1, count: 1, exclude: [], chosen: [] };
    case "skillGrants":
      return { fixed: [], choices: [] };
    case "size":
      return (def.sizes.find((s) => s.skillModifier === 0) ?? def.sizes[0])?.key ?? "";
    case "enum":
      return field.options?.[0]?.key ?? "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "text":
      return "";
  }
}
