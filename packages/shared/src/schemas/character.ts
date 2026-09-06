import { z } from "zod";
import { IdSchema } from "./common.js";
import { KeySchema } from "./system.js";
import { ModifierTargetSchema } from "../rules/modifierTarget.js";

/**
 * Ficha de personagem. Agnóstica de sistema: todo Record<key, ...> é indexado
 * pelas chaves do JSON do sistema (attributes[].key, skills[].key...). O que a
 * ficha guarda são ENTRADAS (base do atributo, treinado, itens); os valores
 * finais vêm de computeCharacter (rules/compute.ts) e nunca são persistidos.
 *
 * No banco, tudo abaixo de CharacterDataSchema vai numa coluna `data Json`
 * (validada por Zod na fronteira); id, roomId, ownerId, name e kind são colunas.
 */

/** Chave de perícia, com variante opcional: "oficio:alquimia". */
export const SkillInstanceKeySchema = z.string().regex(/^[a-z][a-zA-Z0-9_]*(?::[a-z0-9_]+)?$/);

export const ModifierSchema = z.object({
  id: IdSchema,
  label: z.string().max(80).default(""),
  target: ModifierTargetSchema,
  value: z.number().int(),
  /** Item que originou o modificador (opcional). */
  source: IdSchema.nullable().default(null),
  enabled: z.boolean().default(true),
});
export type Modifier = z.infer<typeof ModifierSchema>;

const ActionBase = { id: IdSchema, label: z.string().min(1).max(60) };

/** Uma rolagem que um item oferece (ataque, dano, teste, fórmula livre). */
export const ActionSchema = z.discriminatedUnion("kind", [
  z.object({
    ...ActionBase,
    kind: z.literal("attack"),
    /** Perícia usada no ataque (ex.: luta, pontaria). */
    skill: KeySchema,
    /** Troca o atributo da perícia (ex.: arma ágil usa DES em vez de FOR). */
    attributeOverride: KeySchema.nullable().default(null),
    bonus: z.number().int().default(0),
    /** Resultado natural do dado a partir do qual é crítico. */
    critRange: z.number().int().min(1).default(20),
    critMult: z.number().int().min(1).default(2),
  }),
  z.object({
    ...ActionBase,
    kind: z.literal("damage"),
    /** Fórmula de dado, ex.: "1d8". Pode usar placeholders. */
    formula: z.string().min(1).max(200),
    /** "auto" = regra damageAttribute do sistema; null = nenhum; ou uma chave de atributo. */
    attribute: z.union([z.literal("auto"), KeySchema]).nullable().default("auto"),
    damageType: KeySchema.nullable().default(null),
    bonus: z.number().int().default(0),
  }),
  z.object({
    ...ActionBase,
    kind: z.literal("check"),
    skill: KeySchema,
    bonus: z.number().int().default(0),
  }),
  z.object({
    ...ActionBase,
    kind: z.literal("formula"),
    formula: z.string().min(1).max(200),
  }),
]);
export type Action = z.infer<typeof ActionSchema>;

/** Bloco de ativação (poderes, magias, consumíveis). Chaves vêm de system.activation. */
export const ActivationSchema = z.object({
  /** Custo em pontos do recurso de ativação (PM em T20). */
  cost: z.number().int().min(0).default(0),
  execution: z.string().max(40).default(""),
  duration: z.object({ units: z.string().max(40).default(""), value: z.number().min(0).default(0) }).default({}),
  range: z.object({ units: z.string().max(40).default(""), value: z.number().min(0).default(0) }).default({}),
  target: z.string().max(200).default(""),
  area: z.string().max(200).default(""),
  effect: z.string().max(2000).default(""),
});
export type Activation = z.infer<typeof ActivationSchema>;

