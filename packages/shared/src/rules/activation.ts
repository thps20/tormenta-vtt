/**
 * Uso de itens ativos (poderes, magias, consumíveis): custo efetivo, CD de
 * resistência e o card publicado no chat. Tudo puro: o servidor chama
 * buildItemUse, persiste os recursos devolvidos e publica o card; o cliente
 * usa as mesmas funções só para exibir (botão "Usar", custo, CD).
 *
 * Nenhuma chave de sistema aqui: o recurso do custo, o piso, a fórmula da CD e
 * quais execuções são passivas vêm de def.activation.
 */
import { DiceParseError, evaluateConstant } from "../dice/index.js";
import type { Activation, Character, CharacterData, CharacterItem, CharacterResource, ItemCard } from "../schemas/character.js";
import type { SkillDef, SystemDefinition } from "../schemas/system.js";
import { computeCharacter, makeResolver, parseModifiers, sumModifiers, type ComputedCharacter } from "./compute.js";
import { FormulaError, substitutePlaceholders } from "./placeholders.js";

export class ItemUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ItemUseError";
  }
}

/** Perícias que podem ser teste de resistência (activation.saveSkillTag); sem tag, todas as fixas. */
export function saveSkills(def: SystemDefinition): SkillDef[] {
  const tag = def.activation.saveSkillTag;
  return def.skills.filter((s) => !s.variants && (tag === undefined || s.tags.includes(tag)));
}

/** Passivo = sem bloco de ativação, ou execução marcada como passiva no sistema. */
export function isPassiveItem(def: SystemDefinition, item: Pick<CharacterItem, "activation">): boolean {
  if (!item.activation) return true;
  const execution = def.activation.executions.find((e) => e.key === item.activation?.execution);
  return execution?.passive ?? false;
}

/**
 * Custo depois dos modificadores "resource.<recurso>.cost".
 * Base 0 continua 0 (habilidade gratuita não ganha custo); senão o piso é
 * def.activation.minCost (T20: reduções nunca levam abaixo de 1 PM).
 */
export function effectiveCost(def: SystemDefinition, data: Pick<CharacterData, "modifiers">, item: Pick<CharacterItem, "activation">): number {
  const base = item.activation?.cost ?? 0;
  if (base <= 0) return 0;
  const resource = def.activation.resource;
  if (!resource) return base;
  const delta = sumModifiers(parseModifiers(data), (t) => t.kind === "resourceCost" && t.key === resource);
  return Math.max(def.activation.minCost, base + delta);
}

/**
 * CD do teste de resistência do item pela fórmula def.activation.saveDc.
 * {saveAttr} = atributo do save do item, ou o de conjuração da ficha.
 * null = sistema sem fórmula, item sem save, ou fórmula com erro.
 */
export function saveDcFor(
  def: SystemDefinition,
  computed: ComputedCharacter,
  character: Pick<CharacterData, "spellcastingAttribute">,
  item: Pick<CharacterItem, "save">,
): number | null {
  const formula = def.activation.saveDc;
  if (!formula || !item.save) return null;
  const attrKey = item.save.attribute ?? character.spellcastingAttribute;
  const saveAttr = attrKey ? (computed.attributes[attrKey] ?? 0) : 0;
  const bonus = item.save.bonus;
  const resolveGlobal = makeResolver(computed);
  try {
    return evaluateConstant(substitutePlaceholders(formula, (p) => (p === "saveAttr" ? saveAttr : p === "saveBonus" ? bonus : resolveGlobal(p))));
  } catch (err) {
    if (err instanceof FormulaError || err instanceof DiceParseError) return null;
    throw err;
  }
}

const optionLabel = (options: { key: string; label: string }[], key: string): string => options.find((o) => o.key === key)?.label ?? key;

/** Textos prontos do bloco de ativação, com os rótulos do sistema ("Médio (30 m)", "1 Cena"). Vazio quando não definido. */
export function describeActivation(def: SystemDefinition, a: Activation): { execution: string; duration: string; range: string } {
  const withValue = (value: number, label: string) => (value > 0 ? `${value} ${label}` : label);
  return {
    execution: a.execution ? optionLabel(def.activation.executions, a.execution) : "",
    duration: a.duration.units ? withValue(a.duration.value, optionLabel(def.activation.durationUnits, a.duration.units)) : "",
    range: a.range.units ? withValue(a.range.value, optionLabel(def.activation.rangeUnits, a.range.units)) : "",
  };
}

