/**
 * Regras do compêndio: validar uma entrada contra o JSON do sistema e copiá-la
 * para a ficha como um CharacterItem novo. Nada aqui conhece "class", "for" ou
 * "luta": tudo é lido de itemKinds[], attributes[], skills[] etc.
 */
import {
  AttributeBonusesValueSchema,
  AttributeChoiceValueSchema,
  CharacterItemSchema,
  SkillGrantsValueSchema,
  type CharacterItem,
} from "../schemas/character.js";
import type { CompendiumEntry, CompendiumSource } from "../schemas/compendium.js";
import type { ItemFieldDef, SystemDefinition } from "../schemas/system.js";
import { saveSkills } from "./activation.js";
import { emptyFieldValue } from "./progression.js";

const baseSkill = (key: string) => key.split(":")[0] ?? "";

/** Mensagem de erro do valor de um campo, ou null se o valor serve para o tipo declarado. */
function fieldValueError(def: SystemDefinition, field: ItemFieldDef, value: unknown): string | null {
  const attrKeys = new Set(def.attributes.map((a) => a.key));
  const skillKeys = new Set(def.skills.map((s) => s.key));
  switch (field.type) {
    case "enum":
      return typeof value === "string" && field.options?.some((o) => o.key === value) ? null : `opção desconhecida "${String(value)}"`;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? null : "esperado número";
    case "boolean":
      return typeof value === "boolean" ? null : "esperado booleano";
    case "text":
      return typeof value === "string" ? null : "esperado texto";
    case "size":
      return typeof value === "string" && def.sizes.some((s) => s.key === value) ? null : `tamanho desconhecido "${String(value)}"`;
    case "attributeBonuses": {
      const parsed = AttributeBonusesValueSchema.safeParse(value);
      if (!parsed.success) return "esperado { <atributo>: n }";
      const bad = Object.keys(parsed.data).find((k) => !attrKeys.has(k));
      return bad ? `atributo desconhecido "${bad}"` : null;
    }
    case "attributeChoice": {
      const parsed = AttributeChoiceValueSchema.safeParse(value);
      if (!parsed.success) return "esperado { amount, count, exclude, chosen }";
      const bad = [...parsed.data.exclude, ...parsed.data.chosen].find((k) => !attrKeys.has(k));
      return bad ? `atributo desconhecido "${bad}"` : null;
    }
    case "skillGrants": {
      const parsed = SkillGrantsValueSchema.safeParse(value);
      if (!parsed.success) return "esperado { fixed, choices }";
      const all = [...parsed.data.fixed, ...parsed.data.choices.flatMap((c) => [...c.from, ...c.chosen])];
      const bad = all.find((k) => !skillKeys.has(baseSkill(k)));
      return bad ? `perícia desconhecida "${bad}"` : null;
    }
  }
}

/**
 * Confere o que o Zod não sabe sozinho: a entrada faz sentido para ESTE
 * sistema. Devolve a mensagem do primeiro problema, ou null se está tudo certo.
 */
