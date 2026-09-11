import { z } from "zod";
import { IdSchema } from "./common.js";
import { KeySchema } from "./system.js";
import { TemplateShapeSchema } from "./template.js";
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

const ActionLabel = { label: z.string().min(1).max(60) };

/**
 * Corpo de cada tipo de ação, SEM id. O compêndio guarda ações neste formato
 * (ActionTemplateSchema); a ficha usa ActionSchema, que acrescenta o id.
 */
const AttackActionBody = z.object({
  ...ActionLabel,
  kind: z.literal("attack"),
  /** Perícia usada no ataque (ex.: luta, pontaria). */
  skill: KeySchema,
  /** Troca o atributo da perícia (ex.: arma ágil usa DES em vez de FOR). */
  attributeOverride: KeySchema.nullable().default(null),
  bonus: z.number().int().default(0),
  /** Resultado natural do dado a partir do qual é crítico. */
  critRange: z.number().int().min(1).default(20),
  critMult: z.number().int().min(1).default(2),
});
const DamageActionBody = z.object({
  ...ActionLabel,
  kind: z.literal("damage"),
  /** Fórmula de dado, ex.: "1d8". Pode usar placeholders. */
  formula: z.string().min(1).max(200),
  /** "auto" = regra damageAttribute do sistema; null = nenhum; ou uma chave de atributo. */
  attribute: z.union([z.literal("auto"), KeySchema]).nullable().default("auto"),
  damageType: KeySchema.nullable().default(null),
  bonus: z.number().int().default(0),
});
const CheckActionBody = z.object({
  ...ActionLabel,
  kind: z.literal("check"),
  skill: KeySchema,
  bonus: z.number().int().default(0),
});
const FormulaActionBody = z.object({
  ...ActionLabel,
  kind: z.literal("formula"),
  formula: z.string().min(1).max(200),
  /**
   * null (padrão) = fórmula livre "crua", sem parcela de dano (comportamento de sempre).
   * Definido = a rolagem também vira `damage: [{ formula, damageType }]` (uma parcela só, com a
   * fórmula exatamente como escrita — sem somar atributo/bônus nem passar por aprimoramentos, ao
   * contrário da ação `damage`), só o suficiente pra ligar "Aplicar" no card do chat.
   */
  damageType: KeySchema.nullable().default(null),
});

/** Ação sem id: formato das entradas do compêndio (o id nasce ao copiar para a ficha). */
export const ActionTemplateSchema = z.discriminatedUnion("kind", [AttackActionBody, DamageActionBody, CheckActionBody, FormulaActionBody]);
export type ActionTemplate = z.infer<typeof ActionTemplateSchema>;

const withId = { id: IdSchema };
/** Uma rolagem que um item oferece (ataque, dano, teste, fórmula livre). */
export const ActionSchema = z.discriminatedUnion("kind", [
  AttackActionBody.extend(withId),
  DamageActionBody.extend(withId),
  CheckActionBody.extend(withId),
  FormulaActionBody.extend(withId),
]);
export type Action = z.infer<typeof ActionSchema>;

/**
 * Área de um item ativo (docs/plano-gabaritos.md §6): forma reconhecida (a ferramenta "Área" do
 * mapa consegue colocar sozinha) ou texto livre ("especial": vários alvos, ver descrição). `size`
 * na unidade do `grid` do sistema (m em T20), igual ao tamanho da ferramenta/presets.
 * `preprocess` migra o formato antigo (string solta) sem precisar de migration de banco: cards e
 * fichas persistidos (`Character.data`/`ChatMessage.item`, ambos `Json`) continuam lendo certo —
 * ver `ItemCardSchema.area` abaixo, que reusa este mesmo schema pelo mesmo motivo.
 */
export const TemplateAreaSchema = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() ? { kind: "text", text: v.trim().slice(0, 200) } : null) : v),
  z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("shape"), shape: TemplateShapeSchema, size: z.number().positive() }),
      z.object({ kind: z.literal("text"), text: z.string().max(200) }),
    ])
    .nullable(),
);
export type TemplateArea = z.infer<typeof TemplateAreaSchema>;

/** Bloco de ativação (poderes, magias, consumíveis). Chaves vêm de system.activation. */
export const ActivationSchema = z.object({
  /** Custo em pontos do recurso de ativação (PM em T20). */
  cost: z.number().int().min(0).default(0),
  execution: z.string().max(40).default(""),
  duration: z.object({ units: z.string().max(40).default(""), value: z.number().min(0).default(0) }).default({}),
  range: z.object({ units: z.string().max(40).default(""), value: z.number().min(0).default(0) }).default({}),
  target: z.string().max(200).default(""),
  area: TemplateAreaSchema.default(null),
  effect: z.string().max(2000).default(""),
});
export type Activation = z.infer<typeof ActivationSchema>;

