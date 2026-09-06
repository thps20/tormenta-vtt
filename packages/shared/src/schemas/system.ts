import { z } from "zod";
import { collectPlaceholders } from "../rules/placeholders.js";

/**
 * Definição de um sistema de RPG (schemaVersion 2).
 * REGRA DO PROJETO: tudo que é "regra de sistema" mora em um JSON que segue
 * este schema (packages/shared/systems/<id>.json). O código nunca conhece
 * "FOR" ou "Percepção" — só lê a definição.
 *
 * Ver docs/modelo-personagem.md §3 para o raciocínio de cada bloco.
 */

/** Chave interna e estável, ex.: "for", "percepcao", "armorPenalty" (camelCase permitido). */
export const KeySchema = z.string().regex(/^[a-z][a-zA-Z0-9_]*$/);
export type Key = z.infer<typeof KeySchema>;

/** Par chave/rótulo usado em enumerações (tipos de dano, escolas de magia...). */
export const OptionDefSchema = z.object({ key: KeySchema, label: z.string().min(1) });
export type OptionDef = z.infer<typeof OptionDefSchema>;

/**
 * Fórmulas usam placeholders entre chaves, resolvidos em tempo de cálculo/rolagem:
 *   {attr.<key>}         valor do atributo (já é o modificador em T20)
 *   {skill.<key>}        bônus total da perícia
 *   {derived.<key>}      stat derivado (Defesa, CD...)
 *   {equip.<stat>}       stat agregado dos itens equipados (ver equipStats)
 *   {resource.<key>.max} máximo do recurso
 *   {level} {halfLevel}  nível e metade do nível (arredondado para baixo)
 *   {trainedBonus}       bônus de treino pelo nível (trainedBonus[])
 *   {spellcastingAttr}   valor do atributo de conjuração escolhido na ficha (0 se nenhum)
 * Placeholders contextuais (só valem dentro de certas fórmulas):
 *   {attr} {trained} {sizeMod} {armorPenalty}  em skillTotal / attributeCheck
 *   {skill}                                    em skillCheck / attack (perícia da ação)
 *   {max}                                      em resources[].minFormula
 * O resultado após substituição deve ser uma fórmula válida para o parser em dice/.
 */
export const FormulaSchema = z.string().min(1);

export const AttributeDefSchema = z.object({
  key: KeySchema,
  /** Abreviação exibida, ex.: "FOR". */
  abbr: z.string().min(1).max(6),
  label: z.string().min(1),
  /** Valor inicial ao criar personagem. */
  default: z.number().int(),
  min: z.number().int().optional(),
  max: z.number().int().optional(),
});
export type AttributeDef = z.infer<typeof AttributeDefSchema>;

export const SkillDefSchema = z.object({
  key: KeySchema,
  label: z.string().min(1),
  /** Atributo-base (key de AttributeDef). */
  attribute: KeySchema,
  /** Se true, só pode usar se treinado. */
  trainedOnly: z.boolean().default(false),
  /** Se true, {armorPenalty} entra no total (stat reservado "armorPenalty" de equipStats). */
  armorPenalty: z.boolean().default(false),
  /** Se true, {sizeMod} (sizes[].skillModifier) entra no total. */
  sizeModifier: z.boolean().default(false),
  /** Etiquetas livres para modificadores em grupo: "skill[tag=ataque]". */
  tags: z.array(KeySchema).default([]),
  /** Se true, o personagem pode ter várias instâncias ("oficio:alquimia"). */
  variants: z.boolean().default(false),
});
export type SkillDef = z.infer<typeof SkillDefSchema>;

export const RollTemplateSchema = z.object({
  key: KeySchema,
  label: z.string().min(1),
  formula: FormulaSchema,
});
export type RollTemplate = z.infer<typeof RollTemplateSchema>;

