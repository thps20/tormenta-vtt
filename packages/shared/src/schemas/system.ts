import { z } from "zod";
import { collectPlaceholders } from "../rules/placeholders.js";
import { ModifierTargetSchema } from "../rules/modifierTarget.js";
import { TemplateShapeSchema } from "./template.js";

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

/** Cor em hex de 6 dígitos ("#f4511e"); a UI deriva o fundo translúcido dela. */
export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Grupo de tipos de dano que compartilham a cor do selo (ex.: "físico" para corte, impacto, perfuração). */
export const DamageTypeGroupDefSchema = z.object({ key: KeySchema, label: z.string().min(1), color: HexColorSchema });
export type DamageTypeGroupDef = z.infer<typeof DamageTypeGroupDefSchema>;

/** Tipo de dano. Cor do selo: `color` própria, senão a do `group`, senão cinza neutro na UI. */
export const DamageTypeDefSchema = OptionDefSchema.extend({
  color: HexColorSchema.optional(),
  /** Chave em damageTypeGroups[]. */
  group: KeySchema.optional(),
  /**
   * true = ação de dano com este tipo é CURA: recebe healDiceAdd dos aprimoramentos
   * e ignora damageDiceAdd/damageSet. Assim o código não precisa conhecer a chave "cura".
   */
  healing: z.boolean().default(false),
});
export type DamageTypeDef = z.infer<typeof DamageTypeDefSchema>;

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
 *   {saveAttr} {saveBonus}                     em activation.saveDc (atributo e bônus do save do item)
 *   {base} {enhancements}                      em activation.enhancementCost (custo base do item e Σ custo×vezes dos aprimoramentos)
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
   * Máximo acumulado por nível de classe (itens do tipo level.classes.kind).
   * Para cada classe: o 1º nível da classe inicial soma `firstLevelField`
   * (ou `classField` se ausente); os demais somam `classField`; cada nível soma
   * ainda o `attribute` e respeita o piso `minPerLevel`. Multiclasse soma tudo.
   * Só vale quando a ficha tem classes e não está em progressão manual; senão
   * cai em maxOverride/maxFormula.
   */
  perLevel: z
    .object({
      /** Campo numérico do item de classe com o valor por nível (ex.: "hpPerLevel"). */
      classField: KeySchema,
      /** Campo numérico com o valor do 1º nível da classe inicial (ex.: "hpInitial"). */
      firstLevelField: KeySchema.optional(),
      /** Atributo somado por nível (ex.: CON para PV). */
      attribute: KeySchema.optional(),
      /** Ganho mínimo por nível depois de somar o atributo (T20: 1 PV). */
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
  /**
   * "manual" = digitado na ficha; "classes" = soma dos itens de classe. Mesmo em
   * "classes", uma ficha sem item de classe (ou em progressão manual) usa o nível digitado.
   */
  source: z.enum(["manual", "classes"]).default("manual"),
  /** Onde estão as classes quando source = "classes" (obrigatório nesse caso). */
  classes: z
    .object({
      /** Tipo de item (itemKinds[].key) que representa uma classe. */
      kind: KeySchema,
      /** Campo numérico do item com os níveis naquela classe. */
      levelsField: KeySchema,
      /** Campo booleano que marca a classe inicial (1º nível usa perLevel.firstLevelField). */
      initialField: KeySchema,
    })
    .optional(),
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

/**
 * Modificador que uma condição aplicaria automaticamente na ficha (mesmo formato de `target`/`value`
 * usado em `Modifier`, ver character.ts). Por enquanto é só estrutura: nenhum código lê `conditions[].modifiers`
 * ainda (a condição no token não afeta a ficha), mas o formato já fica pronto pra quando isso for automatizado.
 */
export const ConditionModifierSchema = z.object({
  target: ModifierTargetSchema,
  value: z.number().int(),
});
export type ConditionModifier = z.infer<typeof ConditionModifierSchema>;

/**
 * Marcador de condição (T20: Abalado, Cego, Atordoado...), exibido no token. `icon` é um SVG simples
 * embutido no JSON (um `<svg>...</svg>` monocromático, sem arte externa): a web usa o mesmo texto pra
 * desenhar o ícone no menu (DOM) e no token no mapa (rasterizado pra imagem do Konva).
 * `description` vazia é válida: o JSON do sistema vai pro bundle do web (ver `systems.ts`), então não dá
 * pra usar aqui o padrão de `descriptions.local.json` (arquivo git-ignorado) que o compêndio usa — aquele
 * só funciona porque o compêndio é lido do disco só pelo servidor e mandado por socket.
 */
export const ConditionDefSchema = z.object({
  key: KeySchema,
  label: z.string().min(1),
  icon: z.string().min(1),
  color: HexColorSchema,
  description: z.string().default(""),
  modifiers: z.array(ConditionModifierSchema).default([]),
  /**
   * Duração inicial (em rodadas) sugerida no campo de duração do ConditionMenu ao marcar esta
   * condição com combate ativo (ex.: Surpreendido = 1). Só um default de UI — o GM ainda escolhe
   * outro valor ou deixa permanente; ver rules/conditions.ts (deriveExpiresRound).
   */
  defaultDuration: z.number().int().min(1).optional(),
});
export type ConditionDef = z.infer<typeof ConditionDefSchema>;

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

/**
 * Tipos de campo de item. Os quatro últimos são estruturados e têm EFEITO na
 * ficha enquanto o item está ativo (não físico, ou físico equipado):
 *   attributeBonuses  { <attr>: n }                       → modificadores attr.<key> com origem no item
 *   attributeChoice   { amount, count, exclude, chosen }  → +amount em cada atributo escolhido (até count)
 *   skillGrants       { fixed, choices[{count, from, chosen}] } → perícias treinadas pelo item
 *   size              chave de sizes[] (a UI aplica ao tamanho da ficha)
 * Os valores seguem os schemas *ValueSchema em character.ts.
 */
export const ItemFieldTypeSchema = z.enum(["enum", "number", "boolean", "text", "attributeBonuses", "attributeChoice", "skillGrants", "size"]);
export type ItemFieldType = z.infer<typeof ItemFieldTypeSchema>;

export const ItemFieldDefSchema = z.object({
  key: KeySchema,
  label: z.string().min(1),
  type: ItemFieldTypeSchema,
  options: z.array(OptionDefSchema).optional(),
  /** Só para enum/number/boolean/text; os estruturados nascem vazios. */
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
  /** Texto do botão que ativa o item ("Usar", "Conjurar"). */
  useLabel: z.string().min(1).max(20).default("Usar"),
  /** Tem teste de resistência (perícia + CD). */
  hasSave: z.boolean().default(false),
  fields: z.array(ItemFieldDefSchema).default([]),
  /** Stats de equipStats que itens deste tipo podem fornecer quando equipados. */
  statBonuses: z.array(KeySchema).default([]),
  /** Quantos itens deste tipo a ficha aceita (ex.: 1 raça). Ausente = sem limite. */
  maxCount: z.number().int().min(1).optional(),
});
export type ItemKindDef = z.infer<typeof ItemKindDefSchema>;

/** Opção de execução; `passive` marca as que não podem ser "usadas" (só descrição). */
export const ExecutionDefSchema = OptionDefSchema.extend({ passive: z.boolean().default(false) });
export type ExecutionDef = z.infer<typeof ExecutionDefSchema>;

/**
 * Regras de ativação (poderes, magias, consumíveis): enumerações do bloco
 * `activation` do item e como usar um item ativo.
 */
export const ActivationDefSchema = z.object({
  executions: z.array(ExecutionDefSchema).default([]),
  durationUnits: z.array(OptionDefSchema).default([]),
  rangeUnits: z.array(OptionDefSchema).default([]),
  targetTypes: z.array(OptionDefSchema).default([]),
  /** Recurso (resources[].key) descontado por activation.cost. Ausente = custo só informativo. */
  resource: KeySchema.optional(),
  /**
   * Piso do custo depois dos modificadores "resource.<key>.cost" (T20: reduções
   * nunca levam abaixo de 1 PM). Custo base 0 continua 0.
   */
  minCost: z.number().int().min(0).default(0),
  /**
   * CD do teste de resistência de um item. Contextuais: {saveAttr} (valor do
   * atributo do save do item, ou do atributo de conjuração da ficha) e
   * {saveBonus} (save.bonus). Ausente = sem CD calculada.
   */
  saveDc: FormulaSchema.optional(),
  /**
   * Custo de um uso COM aprimoramentos, antes dos modificadores e do piso.
   * Contextuais: {base} (activation.cost do item) e {enhancements} (soma de
   * custo × vezes dos aprimoramentos escolhidos). Ausente = o sistema não tem
   * aprimoramentos: a ficha não oferece a escolha e o servidor recusa seleção.
   */
  enhancementCost: FormulaSchema.optional(),
  /** Rótulo do campo "atributo de conjuração" na ficha. */
  spellcastingLabel: z.string().min(1).max(40).default("Atributo de conjuração"),
  /** Tag (skills[].tags) das perícias que servem de teste de resistência. Ausente = qualquer perícia. */
  saveSkillTag: KeySchema.optional(),
});
export type ActivationDef = z.infer<typeof ActivationDefSchema>;

/** Regra para contar células na diagonal (medição da régua). */
export const DiagonalRuleSchema = z.enum(["euclidean", "manhattan", "alternating", "chebyshev"]);
export type DiagonalRule = z.infer<typeof DiagonalRuleSchema>;

/**
 * De onde vêm os placeholders "{race.<campo>}": um item ativo (tipicamente maxCount 1, ex.: "Raça")
 * cujos campos NUMBER entram em fórmulas — hoje só `derived.movement` lê `{race.movement}` (docs/plano-movimento.md).
 * Ausente = nenhuma fórmula pode usar "{race.*}". O código nunca sabe que a chave se chama "race":
 * é só o NOME do placeholder (como "attr"/"equip"/"skill" já são); QUAL item kind alimenta ele vem
 * daqui, do JSON.
 */
export const RaceDefSchema = z.object({
  /** Chave em itemKinds[] cujos campos number viram "{race.<campo>}". */
  kind: KeySchema,
});
export type RaceDef = z.infer<typeof RaceDefSchema>;

/**
 * Orçamento de deslocamento por turno com combate ativo (docs/plano-movimento.md). Ausente = o
 * sistema não tem essa regra: sem barra, sem caminho desenhado, sem bloqueio — só o movimento
 * livre por teclado/arraste.
 */
export const MovementDefSchema = z.object({
  /** Chave em derived[] com o deslocamento do personagem (T20: "movement"). */
  derived: KeySchema,
  /** Orçamento de um token SEM ficha vinculada, na unidade do `grid` (T20: 9). */
  default: z.number().nonnegative(),
  /** Regra de diagonais só do movimento. Ausente = `grid.diagonals` (a mesma que a régua usa). */
  diagonals: DiagonalRuleSchema.optional(),
});
export type MovementDef = z.infer<typeof MovementDefSchema>;

/**
 * Escala do grid no mundo do jogo. Quanto vale uma célula e como contar diagonais:
 *   euclidean   distância em linha reta (√(dx² + dy²))
 *   manhattan   só movimento ortogonal (dx + dy)
 *   alternating diagonais alternam 1 e 2 células (regra 1-2-1 do d20)
 *   chebyshev   diagonal custa o mesmo que reto (max(dx, dy))
 * Ausente = a régua mostra só a contagem de células.
 */
export const SystemGridDefSchema = z.object({
  /** Tamanho de uma célula na unidade do jogo (ex.: 1.5 para 1,5 m). */
  cellSize: z.number().positive(),
  /** Unidade exibida depois do número (ex.: "m"). */
  unit: z.string().min(1).max(8),
  diagonals: DiagonalRuleSchema.default("alternating"),
});
export type SystemGridDef = z.infer<typeof SystemGridDefSchema>;

/**
 * Como o app lê um bloco de criatura (compêndio, `docs/plano-criaturas.md`). Sistema sem este
 * bloco não tem criaturas: `compendium:list` não filtra nem oferece o chip "Criaturas".
 */
export const CreatureDefSchema = z.object({
  /** Chave em traitFields[] com o tipo de criatura (ex.: "tipo": Humanoide, Animal...). */
  typeField: KeySchema,
  /** Chave em traitFields[] com o nível de desafio. Só exibição (texto: "1/4", "1/2", "20"...). */
  ndField: KeySchema,
  /** Cor do token quando o tipo da criatura não estiver em `typeColors`. */
  defaultColor: HexColorSchema,
  /** Cor do token por opção de `typeField` (a chave é uma options[].key daquele traitField). */
  typeColors: z.record(KeySchema, HexColorSchema).default({}),
});
export type CreatureDef = z.infer<typeof CreatureDefSchema>;

/**
 * Gabarito pronto (círculo/cone/linha/quadrado) oferecido na ferramenta "Área" e no botão
 * "Colocar área" do card de magia (docs/plano-gabaritos.md). `size` é o raio (círculo), comprimento
 * (cone/linha) ou lado (quadrado), na unidade do `grid` do sistema. `angle`/`width` só valem em
 * cone/linha respectivamente; ausentes usam o padrão do sistema (`TemplatesDefSchema.coneAngle`/
 * `.lineWidth`) — sistemas com um único ângulo de cone não precisam repeti-lo em cada preset.
 */
export const TemplatePresetSchema = z.object({
  label: z.string().min(1).max(60),
  shape: TemplateShapeSchema,
  size: z.number().positive(),
  angle: z.number().positive().max(180).optional(),
  width: z.number().positive().optional(),
});
export type TemplatePreset = z.infer<typeof TemplatePresetSchema>;

/**
 * Gabaritos de área de efeito no mapa (docs/plano-gabaritos.md). Bloco opcional: sem ele a
 * ferramenta "Área" nem aparece na barra — nenhum ângulo/largura padrão fica hardcoded no código
 * caso um sistema futuro não declare isto (regra número 1 do projeto).
 */
export const TemplatesDefSchema = z.object({
  /** Ângulo padrão do cone, em graus. Presets podem sobrescrever com `angle`. */
  coneAngle: z.number().positive().max(180),
  /** Largura padrão da linha/raio, na unidade do `grid`. Presets podem sobrescrever com `width`. */
  lineWidth: z.number().positive(),
  presets: z.array(TemplatePresetSchema).default([]),
  /** Nome de cada forma na linguagem do sistema (T20 chama o círculo de "Esfera") — usado na barra
   *  de ferramentas, no editor de item e no card do chat, pra não ter vocabulário hardcoded no
   *  código (regra número 1) nem dois nomes divergentes pra mesma forma. */
  shapeLabels: z.object({
    circle: z.string().min(1).max(30),
    cone: z.string().min(1).max(30),
    line: z.string().min(1).max(30),
    square: z.string().min(1).max(30),
  }),
});
export type TemplatesDef = z.infer<typeof TemplatesDefSchema>;

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
  damageTypeGroups: z.array(DamageTypeGroupDefSchema).default([]),
  damageTypes: z.array(DamageTypeDefSchema).default([]),
  currencies: z.array(CurrencyDefSchema).default([]),
  traitFields: z.array(TraitFieldDefSchema).default([]),
  equipStats: z.array(EquipStatDefSchema).default([]),
  itemKinds: z.array(ItemKindDefSchema).default([]),
  activation: ActivationDefSchema.default({}),
  /** Marcadores de condição (T20: Abalado, Cego...) exibidos no token. Sem automação de regra por enquanto. */
  conditions: z.array(ConditionDefSchema).default([]),
  /** Como ler um bloco de criatura no compêndio (ver CreatureDefSchema). Ausente = sistema sem criaturas. */
  creatures: CreatureDefSchema.optional(),
  /** Gabaritos de área de efeito (ver TemplatesDefSchema). Ausente = sistema sem a ferramenta "Área". */
  templates: TemplatesDefSchema.optional(),

  /** Perícias que podem ser usadas em ações de ataque (ex.: luta, pontaria). */
  attackSkills: z.array(KeySchema).default([]),
  /** Bônus total de uma perícia (sem o dado). Contextuais: {attr} {trained} {sizeMod} {armorPenalty}. */
  skillTotal: FormulaSchema,
  /** Fórmulas nomeadas de rolagem. */
  rolls: z.object({
    attributeCheck: FormulaSchema,
    skillCheck: FormulaSchema,
    /** Ataque de uma ação; {skill} é a perícia da ação. Ausente = skillCheck. */
    attack: FormulaSchema.optional(),
  }),
  /** Regras do modo de combate (iniciativa, desempate, surpresa). Ver docs/plano-combate.md. */
  combat: z.object({
    /** Iniciativa de combatente com ficha vinculada. Placeholders globais da ficha. */
    initiative: FormulaSchema,
    /** Iniciativa de token SEM ficha vinculada. {bonus} = bônus manual digitado pelo GM. */
    initiativeNoSheet: FormulaSchema,
    /** Valor sem dado (usa evaluateConstant) gravado como Combatant.bonus de quem tem ficha. */
    tiebreakBonus: FormulaSchema,
    /** Critérios de desempate após o valor rolado, do mais forte ao mais fraco. "order" = ordem manual do GM. */
    tiebreak: z.array(z.enum(["bonus", "order"])).min(1),
    /** Surpresa: combatente surpreso é pulado nas N primeiras rodadas. rounds = 0 = sistema sem surpresa. */
    surprise: z.object({ rounds: z.number().int().min(0) }),
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
  /**
   * Recurso exibido como barra de vida no token (chave de resources[]).
   * Ausente = tokens sem barra. A UI lê o atual/máximo da ficha vinculada.
   */
  tokenBar: KeySchema.optional(),
  /** Escala do grid (valor de uma célula e regra de diagonais) para a régua. */
  grid: SystemGridDefSchema.optional(),
  /** De onde vem "{race.<campo>}" nas fórmulas (ver RaceDefSchema). Ausente = placeholder não existe. */
  race: RaceDefSchema.optional(),
  /** Orçamento de deslocamento por turno em combate (ver MovementDefSchema). Ausente = sem a regra. */
  movement: MovementDefSchema.optional(),
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
  saveDc: ["saveAttr", "saveBonus"],
  maxFormula: [],
  derived: [],
  combatInitiative: [],
  combatInitiativeNoSheet: ["bonus"],
  combatTiebreakBonus: [],
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
  assertUnique(def, "tipo de dano", def.damageTypes.map((d) => d.key));
  assertUnique(def, "grupo de tipo de dano", def.damageTypeGroups.map((g) => g.key));
  assertUnique(def, "condição", def.conditions.map((c) => c.key));

  for (const type of def.damageTypes) {
    if (type.group !== undefined && !def.damageTypeGroups.some((g) => g.key === type.group)) fail(def, `tipo de dano "${type.key}" referencia grupo inexistente "${type.group}"`);
  }

  for (const skill of def.skills) {
    if (!attrKeys.has(skill.attribute)) fail(def, `perícia "${skill.key}" referencia atributo inexistente "${skill.attribute}"`);
  }
  for (const key of def.attackSkills) {
    if (!skillKeys.has(key)) fail(def, `attackSkills referencia perícia inexistente "${key}"`);
  }
  if (def.tokenBar !== undefined && !resourceKeys.has(def.tokenBar)) {
    fail(def, `tokenBar referencia recurso inexistente "${def.tokenBar}"`);
  }
  if (def.activation.resource !== undefined && !resourceKeys.has(def.activation.resource)) {
    fail(def, `activation.resource referencia recurso inexistente "${def.activation.resource}"`);
  }
  if (def.activation.saveSkillTag !== undefined && !def.skills.some((s) => s.tags.includes(def.activation.saveSkillTag ?? ""))) {
    fail(def, `activation.saveSkillTag "${def.activation.saveSkillTag}" não é tag de nenhuma perícia`);
  }
  if (def.creatures) {
    const { typeField, ndField, typeColors } = def.creatures;
    const typeFieldDef = def.traitFields.find((f) => f.key === typeField);
    if (!typeFieldDef) fail(def, `creatures.typeField referencia traitField inexistente "${typeField}"`);
    if (!def.traitFields.some((f) => f.key === ndField)) fail(def, `creatures.ndField referencia traitField inexistente "${ndField}"`);
    for (const key of Object.keys(typeColors)) {
      if (!typeFieldDef?.options?.some((o) => o.key === key)) fail(def, `creatures.typeColors: opção "${key}" não existe em traitField "${typeField}"`);
    }
  }
  for (const kind of def.itemKinds) {
    for (const stat of kind.statBonuses) {
      if (!equipKeys.has(stat)) fail(def, `tipo de item "${kind.key}" referencia equipStat inexistente "${stat}"`);
    }
    assertUnique(def, `campo de "${kind.key}"`, kind.fields.map((f) => f.key));
    for (const field of kind.fields) {
      if (field.type === "enum" && !field.options?.length) fail(def, `campo "${kind.key}.${field.key}" é enum sem options`);
      const structured = !["enum", "number", "boolean", "text"].includes(field.type);
      if (structured && field.default !== undefined) fail(def, `campo "${kind.key}.${field.key}" (${field.type}) não aceita default`);
      if (field.type === "size" && def.sizes.length === 0) fail(def, `campo "${kind.key}.${field.key}" é size, mas o sistema não declara sizes[]`);
    }
  }

  // Classes: os ponteiros de level.classes e resources[].perLevel apontam para campos reais do tipo certo.
  const fieldOf = (kindKey: string, fieldKey: string) => def.itemKinds.find((k) => k.key === kindKey)?.fields.find((f) => f.key === fieldKey);
  if (def.level.source === "classes" && !def.level.classes) fail(def, `level.source = "classes" exige level.classes`);
  if (def.level.classes) {
    const { kind, levelsField, initialField } = def.level.classes;
    if (!def.itemKinds.some((k) => k.key === kind)) fail(def, `level.classes.kind referencia tipo de item inexistente "${kind}"`);
    if (fieldOf(kind, levelsField)?.type !== "number") fail(def, `level.classes.levelsField "${levelsField}" não é campo numérico de "${kind}"`);
    if (fieldOf(kind, initialField)?.type !== "boolean") fail(def, `level.classes.initialField "${initialField}" não é campo booleano de "${kind}"`);
  }
  for (const r of def.resources) {
    if (!r.perLevel) continue;
    if (!def.level.classes) fail(def, `recurso "${r.key}" tem perLevel, mas o sistema não declara level.classes`);
    const kind = def.level.classes.kind;
    if (fieldOf(kind, r.perLevel.classField)?.type !== "number") fail(def, `recurso "${r.key}".perLevel.classField "${r.perLevel.classField}" não é campo numérico de "${kind}"`);
    if (r.perLevel.firstLevelField !== undefined && fieldOf(kind, r.perLevel.firstLevelField)?.type !== "number") {
      fail(def, `recurso "${r.key}".perLevel.firstLevelField "${r.perLevel.firstLevelField}" não é campo numérico de "${kind}"`);
    }
    if (r.perLevel.attribute !== undefined && !attrKeys.has(r.perLevel.attribute)) fail(def, `recurso "${r.key}".perLevel.attribute referencia atributo inexistente "${r.perLevel.attribute}"`);
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
  // Campos NUMBER do item kind que alimenta "{race.<campo>}" (ver RaceDefSchema); vazio sem `race`.
  const raceKindDef = def.race ? def.itemKinds.find((k) => k.key === def.race?.kind) : undefined;
  const raceFieldKeys = new Set(raceKindDef?.fields.filter((f) => f.type === "number").map((f) => f.key) ?? []);

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
        (head === "resource" && key !== undefined && resourceKeys.has(key) && tail === "max") ||
        (head === "race" && key !== undefined && raceFieldKeys.has(key) && tail === undefined);
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
  if (def.rolls.attack) check(def.rolls.attack, "rolls.attack", CONTEXTUAL.attack ?? []);
  check(def.combat.initiative, "combat.initiative", CONTEXTUAL.combatInitiative ?? []);
  check(def.combat.initiativeNoSheet, "combat.initiativeNoSheet", CONTEXTUAL.combatInitiativeNoSheet ?? []);
  check(def.combat.tiebreakBonus, "combat.tiebreakBonus", CONTEXTUAL.combatTiebreakBonus ?? []);
  for (const r of def.resources) {
    if (r.maxFormula) check(r.maxFormula, `resource "${r.key}".maxFormula`, CONTEXTUAL.maxFormula ?? []);
    if (r.minFormula) check(r.minFormula, `resource "${r.key}".minFormula`, CONTEXTUAL.minFormula ?? []);
  }
  for (const r of def.extraRolls) check(r.formula, `extraRoll "${r.key}"`, CONTEXTUAL.extraRoll ?? []);
  if (def.activation.saveDc) check(def.activation.saveDc, "activation.saveDc", CONTEXTUAL.saveDc ?? []);

  if (def.race && !def.itemKinds.some((k) => k.key === def.race?.kind)) fail(def, `race.kind referencia tipo de item inexistente "${def.race.kind}"`);
  if (def.movement) {
    if (!def.derived.some((d) => d.key === def.movement?.derived)) fail(def, `movement.derived referencia stat derivado inexistente "${def.movement.derived}"`);
    if (!def.grid) fail(def, `movement exige "grid" (cellSize/unit para converter célula ↔ metro)`);
  }

  return def;
}