/**
 * Aprimoramento de um item ativo (T20: "+2 PM: aumenta o dano em +1d6"). Só o
 * custo é mecânica; `label` é o texto resumido. No compêndio do repositório o
 * label fica vazio (vem de descriptions.local.json, chave "<entryId>#<id>") e é
 * copiado para o item na inserção, então a ficha funciona sem o arquivo local.
 * Ids frouxos de propósito: importados são "e1", "e2"...; manuais usam newId().
 */
export const EnhancementIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/).max(80);

/** Um grupo de dados ("1d6"): multiplicar por `times` é só multiplicar a contagem. */
export const DiceTermSchema = z.string().regex(/^\d+d\d+$/);

/**
 * Efeito mecânico de um aprimoramento, aplicado ao usar o item. "× vezes" = multiplica
 * por `times` quando o aprimoramento é repetível.
 *   costOnly        só cobra (default quando `effect` está ausente)
 *   damageDiceAdd   soma `dice` × vezes ao dano ("aumenta o dano em +1d6"). `damageType` ausente = herda o
 *                   tipo da ação; presente = parcela separada com o próprio tipo ("+4d6 de dano de frio").
 *                   Ignora ações de cura (tipo com `healing` no sistema)
 *   damageSet       troca os dados do dano por `formula` ("muda o dano para 10d6"); atributo e bônus continuam
 *   healDiceAdd     como damageDiceAdd, mas só nas ações de cura ("aumenta a cura em +1d8")
 *   dcAdd           soma `value` × vezes à CD de resistência do card ("aumenta a CD em +2")
 *   attackBonusAdd  soma `value` × vezes ao ataque das ações de ataque do item
 *   rangeSet        troca o alcance mostrado no card (`units` de activation.rangeUnits; `value` opcional)
 *   durationSet     troca a duração mostrada no card (`units` de activation.durationUnits; `value` opcional)
 *   areaSet         troca a área mostrada no card
 *   targetsAdd      soma `count` × vezes alvos ao alvo mostrado no card ("+1 alvo")
 *   text            só descritivo: aparece em destaque no card, sem automação
 * Explícito de propósito: o importador só preenche quando o texto casa um padrão estrito.
 */
export const EnhancementEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("costOnly") }),
  z.object({ kind: z.literal("damageDiceAdd"), dice: DiceTermSchema, damageType: KeySchema.optional() }),
  z.object({ kind: z.literal("damageSet"), formula: z.string().min(1).max(200) }),
  z.object({ kind: z.literal("healDiceAdd"), dice: DiceTermSchema }),
  z.object({ kind: z.literal("dcAdd"), value: z.number().int() }),
  z.object({ kind: z.literal("attackBonusAdd"), value: z.number().int() }),
  z.object({ kind: z.literal("rangeSet"), units: z.string().min(1).max(40), value: z.number().min(0).optional() }),
  z.object({ kind: z.literal("durationSet"), units: z.string().min(1).max(40), value: z.number().min(0).optional() }),
  z.object({ kind: z.literal("areaSet"), text: z.string().max(200) }),
  z.object({ kind: z.literal("targetsAdd"), count: z.number().int().min(1) }),
  z.object({ kind: z.literal("text"), text: z.string().max(1000) }),
]);
export type EnhancementEffectKind = EnhancementEffect["kind"];

/** Campos do card que um aprimoramento pode alterar; a UI marca "(aprimorado)". */
export const EnhancedFieldSchema = z.enum(["range", "duration", "area", "target", "dc", "attack"]);
export type EnhancedField = z.infer<typeof EnhancedFieldSchema>;
export type EnhancementEffect = z.infer<typeof EnhancementEffectSchema>;

export const EnhancementSchema = z.object({
  id: EnhancementIdSchema,
  label: z.string().max(1000).default(""),
  /** Custo extra no recurso de ativação, somado ao base por activation.enhancementCost do sistema. */
  cost: z.number().int().min(0).default(0),
  /** true = pode ser aplicado mais de uma vez (o custo multiplica por `times`). */
  repeatable: z.boolean().default(false),
  /** Ausente = costOnly. */
  effect: EnhancementEffectSchema.optional(),
});
export type Enhancement = z.infer<typeof EnhancementSchema>;

/** Escolha do jogador ao usar o item: quais aprimoramentos e quantas vezes cada um. */
export const EnhancementUseSchema = z.object({ id: EnhancementIdSchema, times: z.number().int().min(1).default(1) });
export type EnhancementUse = z.infer<typeof EnhancementUseSchema>;

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
  /** Aprimoramentos escolhíveis ao usar (só faz sentido com activation e activation.enhancementCost no sistema). */
  enhancements: z.array(EnhancementSchema).default([]),
  save: SaveSchema.nullable().default(null),
  /** Página do livro, copiada do compêndio: a ficha mostra "ver livro, pág. X" quando não há descrição. */
  page: z.number().int().positive().nullable().default(null),
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