export const ResourceDefSchema = z.object({
  key: KeySchema,
  label: z.string().min(1),
  abbr: z.string().min(1).max(6),
  /** Fórmula do valor máximo. Ausente = máximo digitado na ficha (maxOverride). */
  maxFormula: FormulaSchema.optional(),
  /** Fórmula do mínimo (pode usar {max}). Ausente = 0. */
  minFormula: FormulaSchema.optional(),
  /** Se true, a ficha tem um campo de pontos temporários. */
  hasTemp: z.boolean().default(false),
  /**
   * Máximo acumulado por nível de classe (fase 4: classes como itens). Declarado
   * já no schema para o JSON evoluir sem quebrar; computeCharacter ainda ignora.
   */
  perLevel: z
    .object({
      /** Campo do item de classe com o valor por nível (ex.: "hpPerLevel"). */
      classField: KeySchema,
      /** Atributo somado por nível (ex.: CON para PV). */
      attribute: KeySchema.optional(),
      firstLevelMultiplier: z.number().int().min(1).default(1),
      minPerLevel: z.number().int().optional(),
    })
    .optional(),
});
export type ResourceDef = z.infer<typeof ResourceDefSchema>;

/** Stat calculado por fórmula (Defesa, CD, limite de carga...). */
export const DerivedDefSchema = z.object({
  key: KeySchema,
  label: z.string().min(1),
  abbr: z.string().min(1).max(8).optional(),
  formula: FormulaSchema,
  /** Se true, a ficha permite sobrescrever o valor à mão (derivedOverrides). */
  editable: z.boolean().default(true),
});
export type DerivedDef = z.infer<typeof DerivedDefSchema>;

export const LevelDefSchema = z.object({
  max: z.number().int().min(1),
  /** "manual" = digitado na ficha; "classes" = soma dos itens de classe (fase 4). */
  source: z.enum(["manual", "classes"]).default("manual"),
  /** XP acumulado necessário para cada nível (índice 0 = nível 1). */
  xpTable: z.array(z.number().int().min(0)).optional(),
});
export type LevelDef = z.infer<typeof LevelDefSchema>;

export const SizeDefSchema = z.object({
  key: KeySchema,
  label: z.string().min(1),
  /** Somado em perícias com sizeModifier = true. */
  skillModifier: z.number().int().default(0),
  /** Lado do token em células do grid. */
  tokenCells: z.number().positive().default(1),
});
export type SizeDef = z.infer<typeof SizeDefSchema>;

export const CurrencyDefSchema = z.object({
  key: KeySchema,
  label: z.string().min(1),
  abbr: z.string().min(1).max(6),
  /** Valor em relação à moeda-base (ratio 1). Só informativo por enquanto. */
  ratio: z.number().positive().default(1),
});
export type CurrencyDef = z.infer<typeof CurrencyDefSchema>;

/** Campos de texto/enum da ficha sem regra associada (raça, origem, divindade...). */
export const TraitFieldDefSchema = z.object({
  key: KeySchema,
  label: z.string().min(1),
  type: z.enum(["text", "enum"]).default("text"),
  options: z.array(OptionDefSchema).optional(),
});
export type TraitFieldDef = z.infer<typeof TraitFieldDefSchema>;

/**
 * Stat agregado dos itens EQUIPADOS, acessível como {equip.<key>}.
 * "sum" soma; "min"/"max" pegam o menor/maior entre os itens que definem o stat.
 * `default` vale quando nenhum item equipado define o stat (ex.: limite de
 * atributo na Defesa = 99 sem armadura pesada).
 * Chave reservada: "armorPenalty" alimenta {armorPenalty} das perícias.
 */
export const EquipStatDefSchema = z.object({
  key: KeySchema,
  label: z.string().min(1),
  aggregate: z.enum(["sum", "min", "max"]).default("sum"),
  default: z.number().default(0),
});
export type EquipStatDef = z.infer<typeof EquipStatDefSchema>;