export function validateCompendiumEntry(def: SystemDefinition, entry: CompendiumEntry): string | null {
  const where = `entrada "${entry.id}"`;
  const kind = def.itemKinds.find((k) => k.key === entry.kind);
  if (!kind) return `${where}: tipo de item desconhecido "${entry.kind}"`;

  for (const [key, value] of Object.entries(entry.fields)) {
    const field = kind.fields.find((f) => f.key === key);
    if (!field) return `${where}: campo "${key}" não existe em "${kind.key}"`;
    const err = fieldValueError(def, field, value);
    if (err) return `${where}: campo "${key}": ${err}`;
  }

  for (const stat of Object.keys(entry.statBonuses)) {
    if (!kind.statBonuses.includes(stat)) return `${where}: "${kind.key}" não fornece o stat "${stat}"`;
  }

  if (entry.activation && !kind.hasActivation) return `${where}: "${kind.key}" não tem bloco de ativação`;
  if (entry.activation) {
    const a = entry.activation;
    const { executions, durationUnits, rangeUnits } = def.activation;
    if (a.execution && !executions.some((e) => e.key === a.execution)) return `${where}: execução desconhecida "${a.execution}"`;
    if (a.duration.units && !durationUnits.some((u) => u.key === a.duration.units)) return `${where}: unidade de duração desconhecida "${a.duration.units}"`;
    if (a.range.units && !rangeUnits.some((u) => u.key === a.range.units)) return `${where}: unidade de alcance desconhecida "${a.range.units}"`;
  }

  if (entry.enhancements.length > 0 && !kind.hasActivation) return `${where}: "${kind.key}" não tem bloco de ativação (aprimoramentos)`;
  const enhancementIds = new Set<string>();
  for (const e of entry.enhancements) {
    if (enhancementIds.has(e.id)) return `${where}: aprimoramento "${e.id}" repetido`;
    enhancementIds.add(e.id);
    const effect = e.effect;
    if (effect?.kind === "damageDiceAdd" && effect.damageType !== undefined && !def.damageTypes.some((d) => d.key === effect.damageType)) {
      return `${where}: aprimoramento "${e.id}": tipo de dano desconhecido "${effect.damageType}"`;
    }
  }

  if (entry.save && !kind.hasSave) return `${where}: "${kind.key}" não tem teste de resistência`;
  if (entry.save) {
    if (!saveSkills(def).some((s) => s.key === entry.save?.skill)) return `${where}: "${entry.save.skill}" não é perícia de resistência`;
    if (entry.save.attribute !== null && !def.attributes.some((a) => a.key === entry.save?.attribute)) return `${where}: atributo desconhecido "${entry.save.attribute}"`;
  }

  const attrKeys = new Set(def.attributes.map((a) => a.key));
  const skillKeys = new Set(def.skills.map((s) => s.key));
  const attackSkills = def.attackSkills.length > 0 ? new Set(def.attackSkills) : skillKeys;
  for (const action of entry.actions) {
    const at = `${where}: ação "${action.label}"`;
    if (action.kind === "attack") {
      if (!attackSkills.has(action.skill)) return `${at}: "${action.skill}" não é perícia de ataque`;
      if (action.attributeOverride !== null && !attrKeys.has(action.attributeOverride)) return `${at}: atributo desconhecido "${action.attributeOverride}"`;
    } else if (action.kind === "damage") {
      if (action.attribute !== null && action.attribute !== "auto" && !attrKeys.has(action.attribute)) return `${at}: atributo desconhecido "${action.attribute}"`;
      if (action.damageType !== null && !def.damageTypes.some((d) => d.key === action.damageType)) return `${at}: tipo de dano desconhecido "${action.damageType}"`;
    } else if (action.kind === "check") {
      if (!skillKeys.has(baseSkill(action.skill))) return `${at}: perícia desconhecida "${action.skill}"`;
    }
  }
  return null;
}

/**
 * Copia a entrada para um CharacterItem novo. Campos que a entrada não define
 * recebem o default do sistema (como um item criado em branco); ações ganham
 * ids próprios. `newId` é injetado porque shared não escolhe como gerar ids.
 */
export function entryToItem(def: SystemDefinition, entry: CompendiumEntry, newId: () => string): CharacterItem {
  const kind = def.itemKinds.find((k) => k.key === entry.kind);
  if (!kind) throw new Error(`Tipo de item desconhecido: ${entry.kind}`);
  const fields: CharacterItem["fields"] = {};
  for (const f of kind.fields) fields[f.key] = f.default !== undefined ? f.default : emptyFieldValue(def, f);
  Object.assign(fields, entry.fields);
  return CharacterItemSchema.parse({
    id: newId(),
    kind: entry.kind,
    name: entry.name,
    description: entry.description,
    slots: entry.slots,
    price: entry.price,
    fields,
    statBonuses: entry.statBonuses,
    actions: entry.actions.map((a) => ({ ...a, id: newId() })),
    activation: kind.hasActivation ? (entry.activation ?? {}) : null,
    enhancements: kind.hasActivation ? entry.enhancements : [],
    save: kind.hasSave ? entry.save : null,
    page: entry.page,
  });
}

/**
 * Junta várias fontes (sistema, sala...) numa lista só. Quando dois ids
 * coincidem, vence a fonte de maior prioridade; a ordem de saída segue a
 * fonte de maior prioridade primeiro.
 */
export function mergeCompendium(sources: CompendiumSource[]): CompendiumEntry[] {
  const byId = new Map<string, CompendiumEntry>();
  for (const source of [...sources].sort((a, b) => b.priority - a.priority)) {
    for (const entry of source.entries) if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  return [...byId.values()];
}