/** Teste de resistência exigido pelo item. A CD vem de derived (ex.: "dc"). */
export const SaveSchema = z.object({
  skill: KeySchema,
  /** Atributo que entra na CD, se o sistema variar por item (null = padrão). */
  attribute: KeySchema.nullable().default(null),
  bonus: z.number().int().default(0),
  text: z.string().max(500).default(""),
});
export type Save = z.infer<typeof SaveSchema>;

/**
 * Valores dos campos estruturados de item (ItemFieldType em system.ts). Todas as
 * chaves são obrigatórias e os objetos são estritos de propósito: como o valor
 * de um campo é uma união, é a forma que diz qual tipo é.
 */
/** attributeBonuses: { con: 2, sab: 1, des: -1 }. */
export const AttributeBonusesValueSchema = z.record(KeySchema, z.number().int());
export type AttributeBonusesValue = z.infer<typeof AttributeBonusesValueSchema>;

/** attributeChoice: +amount em `count` atributos diferentes, escolhidos em `chosen` (fora de `exclude`). */
export const AttributeChoiceValueSchema = z
  .object({
    amount: z.number().int(),
    count: z.number().int().min(0),
    exclude: z.array(KeySchema),
    chosen: z.array(KeySchema),
  })
  .strict();
export type AttributeChoiceValue = z.infer<typeof AttributeChoiceValueSchema>;

/** skillGrants: perícias treinadas fixas + grupos "escolha `count` de `from`" (`from` vazio = qualquer). */
export const SkillGrantsValueSchema = z
  .object({
    fixed: z.array(SkillInstanceKeySchema),
    choices: z.array(
      z
        .object({
          count: z.number().int().min(1),
          from: z.array(KeySchema),
          chosen: z.array(SkillInstanceKeySchema),
        })
        .strict(),
    ),
  })
  .strict();
export type SkillGrantsValue = z.infer<typeof SkillGrantsValueSchema>;

export const ItemFieldValueSchema = z.union([z.string().max(500), z.number(), z.boolean(), AttributeChoiceValueSchema, SkillGrantsValueSchema, AttributeBonusesValueSchema]);
export type ItemFieldValue = z.infer<typeof ItemFieldValueSchema>;

export const CharacterItemSchema = z.object({
  id: IdSchema,
  /** Chave de itemKinds[] do sistema. */
  kind: KeySchema,
  name: z.string().min(1).max(80),
  description: z.string().max(4000).default(""),
  quantity: z.number().int().min(0).default(1),
  equipped: z.boolean().default(false),
  /** Espaços/peso e preço: só informativos por enquanto. */
  slots: z.number().min(0).default(0),
  price: z.number().min(0).default(0),
  /** Valores dos campos declarados em itemKinds[].fields. */
  fields: z.record(z.string(), ItemFieldValueSchema).default({}),
  /** Stats fornecidos quando equipado (chaves de equipStats). */
  statBonuses: z.record(KeySchema, z.number()).default({}),
  actions: z.array(ActionSchema).default([]),
  activation: ActivationSchema.nullable().default(null),
  save: SaveSchema.nullable().default(null),
});
export type CharacterItem = z.infer<typeof CharacterItemSchema>;

export const CharacterSkillSchema = z.object({
  trained: z.boolean().default(false),
  /** Bônus fixo digitado ("outros"). */
  other: z.number().int().default(0),
  /** Atributo alternativo (null = o da definição). */
  attribute: KeySchema.nullable().default(null),
  /** Nome da variante (ex.: "Alquimia" para oficio:alquimia). */
  label: z.string().max(40).optional(),
});
export type CharacterSkill = z.infer<typeof CharacterSkillSchema>;

export const CharacterResourceSchema = z.object({
  current: z.number().int().default(0),
  temp: z.number().int().min(0).default(0),
  /** Máximo digitado. null = usar maxFormula do sistema (ou 0 se não houver). */
  maxOverride: z.number().int().nullable().default(null),
});
export type CharacterResource = z.infer<typeof CharacterResourceSchema>;

export const CharacterKindSchema = z.enum(["pc", "npc"]);
export type CharacterKind = z.infer<typeof CharacterKindSchema>;