/**
 * Resposta a um tipo de dano (RD, imunidade, vulnerabilidade...). Só dado + exibição por enquanto:
 * `token:apply-damage` continua aplicando o valor que o cliente manda; `rules/damageResponse.ts`
 * usa isto para SUGERIR o multiplicador no seletor de "Aplicar" (o Mestre confirma).
 */
export const DamageResponseSchema = z.object({
  /** Redução de dano (RD): subtrai do total (piso 0). */
  reduction: z.number().int().min(0).default(0),
  /** "Reduz o dano à metade" (não vem do Foundry; existe em bloco escrito à mão). */
  half: z.boolean().default(false),
  immune: z.boolean().default(false),
  vulnerable: z.boolean().default(false),
});
export type DamageResponse = z.infer<typeof DamageResponseSchema>;

/** `all` vale para qualquer tipo de dano (RD geral); `byType` é por damageTypes[].key do sistema. */
export const DamageResponsesSchema = z.object({
  all: DamageResponseSchema.default({}),
  byType: z.record(KeySchema, DamageResponseSchema).default({}),
});
export type DamageResponses = z.infer<typeof DamageResponsesSchema>;

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
  damageResponses: DamageResponsesSchema.default({}),
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
  /**
   * `enhancements` = aprimoramentos aplicados à ação (o card do chat reenvia os da conjuração);
   * ausente/vazio = ação como está no item. `combineDamageActionId` (§9.13, "Rolar dano junto com o
   * ataque"): id de uma ação de DANO do MESMO item, só válido quando `actionId` é uma ação de
   * ataque — o servidor rola as duas e publica uma mensagem só (ataque em cima, dano embaixo).
   * Preenchido pela store (`store/characters.ts#roll`) a partir da preferência do usuário, nunca
   * escolhido na UI diretamente.
   */
  z.object({
    type: z.literal("action"),
    itemId: IdSchema,
    actionId: IdSchema,
    enhancements: z.array(EnhancementUseSchema).optional(),
    combineDamageActionId: IdSchema.optional(),
  }),
]);
export type CharacterRollRequest = z.infer<typeof CharacterRollRequestSchema>;

/**
 * Parcela de uma rolagem de dano: fórmula já resolvida e o tipo dela (null = sem
 * tipo). Uma ação de dano vira uma parcela por tipo: a base (tipo da ação, com
 * atributo e bônus) e uma para cada tipo extra vindo de aprimoramentos.
 */
export const DamageComponentSchema = z.object({ formula: z.string().min(1).max(200), damageType: KeySchema.nullable() });
export type DamageComponent = z.infer<typeof DamageComponentSchema>;

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
  /** Custo efetivo já descontado (base + aprimoramentos + modificadores); null = sem custo. */
  cost: z.object({ abbr: z.string().max(6), amount: z.number().int().min(0) }).nullable(),
  /** Aprimoramentos usados nesta conjuração (texto e custo copiados do item). `note` = texto de um efeito `text`. Cards antigos não têm o campo. */
  enhancements: z
    .array(z.object({ id: EnhancementIdSchema, label: z.string().max(1000), cost: z.number().int().min(0), times: z.number().int().min(1), note: z.string().max(1000).optional() }))
    .default([]),
  /** Campos alterados por aprimoramento nesta conjuração (alcance, CD...). Vazio em cards antigos. */
  enhanced: z.array(EnhancedFieldSchema).default([]),
  execution: z.string().max(60),
  range: z.string().max(60),
  duration: z.string().max(60),
  target: z.string().max(200),
  /** Estruturado (TemplateAreaSchema): cards antigos no banco tinham texto livre aqui — o mesmo
   *  `preprocess` de `ActivationSchema.area` migra na leitura, sem precisar de migration de banco. */
  area: TemplateAreaSchema,
  effect: z.string().max(2000),
  /** CD calculada (null quando o sistema não define saveDc). */
  save: z.object({ skillLabel: z.string().max(40), dc: z.number().int().nullable(), text: z.string().max(500) }).nullable(),
  actions: z.array(
    z.object({
      id: IdSchema,
      label: z.string().max(60),
      kind: z.string().max(20),
      /** Fórmula final já resolvida, com os aprimoramentos da conjuração (null = não deu para montar). Cards antigos não têm. */
      formula: z.string().max(200).nullable().default(null),
      /** Decomposição quando algum efeito foi aplicado ("6d6 base + 4d6 aumenta o dano ×2"); null = dano como está no item. */
      breakdown: z.string().max(300).nullable().default(null),
      /** Só ações de dano: parcelas por tipo (a UI mostra cada uma com o selo do tipo). Vazio nas demais e em cards antigos. */
      damage: z.array(DamageComponentSchema).default([]),
    }),
  ),
});
export type ItemCard = z.infer<typeof ItemCardSchema>;