export const ItemFieldDefSchema = z.object({
  key: KeySchema,
  label: z.string().min(1),
  type: z.enum(["enum", "number", "boolean", "text"]),
  options: z.array(OptionDefSchema).optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type ItemFieldDef = z.infer<typeof ItemFieldDefSchema>;

/** Tipo de item (arma, armadura, poder, magia...). Os campos vêm daqui, não do código. */
export const ItemKindDefSchema = z.object({
  key: KeySchema,
  label: z.string().min(1),
  /** Ocupa espaço/peso e pode ser equipado. */
  physical: z.boolean().default(true),
  /** Tem bloco de ativação (custo, execução, duração, alcance...). */
  hasActivation: z.boolean().default(false),
  /** Tem teste de resistência (perícia + CD). */
  hasSave: z.boolean().default(false),
  fields: z.array(ItemFieldDefSchema).default([]),
  /** Stats de equipStats que itens deste tipo podem fornecer quando equipados. */
  statBonuses: z.array(KeySchema).default([]),
});
export type ItemKindDef = z.infer<typeof ItemKindDefSchema>;

/** Enumerações do bloco de ativação (poderes, magias, consumíveis). */
export const ActivationDefSchema = z.object({
  executions: z.array(OptionDefSchema).default([]),
  durationUnits: z.array(OptionDefSchema).default([]),
  rangeUnits: z.array(OptionDefSchema).default([]),
  targetTypes: z.array(OptionDefSchema).default([]),
});
export type ActivationDef = z.infer<typeof ActivationDefSchema>;

export const SystemDefinitionSchema = z.object({
  /** Versão deste formato de arquivo (para migrar JSONs antigos no futuro). */
  schemaVersion: z.literal(2),
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().min(1),
  version: z.string().min(1),
  /** Dado padrão de teste, ex.: "1d20". */
  baseDie: z.string().regex(/^\d*d\d+$/),

  attributes: z.array(AttributeDefSchema).min(1),
  skills: z.array(SkillDefSchema),
  resources: z.array(ResourceDefSchema).default([]),
  derived: z.array(DerivedDefSchema).default([]),
  level: LevelDefSchema,
  sizes: z.array(SizeDefSchema).default([]),
  damageTypes: z.array(OptionDefSchema).default([]),
  currencies: z.array(CurrencyDefSchema).default([]),
  traitFields: z.array(TraitFieldDefSchema).default([]),
  equipStats: z.array(EquipStatDefSchema).default([]),
  itemKinds: z.array(ItemKindDefSchema).default([]),
  activation: ActivationDefSchema.default({}),

  /** Bônus total de uma perícia (sem o dado). Contextuais: {attr} {trained} {sizeMod} {armorPenalty}. */
  skillTotal: FormulaSchema,
  /** Fórmulas nomeadas de rolagem. */
  rolls: z.object({
    attributeCheck: FormulaSchema,
    skillCheck: FormulaSchema,
    initiative: FormulaSchema,
    /** Ataque de uma ação; {skill} é a perícia da ação. Ausente = skillCheck. */
    attack: FormulaSchema.optional(),
  }),
  /**
   * Qual atributo entra no dano quando a ação diz attribute = "auto":
   * lê o campo `field` do item e consulta `map` (null = nenhum atributo).
   */
  damageAttribute: z
    .object({
      field: KeySchema,
      map: z.record(z.string(), KeySchema.nullable()),
    })
    .optional(),
  /** Outras fórmulas específicas do sistema, livres. */
  extraRolls: z.array(RollTemplateSchema).default([]),
  /** Regras de treinamento por faixa de nível (T20: +2/+4/+6). */
  trainedBonus: z
    .array(
      z.object({
        minLevel: z.number().int().min(1),
        bonus: z.number().int(),
      }),
    )
    .default([]),
});
export type SystemDefinition = z.infer<typeof SystemDefinitionSchema>;

/** Placeholders contextuais aceitos por fórmula (além dos globais). */
const CONTEXTUAL: Record<string, string[]> = {
  skillTotal: ["attr", "trained", "sizeMod", "armorPenalty"],
  attributeCheck: ["attr"],
  skillCheck: ["skill"],
  attack: ["skill"],
  minFormula: ["max"],
  maxFormula: [],
  derived: [],
  initiative: [],
  extraRoll: [],
};

function fail(def: { id: string }, msg: string): never {
  throw new Error(`Sistema "${def.id}": ${msg}`);
}

function assertUnique(def: { id: string }, what: string, keys: string[]): void {
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) fail(def, `${what} duplicado(a): "${dup}"`);
}

/**
 * Valida a integridade interna: referências entre blocos e placeholders das
 * fórmulas apontam para chaves que existem. Erros aqui são erros de JSON,
 * então a mensagem diz exatamente o que corrigir.
 */
export function validateSystemDefinition(input: unknown): SystemDefinition {
  const def = SystemDefinitionSchema.parse(input);
  const attrKeys = new Set(def.attributes.map((a) => a.key));
  const skillKeys = new Set(def.skills.map((s) => s.key));
  const resourceKeys = new Set(def.resources.map((r) => r.key));
  const equipKeys = new Set(def.equipStats.map((e) => e.key));

  assertUnique(def, "atributo", [...def.attributes.map((a) => a.key)]);
  assertUnique(def, "perícia", def.skills.map((s) => s.key));
  assertUnique(def, "recurso", def.resources.map((r) => r.key));
  assertUnique(def, "stat derivado", def.derived.map((d) => d.key));
  assertUnique(def, "equipStat", def.equipStats.map((e) => e.key));
  assertUnique(def, "tipo de item", def.itemKinds.map((k) => k.key));

  for (const skill of def.skills) {
    if (!attrKeys.has(skill.attribute)) fail(def, `perícia "${skill.key}" referencia atributo inexistente "${skill.attribute}"`);
  }
  for (const kind of def.itemKinds) {
    for (const stat of kind.statBonuses) {
      if (!equipKeys.has(stat)) fail(def, `tipo de item "${kind.key}" referencia equipStat inexistente "${stat}"`);
    }
    for (const field of kind.fields) {
      if (field.type === "enum" && !field.options?.length) fail(def, `campo "${kind.key}.${field.key}" é enum sem options`);
    }
  }
  if (def.damageAttribute) {
    const { field, map } = def.damageAttribute;
    const fieldDef = def.itemKinds.flatMap((k) => k.fields).find((f) => f.key === field && f.type === "enum");
    if (!fieldDef) fail(def, `damageAttribute.field "${field}" não é um campo enum de nenhum tipo de item`);
    for (const [option, attr] of Object.entries(map)) {
      if (!fieldDef.options?.some((o) => o.key === option)) fail(def, `damageAttribute.map: opção "${option}" não existe em "${field}"`);
      if (attr !== null && !attrKeys.has(attr)) fail(def, `damageAttribute.map["${option}"] referencia atributo inexistente "${attr}"`);
    }
  }

  // Placeholders: cada fórmula só pode usar caminhos que existem.
  const derivedSoFar = new Set<string>();
  const check = (formula: string, where: string, contextual: string[]) => {
    for (const path of collectPlaceholders(formula)) {
      if (contextual.includes(path)) continue;
      if (["level", "halfLevel", "trainedBonus", "spellcastingAttr"].includes(path)) continue;
      const [head, key, tail] = path.split(".");
      const ok =
        (head === "attr" && key !== undefined && attrKeys.has(key) && tail === undefined) ||
        (head === "skill" && key !== undefined && skillKeys.has(key.split(":")[0] ?? "") && tail === undefined) ||
        (head === "derived" && key !== undefined && derivedSoFar.has(key) && tail === undefined) ||
        (head === "equip" && key !== undefined && equipKeys.has(key) && tail === undefined) ||
        (head === "resource" && key !== undefined && resourceKeys.has(key) && tail === "max");
      if (!ok) fail(def, `${where}: placeholder {${path}} não é reconhecido`);
    }
  };

  for (const d of def.derived) {
    check(d.formula, `derived "${d.key}"`, CONTEXTUAL.derived ?? []);
    derivedSoFar.add(d.key);
  }
  check(def.skillTotal, "skillTotal", CONTEXTUAL.skillTotal ?? []);
  check(def.rolls.attributeCheck, "rolls.attributeCheck", CONTEXTUAL.attributeCheck ?? []);
  check(def.rolls.skillCheck, "rolls.skillCheck", CONTEXTUAL.skillCheck ?? []);
  check(def.rolls.initiative, "rolls.initiative", CONTEXTUAL.initiative ?? []);
  if (def.rolls.attack) check(def.rolls.attack, "rolls.attack", CONTEXTUAL.attack ?? []);
  for (const r of def.resources) {
    if (r.maxFormula) check(r.maxFormula, `resource "${r.key}".maxFormula`, CONTEXTUAL.maxFormula ?? []);
    if (r.minFormula) check(r.minFormula, `resource "${r.key}".minFormula`, CONTEXTUAL.minFormula ?? []);
  }
  for (const r of def.extraRolls) check(r.formula, `extraRoll "${r.key}"`, CONTEXTUAL.extraRoll ?? []);

  return def;
}