/** Conteúdo da coluna `data` + campos editáveis. */
export const CharacterDataSchema = z.object({
  imageUrl: z.string().nullable().default(null),
  /** Nível digitado. Ignorado quando as classes mandam (level.source = "classes", há classe e manualProgression = false). */
  level: z.number().int().min(0).default(1),
  xp: z.number().int().min(0).default(0),
  /** true = ignora as classes: nível e máximos dos recursos voltam a ser digitados (level, maxOverride). */
  manualProgression: z.boolean().default(false),
  attributes: z.record(KeySchema, z.object({ base: z.number().int() })).default({}),
  skills: z.record(SkillInstanceKeySchema, CharacterSkillSchema).default({}),
  resources: z.record(KeySchema, CharacterResourceSchema).default({}),
  /** Valor forçado para um stat derivado (ex.: Defesa 18 num NPC). */
  derivedOverrides: z.record(KeySchema, z.number()).default({}),
  modifiers: z.array(ModifierSchema).default([]),
  /** Campos de traitFields[] do sistema. */
  traits: z.record(KeySchema, z.string().max(500)).default({}),
  currency: z.record(KeySchema, z.number().min(0)).default({}),
  size: KeySchema.nullable().default(null),
  spellcastingAttribute: KeySchema.nullable().default(null),
  bio: z.string().max(20000).default(""),
  items: z.array(CharacterItemSchema).default([]),
});
export type CharacterData = z.infer<typeof CharacterDataSchema>;

export const CharacterSchema = CharacterDataSchema.extend({
  id: IdSchema,
  roomId: IdSchema,
  /** Participante dono (pode editar/rolar). null = só o GM. */
  ownerId: IdSchema.nullable(),
  name: z.string().min(1).max(80),
  /** npc: só o GM vê. */
  kind: CharacterKindSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Character = z.infer<typeof CharacterSchema>;

/** Pedido de rolagem a partir da ficha (o servidor monta a fórmula e rola). */
export const CharacterRollRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("attribute"), key: KeySchema }),
  z.object({ type: z.literal("skill"), key: SkillInstanceKeySchema }),
  z.object({ type: z.literal("initiative") }),
  z.object({ type: z.literal("extra"), key: KeySchema }),
  z.object({ type: z.literal("action"), itemId: IdSchema, actionId: IdSchema }),
]);
export type CharacterRollRequest = z.infer<typeof CharacterRollRequestSchema>;

/**
 * Card publicado no chat quando um item ativo é usado (character:use-item).
 * Denormalizado de propósito: guarda rótulos já resolvidos pelo JSON do sistema,
 * então o histórico continua legível mesmo se o item mudar ou for apagado.
 * `actions` só guarda ids: o botão no chat dispara character:roll { type: "action" }.
 */
export const ItemCardSchema = z.object({
  characterId: IdSchema,
  characterName: z.string().max(80),
  itemId: IdSchema,
  itemName: z.string().max(80),
  kindLabel: z.string().max(40),
  /** Campos do tipo com rótulo (ex.: "Círculo: 1", "Escola: Evocação"). */
  fields: z.array(z.object({ label: z.string().max(40), value: z.string().max(200) })),
  /** Custo efetivo já descontado; null = sem custo. */
  cost: z.object({ abbr: z.string().max(6), amount: z.number().int().min(0) }).nullable(),
  execution: z.string().max(60),
  range: z.string().max(60),
  duration: z.string().max(60),
  target: z.string().max(200),
  area: z.string().max(200),
  effect: z.string().max(2000),
  /** CD calculada (null quando o sistema não define saveDc). */
  save: z.object({ skillLabel: z.string().max(40), dc: z.number().int().nullable(), text: z.string().max(500) }).nullable(),
  actions: z.array(z.object({ id: IdSchema, label: z.string().max(60), kind: z.string().max(20) })),
});
export type ItemCard = z.infer<typeof ItemCardSchema>;