const EFFECT_MAX = 300;

/** Resumo do efeito: o campo `effect`, ou o começo da descrição quando ele está vazio. */
function summarizeEffect(item: CharacterItem): string {
  const effect = item.activation?.effect.trim() ?? "";
  if (effect) return effect;
  const desc = item.description.trim();
  return desc.length > EFFECT_MAX ? `${desc.slice(0, EFFECT_MAX - 1)}…` : desc;
}

export function buildItemCard(def: SystemDefinition, character: Character, computed: ComputedCharacter, item: CharacterItem, cost: number): ItemCard {
  const kind = def.itemKinds.find((k) => k.key === item.kind);
  const costResource = def.activation.resource ? def.resources.find((r) => r.key === def.activation.resource) : undefined;
  const activation = item.activation ?? { cost: 0, execution: "", duration: { units: "", value: 0 }, range: { units: "", value: 0 }, target: "", area: "", effect: "" };
  const described = describeActivation(def, activation);

  const fields: ItemCard["fields"] = [];
  for (const f of kind?.fields ?? []) {
    const v = item.fields[f.key];
    if (v === undefined || v === "" || v === false) continue;
    const value = f.type === "enum" ? optionLabel(f.options ?? [], String(v)) : f.type === "boolean" ? "sim" : String(v);
    fields.push({ label: f.label, value });
  }

  return {
    characterId: character.id,
    characterName: character.name,
    itemId: item.id,
    itemName: item.name,
    kindLabel: kind?.label ?? item.kind,
    fields,
    cost: cost > 0 && costResource ? { abbr: costResource.abbr, amount: cost } : null,
    execution: described.execution,
    range: described.range,
    duration: described.duration,
    target: activation.target,
    area: activation.area,
    effect: summarizeEffect(item),
    save: item.save
      ? {
          skillLabel: def.skills.find((s) => s.key === item.save?.skill)?.label ?? item.save.skill,
          dc: saveDcFor(def, computed, character, item),
          text: item.save.text,
        }
      : null,
    actions: item.actions.map((a) => ({ id: a.id, label: a.label, kind: a.kind })),
  };
}

export interface ItemUse {
  item: CharacterItem;
  /** Custo efetivo (0 = nada a descontar). */
  cost: number;
  /** Recursos da ficha já com o custo descontado; null quando não há o que descontar. */
  spend: { resourceKey: string; resources: Record<string, CharacterResource> } | null;
  card: ItemCard;
}

/**
 * Valida o uso de um item ativo e prepara o que o servidor precisa persistir e
 * publicar. Lança ItemUseError (mensagem pronta para o ack) se o item não
 * existir, for passivo ou o recurso for insuficiente. Pontos temporários são
 * gastos antes dos atuais.
 */
export function buildItemUse(def: SystemDefinition, character: Character, itemId: string): ItemUse {
  const item = character.items.find((i) => i.id === itemId);
  if (!item) throw new ItemUseError("Item não encontrado");
  if (isPassiveItem(def, item)) throw new ItemUseError(`${item.name} é uma habilidade passiva`);

  const computed = computeCharacter(def, character);
  const cost = effectiveCost(def, character, item);
  const resourceKey = def.activation.resource;

  let spend: ItemUse["spend"] = null;
  if (cost > 0 && resourceKey) {
    const resourceDef = def.resources.find((r) => r.key === resourceKey);
    const current: CharacterResource = character.resources[resourceKey] ?? { current: 0, temp: 0, maxOverride: null };
    const available = current.current + current.temp;
    if (available < cost) {
      throw new ItemUseError(`${resourceDef?.abbr ?? resourceKey} insuficiente: precisa de ${cost}, tem ${available}`);
    }
    const fromTemp = Math.min(current.temp, cost);
    const next: CharacterResource = { ...current, temp: current.temp - fromTemp, current: current.current - (cost - fromTemp) };
    spend = { resourceKey, resources: { ...character.resources, [resourceKey]: next } };
  }

  return { item, cost, spend, card: buildItemCard(def, character, computed, item, cost) };
}
