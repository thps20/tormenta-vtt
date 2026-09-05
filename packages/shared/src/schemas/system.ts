import { z } from "zod";

/**
 * Definição de um sistema de RPG.
 * REGRA DO PROJETO: tudo que é "regra de sistema" mora em um JSON que segue
 * este schema (packages/shared/systems/<id>.json). O código nunca conhece
 * "FOR" ou "Percepção" — só lê a definição.
 */

export const AttributeDefSchema = z.object({
  /** Chave interna e estável, ex.: "for". Usada em fórmulas: {attr.for}. */
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
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
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  /** Atributo-base (key de AttributeDef). */
  attribute: z.string(),
  /** Se true, só pode usar se treinado. */
  trainedOnly: z.boolean().default(false),
  /** Se true, penalidade de armadura se aplica. */
  armorPenalty: z.boolean().default(false),
});
export type SkillDef = z.infer<typeof SkillDefSchema>;

/**
 * Fórmulas usam placeholders entre chaves, resolvidos em tempo de rolagem:
 *   {attr.<key>}      -> valor do atributo (já é o modificador em T20)
 *   {skill.<key>}     -> bônus total da perícia
 *   {level}           -> nível do personagem
 *   {halfLevel}       -> metade do nível (arredondado para baixo)
 *   {trained}         -> bônus de treinamento (depende do nível)
 * O resultado após substituição deve ser uma fórmula de dado válida ("1d20+5").
 */
export const FormulaSchema = z.string().min(1);

export const RollTemplateSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  formula: FormulaSchema,
});
export type RollTemplate = z.infer<typeof RollTemplateSchema>;

export const ResourceDefSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  abbr: z.string().min(1).max(6),
  /** Fórmula do valor máximo (pode usar placeholders). Opcional: valor livre. */
  maxFormula: FormulaSchema.optional(),
});
export type ResourceDef = z.infer<typeof ResourceDefSchema>;

export const SystemDefinitionSchema = z.object({
  /** Versão deste formato de arquivo (para migrar JSONs antigos no futuro). */
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().min(1),
  version: z.string().min(1),
  /** Dado padrão de teste, ex.: "1d20". */
  baseDie: z.string().regex(/^\d*d\d+$/),
  attributes: z.array(AttributeDefSchema).min(1),
  skills: z.array(SkillDefSchema),
  resources: z.array(ResourceDefSchema).default([]),
  /** Fórmulas nomeadas: teste de atributo, teste de perícia, iniciativa etc. */
  rolls: z.object({
    attributeCheck: FormulaSchema,
    skillCheck: FormulaSchema,
    initiative: FormulaSchema,
  }),
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

/** Valida a integridade interna: toda perícia aponta para um atributo que existe. */
export function validateSystemDefinition(input: unknown): SystemDefinition {
  const def = SystemDefinitionSchema.parse(input);
  const attrKeys = new Set(def.attributes.map((a) => a.key));
  for (const skill of def.skills) {
    if (!attrKeys.has(skill.attribute)) {
      throw new Error(
        `Sistema "${def.id}": perícia "${skill.key}" referencia atributo inexistente "${skill.attribute}"`,
      );
    }
  }
  const skillKeys = def.skills.map((s) => s.key);
  const dup = skillKeys.find((k, i) => skillKeys.indexOf(k) !== i);
  if (dup) throw new Error(`Sistema "${def.id}": perícia duplicada "${dup}"`);
  return def;
}
