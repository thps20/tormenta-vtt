/**
 * Regras do compêndio: validar uma entrada (item ou criatura) contra o JSON do sistema e copiá-la
 * para a ficha (item novo, ou Character `npc` novo). Nada aqui conhece "class", "for" ou "luta":
 * tudo é lido de itemKinds[], attributes[], skills[] etc.
 */
import {
  AttributeBonusesValueSchema,
  AttributeChoiceValueSchema,
  CharacterDataSchema,
  CharacterItemSchema,
  SkillGrantsValueSchema,
  type CharacterData,
  type CharacterItem,
} from "../schemas/character.js";
import type { CompendiumCreatureEntry, CompendiumEntry, CompendiumItemBody, CompendiumSource } from "../schemas/compendium.js";
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
 * Confere um CORPO de item (entrada avulsa ou item embutido no `sheet` de uma criatura) contra o
 * sistema: tipo existe, campos declarados com valor do tipo certo, ativação/resistência só nos
 * tipos que têm, stats permitidos, ações usam perícias corretas. `where` identifica a entrada nas
 * mensagens de erro (a entrada avulsa e o item embutido usam prefixos diferentes).
 */
export function validateItemBody(def: SystemDefinition, body: CompendiumItemBody, where: string): string | null {
  const kind = def.itemKinds.find((k) => k.key === body.kind);
  if (!kind) return `${where}: tipo de item desconhecido "${body.kind}"`;

  for (const [key, value] of Object.entries(body.fields)) {
    const field = kind.fields.find((f) => f.key === key);
    if (!field) return `${where}: campo "${key}" não existe em "${kind.key}"`;
    const err = fieldValueError(def, field, value);
    if (err) return `${where}: campo "${key}": ${err}`;
  }

  for (const stat of Object.keys(body.statBonuses)) {
    if (!kind.statBonuses.includes(stat)) return `${where}: "${kind.key}" não fornece o stat "${stat}"`;
  }

  if (body.activation && !kind.hasActivation) return `${where}: "${kind.key}" não tem bloco de ativação`;
  if (body.activation) {
    const a = body.activation;
    const { executions, durationUnits, rangeUnits } = def.activation;
    if (a.execution && !executions.some((e) => e.key === a.execution)) return `${where}: execução desconhecida "${a.execution}"`;
    if (a.duration.units && !durationUnits.some((u) => u.key === a.duration.units)) return `${where}: unidade de duração desconhecida "${a.duration.units}"`;
    if (a.range.units && !rangeUnits.some((u) => u.key === a.range.units)) return `${where}: unidade de alcance desconhecida "${a.range.units}"`;
  }

  if (body.enhancements.length > 0 && !kind.hasActivation) return `${where}: "${kind.key}" não tem bloco de ativação (aprimoramentos)`;
  const enhancementIds = new Set<string>();
  for (const e of body.enhancements) {
    if (enhancementIds.has(e.id)) return `${where}: aprimoramento "${e.id}" repetido`;
    enhancementIds.add(e.id);
    const effect = e.effect;
    if (effect?.kind === "damageDiceAdd" && effect.damageType !== undefined && !def.damageTypes.some((d) => d.key === effect.damageType)) {
      return `${where}: aprimoramento "${e.id}": tipo de dano desconhecido "${effect.damageType}"`;
    }
  }

  if (body.save && !kind.hasSave) return `${where}: "${kind.key}" não tem teste de resistência`;
  if (body.save) {
    if (!saveSkills(def).some((s) => s.key === body.save?.skill)) return `${where}: "${body.save.skill}" não é perícia de resistência`;
    if (body.save.attribute !== null && !def.attributes.some((a) => a.key === body.save?.attribute)) return `${where}: atributo desconhecido "${body.save.attribute}"`;
  }

  const attrKeys = new Set(def.attributes.map((a) => a.key));
  const skillKeys = new Set(def.skills.map((s) => s.key));
  const attackSkills = def.attackSkills.length > 0 ? new Set(def.attackSkills) : skillKeys;
  for (const action of body.actions) {
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
 * Confere um bloco de criatura (ficha `sheet` inteira + itens embutidos) contra o sistema: toda
 * chave usada (atributo, perícia, recurso, derivado, traço, moeda, tipo de dano) existe; `size` e
 * `spellcastingAttribute` são válidos; `derivedOverrides` só usa derivados editáveis (senão o
 * override seria silenciosamente ignorado por computeCharacter); o tipo de criatura é uma opção
 * declarada do `creatures.typeField`; cada item embutido passa por validateItemBody.
 */
function validateCreatureEntry(def: SystemDefinition, entry: CompendiumCreatureEntry, where: string): string | null {
  const creatures = def.creatures;
  if (!creatures) return `${where}: sistema "${def.id}" não declara o bloco creatures (sem suporte a criaturas)`;
  const sheet = entry.sheet;

  const attrKeys = new Set(def.attributes.map((a) => a.key));
  const skillKeys = new Set(def.skills.map((s) => s.key));
  const resourceKeys = new Set(def.resources.map((r) => r.key));
  const derivedByKey = new Map(def.derived.map((d) => [d.key, d]));

  for (const key of Object.keys(sheet.attributes)) {
    if (!attrKeys.has(key)) return `${where}: atributo desconhecido "${key}"`;
  }
  for (const key of Object.keys(sheet.skills)) {
    if (!skillKeys.has(baseSkill(key))) return `${where}: perícia desconhecida "${key}"`;
  }
  for (const key of Object.keys(sheet.resources)) {
    if (!resourceKeys.has(key)) return `${where}: recurso desconhecido "${key}"`;
  }
  for (const key of Object.keys(sheet.derivedOverrides)) {
    const derived = derivedByKey.get(key);
    if (!derived) return `${where}: stat derivado desconhecido "${key}"`;
    if (!derived.editable) return `${where}: stat derivado "${key}" não é editável (derivedOverrides seria ignorado)`;
  }
  for (const key of Object.keys(sheet.traits)) {
    if (!def.traitFields.some((f) => f.key === key)) return `${where}: campo de traço desconhecido "${key}"`;
  }
  for (const key of Object.keys(sheet.currency)) {
    if (!def.currencies.some((c) => c.key === key)) return `${where}: moeda desconhecida "${key}"`;
  }
  if (sheet.size !== null && !def.sizes.some((s) => s.key === sheet.size)) return `${where}: tamanho desconhecido "${sheet.size}"`;
  if (sheet.spellcastingAttribute !== null && !attrKeys.has(sheet.spellcastingAttribute)) {
    return `${where}: atributo de conjuração desconhecido "${sheet.spellcastingAttribute}"`;
  }
  for (const key of Object.keys(sheet.damageResponses.byType)) {
    if (!def.damageTypes.some((d) => d.key === key)) return `${where}: tipo de dano desconhecido "${key}"`;
  }

  const typeFieldDef = def.traitFields.find((f) => f.key === creatures.typeField);
  const typeValue = sheet.traits[creatures.typeField];
  if (typeValue !== undefined && !typeFieldDef?.options?.some((o) => o.key === typeValue)) {
    return `${where}: tipo de criatura desconhecido "${typeValue}"`;
  }

  for (const [i, item] of sheet.items.entries()) {
    const err = validateItemBody(def, item, `${where}, item #${i + 1} ("${item.name}")`);
    if (err) return err;
  }
  return null;
}

/**
 * Confere o que o Zod não sabe sozinho: a entrada faz sentido para ESTE
 * sistema. Devolve a mensagem do primeiro problema, ou null se está tudo certo.
 */
export function validateCompendiumEntry(def: SystemDefinition, entry: CompendiumEntry): string | null {
  const where = `entrada "${entry.id}"`;
  if (entry.type === "creature") return validateCreatureEntry(def, entry, where);
  return validateItemBody(def, entry, where);
}

/**
 * Copia um corpo de item para um CharacterItem novo. Campos que o corpo não define recebem o
 * default do sistema (como um item criado em branco); ações ganham ids próprios. `newId` é
 * injetado porque shared não escolhe como gerar ids. Serve tanto para uma entrada de item avulsa
 * quanto para um item embutido no `sheet` de uma criatura — os dois são um CompendiumItemBody.
 */
export function entryToItem(def: SystemDefinition, body: CompendiumItemBody, newId: () => string): CharacterItem {
  const kind = def.itemKinds.find((k) => k.key === body.kind);
  if (!kind) throw new Error(`Tipo de item desconhecido: ${body.kind}`);
  const fields: CharacterItem["fields"] = {};
  for (const f of kind.fields) fields[f.key] = f.default !== undefined ? f.default : emptyFieldValue(def, f);
  Object.assign(fields, body.fields);
  return CharacterItemSchema.parse({
    id: newId(),
    kind: body.kind,
    name: body.name,
    description: body.description,
    slots: body.slots,
    price: body.price,
    fields,
    statBonuses: body.statBonuses,
    actions: body.actions.map((a) => ({ ...a, id: newId() })),
    activation: kind.hasActivation ? (body.activation ?? {}) : null,
    enhancements: kind.hasActivation ? body.enhancements : [],
    save: kind.hasSave ? body.save : null,
    page: body.page,
  });
}

/**
 * Copia uma entrada de criatura como ficha NPC nova: a `sheet` inteira, com os itens embutidos
 * virando CharacterItem (entryToItem), sem imagem e sem biografia (como qualquer cópia do
 * compêndio). `opts.name` sobrescreve o nome (soltura em lote numerada: "Goblin 1", "Goblin 2"...);
 * sem ele, usa `entry.name`. `ownerId`/vínculo ao token ficam por conta de quem chama.
 */
export function entryToCharacter(
  def: SystemDefinition,
  entry: CompendiumCreatureEntry,
  newId: () => string,
  opts: { name?: string } = {},
): { name: string; kind: "npc"; data: CharacterData } {
  const data = CharacterDataSchema.parse({
    ...entry.sheet,
    imageUrl: null,
    bio: "",
    items: entry.sheet.items.map((body) => entryToItem(def, body, newId)),
  });
  return { name: opts.name ?? entry.name, kind: "npc", data };
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
