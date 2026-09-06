# Tipos de ficha e de sistema (referência para UI)

Bloco autocontido com os tipos `Character`, `CharacterItem`, `Action`, `Modifier` e `SystemDefinition` do `packages/shared`, mais o JSON atual do Tormenta20. Pensado para colar em outra ferramenta (gerador de UI, protótipo, LLM) sem depender do repositório.

**Atenção:** os tipos abaixo são a forma **inferida** dos schemas Zod (saída do `z.infer`, com defaults já aplicados, então campos com `.default()` aparecem como obrigatórios). No código eles existem só como `z.infer<typeof XSchema>`; a fonte da verdade continua sendo os schemas. Se um schema mudar, este arquivo precisa ser regenerado.

Fontes:

- `packages/shared/src/schemas/character.ts`
- `packages/shared/src/schemas/system.ts`
- `packages/shared/src/rules/modifierTarget.ts`
- `packages/shared/src/schemas/common.ts`
- `packages/shared/systems/tormenta20.json`

## Tipos

```ts
/** IDs são strings (cuid/uuid geradas no servidor). */
type Id = string;

/** Chave interna e estável, ex.: "for", "percepcao", "armorPenalty". Regex: /^[a-z][a-zA-Z0-9_]*$/ */
type Key = string;

/** Chave de perícia, com variante opcional: "oficio:alquimia". Regex: /^[a-z][a-zA-Z0-9_]*(?::[a-z0-9_]+)?$/ */
type SkillInstanceKey = string;

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
 * O resultado após substituição deve ser uma fórmula válida para o parser de dados (ex.: "1d20+5").
 */
type Formula = string;

/**
 * Alvo de um modificador: seletor textual validado por regex.
 *   attr.<key>            valor de um atributo
 *   skill.<key>           uma perícia (aceita variante: skill.oficio:alquimia)
 *   skill.*               todas as perícias
 *   skill[tag=<tag>]      perícias com a tag (ex.: skill[tag=resistencia])
 *   derived.<key>         stat derivado (Defesa, CD...)
 *   resource.<key>.max    máximo de um recurso (PV, PM...)
 *   attack                todas as rolagens de ataque
 *   attack.<skill>        ataques feitos com a perícia
 *   damage                todo dano
 *   damage.<skill>        dano de ataques feitos com a perícia
 */
type ModifierTarget = string;

// ----------------------------------------------------------------------------
// Ficha (character.ts)
// ----------------------------------------------------------------------------

type Modifier = {
  id: Id;
  label: string;                 // max 80, default ""
  target: ModifierTarget;
  value: number;                 // inteiro
  /** Item que originou o modificador (opcional). */
  source: Id | null;             // default null
  enabled: boolean;              // default true
};

/** Uma rolagem que um item oferece (ataque, dano, teste, fórmula livre). */
type Action =
  | {
      id: Id;
      label: string;             // 1..60
      kind: "attack";
      /** Perícia usada no ataque (ex.: luta, pontaria). */
      skill: Key;
      /** Troca o atributo da perícia (ex.: arma ágil usa DES em vez de FOR). */
      attributeOverride: Key | null;  // default null
      bonus: number;             // default 0
      /** Resultado natural do dado a partir do qual é crítico. */
      critRange: number;         // min 1, default 20
      critMult: number;          // min 1, default 2
    }
  | {
      id: Id;
      label: string;
      kind: "damage";
      /** Fórmula de dado, ex.: "1d8". Pode usar placeholders. */
      formula: string;           // 1..200
      /** "auto" = regra damageAttribute do sistema; null = nenhum; ou uma chave de atributo. */
      attribute: "auto" | Key | null;  // default "auto"
      damageType: Key | null;    // default null
      bonus: number;             // default 0
    }
  | {
      id: Id;
      label: string;
      kind: "check";
      skill: Key;
      bonus: number;             // default 0
    }
  | {
      id: Id;
      label: string;
      kind: "formula";
      formula: string;           // 1..200
    };

/** Bloco de ativação (poderes, magias, consumíveis). Chaves vêm de system.activation. */
type Activation = {
  /** Custo em pontos do recurso de ativação (PM em T20). */
  cost: number;                  // int >= 0, default 0
  execution: string;             // max 40, default ""
  duration: { units: string; value: number };  // default { units: "", value: 0 }
  range: { units: string; value: number };     // default { units: "", value: 0 }
  target: string;                // max 200, default ""
  area: string;                  // max 200, default ""
  effect: string;                // max 2000, default ""
};

/** Teste de resistência exigido pelo item. A CD vem de derived (ex.: "dc"). */
type Save = {
  skill: Key;
  /** Atributo que entra na CD, se o sistema variar por item (null = padrão). */
  attribute: Key | null;         // default null
  bonus: number;                 // default 0
  text: string;                  // max 500, default ""
};

type ItemFieldValue = string | number | boolean;

type CharacterItem = {
  id: Id;
  /** Chave de itemKinds[] do sistema. */
  kind: Key;
  name: string;                  // 1..80
  description: string;           // max 4000, default ""
  quantity: number;              // int >= 0, default 1
  equipped: boolean;             // default false
  /** Espaços/peso e preço: só informativos por enquanto. */
  slots: number;                 // >= 0, default 0
  price: number;                 // >= 0, default 0
  /** Valores dos campos declarados em itemKinds[].fields. */
  fields: Record<string, ItemFieldValue>;  // default {}
  /** Stats fornecidos quando equipado (chaves de equipStats). */
  statBonuses: Record<Key, number>;        // default {}
  actions: Action[];             // default []
  activation: Activation | null; // default null
  save: Save | null;             // default null
};

type CharacterSkill = {
  trained: boolean;              // default false
  /** Bônus fixo digitado ("outros"). */
  other: number;                 // default 0
  /** Atributo alternativo (null = o da definição). */
  attribute: Key | null;         // default null
  /** Nome da variante (ex.: "Alquimia" para oficio:alquimia). */
  label?: string;                // max 40
};

type CharacterResource = {
  current: number;               // default 0
  temp: number;                  // >= 0, default 0
  /** Máximo digitado. null = usar maxFormula do sistema (ou 0 se não houver). */
  maxOverride: number | null;    // default null
};

type CharacterKind = "pc" | "npc";

/** Conteúdo da coluna `data` + campos editáveis. */
type CharacterData = {
  imageUrl: string | null;       // default null
  level: number;                 // int >= 0, default 1
  xp: number;                    // int >= 0, default 0
  attributes: Record<Key, { base: number }>;          // default {}
  skills: Record<SkillInstanceKey, CharacterSkill>;   // default {}
  resources: Record<Key, CharacterResource>;          // default {}
  /** Valor forçado para um stat derivado (ex.: Defesa 18 num NPC). */
  derivedOverrides: Record<Key, number>;              // default {}
  modifiers: Modifier[];         // default []
  /** Campos de traitFields[] do sistema. */
  traits: Record<Key, string>;   // max 500 cada, default {}
  currency: Record<Key, number>; // >= 0, default {}
  size: Key | null;              // default null
  spellcastingAttribute: Key | null;  // default null
  bio: string;                   // max 20000, default ""
  items: CharacterItem[];        // default []
};

/**
 * Ficha de personagem. Agnóstica de sistema: todo Record<key, ...> é indexado
 * pelas chaves do JSON do sistema (attributes[].key, skills[].key...). A ficha
 * guarda ENTRADAS (base do atributo, treinado, itens); os valores finais vêm de
 * computeCharacter e nunca são persistidos.
 */
type Character = CharacterData & {
  id: Id;
  roomId: Id;
  /** Participante dono (pode editar/rolar). null = só o GM. */
  ownerId: Id | null;
  name: string;                  // 1..80
  /** npc: só o GM vê. */
  kind: CharacterKind;
  createdAt: string;             // ISO datetime
  updatedAt: string;             // ISO datetime
};

/** Pedido de rolagem a partir da ficha (o servidor monta a fórmula e rola). */
type CharacterRollRequest =
  | { type: "attribute"; key: Key }
  | { type: "skill"; key: SkillInstanceKey }
  | { type: "initiative" }
  | { type: "extra"; key: Key }
  | { type: "action"; itemId: Id; actionId: Id };

// ----------------------------------------------------------------------------
// Definição de sistema (system.ts) — schemaVersion 2
// ----------------------------------------------------------------------------

/** Par chave/rótulo usado em enumerações (tipos de dano, escolas de magia...). */
type OptionDef = { key: Key; label: string };

type AttributeDef = {
  key: Key;
  /** Abreviação exibida, ex.: "FOR". */
  abbr: string;                  // 1..6
  label: string;
  /** Valor inicial ao criar personagem. */
  default: number;
  min?: number;
  max?: number;
};

type SkillDef = {
  key: Key;
  label: string;
  /** Atributo-base (key de AttributeDef). */
  attribute: Key;
  /** Se true, só pode usar se treinado. */
  trainedOnly: boolean;          // default false
  /** Se true, {armorPenalty} entra no total (stat reservado "armorPenalty" de equipStats). */
  armorPenalty: boolean;         // default false
  /** Se true, {sizeMod} (sizes[].skillModifier) entra no total. */
  sizeModifier: boolean;         // default false
  /** Etiquetas livres para modificadores em grupo: "skill[tag=ataque]". */
  tags: Key[];                   // default []
  /** Se true, o personagem pode ter várias instâncias ("oficio:alquimia"). */
  variants: boolean;             // default false
};

type RollTemplate = { key: Key; label: string; formula: Formula };

type ResourceDef = {
  key: Key;
  label: string;
  abbr: string;                  // 1..6
  /** Fórmula do valor máximo. Ausente = máximo digitado na ficha (maxOverride). */
  maxFormula?: Formula;
  /** Fórmula do mínimo (pode usar {max}). Ausente = 0. */
  minFormula?: Formula;
  /** Se true, a ficha tem um campo de pontos temporários. */
  hasTemp: boolean;              // default false
  /** Máximo acumulado por nível de classe (fase 4). Declarado no schema; computeCharacter ainda ignora. */
  perLevel?: {
    /** Campo do item de classe com o valor por nível (ex.: "hpPerLevel"). */
    classField: Key;
    /** Atributo somado por nível (ex.: CON para PV). */
    attribute?: Key;
    firstLevelMultiplier: number;  // int >= 1, default 1
    minPerLevel?: number;
  };
};

/** Stat calculado por fórmula (Defesa, CD, limite de carga...). */
type DerivedDef = {
  key: Key;
  label: string;
  abbr?: string;                 // 1..8
  formula: Formula;
  /** Se true, a ficha permite sobrescrever o valor à mão (derivedOverrides). */
  editable: boolean;             // default true
};

type LevelDef = {
  max: number;                   // int >= 1
  /** "manual" = digitado na ficha; "classes" = soma dos itens de classe (fase 4). */
  source: "manual" | "classes";  // default "manual"
  /** XP acumulado necessário para cada nível (índice 0 = nível 1). */
  xpTable?: number[];
};

type SizeDef = {
  key: Key;
  label: string;
  /** Somado em perícias com sizeModifier = true. */
  skillModifier: number;         // default 0
  /** Lado do token em células do grid. */
  tokenCells: number;            // > 0, default 1
};

type CurrencyDef = {
  key: Key;
  label: string;
  abbr: string;                  // 1..6
  /** Valor em relação à moeda-base (ratio 1). Só informativo por enquanto. */
  ratio: number;                 // > 0, default 1
};

/** Campos de texto/enum da ficha sem regra associada (raça, origem, divindade...). */
type TraitFieldDef = {
  key: Key;
  label: string;
  type: "text" | "enum";         // default "text"
  options?: OptionDef[];
};

/**
 * Stat agregado dos itens EQUIPADOS, acessível como {equip.<key>}.
 * "sum" soma; "min"/"max" pegam o menor/maior entre os itens que definem o stat.
 * `default` vale quando nenhum item equipado define o stat.
 * Chave reservada: "armorPenalty" alimenta {armorPenalty} das perícias.
 */
type EquipStatDef = {
  key: Key;
  label: string;
  aggregate: "sum" | "min" | "max";  // default "sum"
  default: number;               // default 0
};

type ItemFieldDef = {
  key: Key;
  label: string;
  type: "enum" | "number" | "boolean" | "text";
  options?: OptionDef[];
  default?: string | number | boolean;
};

/** Tipo de item (arma, armadura, poder, magia...). Os campos vêm daqui, não do código. */
type ItemKindDef = {
  key: Key;
  label: string;
  /** Ocupa espaço/peso e pode ser equipado. */
  physical: boolean;             // default true
  /** Tem bloco de ativação (custo, execução, duração, alcance...). */
  hasActivation: boolean;        // default false
  /** Tem teste de resistência (perícia + CD). */
  hasSave: boolean;              // default false
  fields: ItemFieldDef[];        // default []
  /** Stats de equipStats que itens deste tipo podem fornecer quando equipados. */
  statBonuses: Key[];            // default []
};

/** Enumerações do bloco de ativação (poderes, magias, consumíveis). */
type ActivationDef = {
  executions: OptionDef[];       // default []
  durationUnits: OptionDef[];    // default []
  rangeUnits: OptionDef[];       // default []
  targetTypes: OptionDef[];      // default []
};

type SystemDefinition = {
  /** Versão deste formato de arquivo. */
  schemaVersion: 2;
  id: string;                    // /^[a-z][a-z0-9_-]*$/
  name: string;
  version: string;
  /** Dado padrão de teste, ex.: "1d20". */
  baseDie: string;               // /^\d*d\d+$/

  attributes: AttributeDef[];    // min 1
  skills: SkillDef[];
  resources: ResourceDef[];      // default []
  derived: DerivedDef[];         // default []
  level: LevelDef;
  sizes: SizeDef[];              // default []
  damageTypes: OptionDef[];      // default []
  currencies: CurrencyDef[];     // default []
  traitFields: TraitFieldDef[];  // default []
  equipStats: EquipStatDef[];    // default []
  itemKinds: ItemKindDef[];      // default []
  activation: ActivationDef;     // default {}

  /** Perícias que podem ser usadas em ações de ataque (ex.: luta, pontaria). */
  attackSkills: Key[];           // default []
  /** Bônus total de uma perícia (sem o dado). Contextuais: {attr} {trained} {sizeMod} {armorPenalty}. */
  skillTotal: Formula;
  /** Fórmulas nomeadas de rolagem. */
  rolls: {
    attributeCheck: Formula;
    skillCheck: Formula;
    initiative: Formula;
    /** Ataque de uma ação; {skill} é a perícia da ação. Ausente = skillCheck. */
    attack?: Formula;
  };
  /**
   * Qual atributo entra no dano quando a ação diz attribute = "auto":
   * lê o campo `field` do item e consulta `map` (null = nenhum atributo).
   */
  damageAttribute?: {
    field: Key;
    map: Record<string, Key | null>;
  };
  /** Outras fórmulas específicas do sistema, livres. */
  extraRolls: RollTemplate[];    // default []
  /** Recurso exibido como barra de vida no token (chave de resources[]). Ausente = sem barra. */
  tokenBar?: Key;
  /** Regras de treinamento por faixa de nível (T20: +2/+4/+6). */
  trainedBonus: { minLevel: number; bonus: number }[];  // default []
};
```

## `packages/shared/systems/tormenta20.json`

As chaves `$comment` e `$rules` são só documentação; o schema as ignora.

```json
{
  "$comment": "Definição do sistema Tormenta20 (edição 2020). Segue o SystemDefinitionSchema v2 em src/schemas/system.ts. Toda regra de sistema mora aqui, nunca no código. Só mecânica (Open Game Content sob a OGL 1.0a); nada de Product Identity.",
  "schemaVersion": 2,
  "id": "tormenta20",
  "name": "Tormenta20",
  "version": "2.0.0",
  "baseDie": "1d20",

  "attributes": [
    { "key": "for", "abbr": "FOR", "label": "Força",        "default": 0, "min": -5, "max": 20 },
    { "key": "des", "abbr": "DES", "label": "Destreza",     "default": 0, "min": -5, "max": 20 },
    { "key": "con", "abbr": "CON", "label": "Constituição", "default": 0, "min": -5, "max": 20 },
    { "key": "int", "abbr": "INT", "label": "Inteligência", "default": 0, "min": -5, "max": 20 },
    { "key": "sab", "abbr": "SAB", "label": "Sabedoria",    "default": 0, "min": -5, "max": 20 },
    { "key": "car", "abbr": "CAR", "label": "Carisma",      "default": 0, "min": -5, "max": 20 }
  ],

  "skills": [
    { "key": "acrobacia",     "label": "Acrobacia",     "attribute": "des", "armorPenalty": true },
    { "key": "adestramento",  "label": "Adestramento",  "attribute": "car", "trainedOnly": true },
    { "key": "atletismo",     "label": "Atletismo",     "attribute": "for" },
    { "key": "atuacao",       "label": "Atuação",       "attribute": "car" },
    { "key": "cavalgar",      "label": "Cavalgar",      "attribute": "des" },
    { "key": "conhecimento",  "label": "Conhecimento",  "attribute": "int", "trainedOnly": true },
    { "key": "cura",          "label": "Cura",          "attribute": "sab" },
    { "key": "diplomacia",    "label": "Diplomacia",    "attribute": "car" },
    { "key": "enganacao",     "label": "Enganação",     "attribute": "car" },
    { "key": "fortitude",     "label": "Fortitude",     "attribute": "con", "tags": ["resistencia"] },
    { "key": "furtividade",   "label": "Furtividade",   "attribute": "des", "armorPenalty": true, "sizeModifier": true },
    { "key": "guerra",        "label": "Guerra",        "attribute": "int", "trainedOnly": true },
    { "key": "iniciativa",    "label": "Iniciativa",    "attribute": "des" },
    { "key": "intimidacao",   "label": "Intimidação",   "attribute": "car" },
    { "key": "intuicao",      "label": "Intuição",      "attribute": "sab" },
    { "key": "investigacao",  "label": "Investigação",  "attribute": "int" },
    { "key": "jogatina",      "label": "Jogatina",      "attribute": "car", "trainedOnly": true },
    { "key": "ladinagem",     "label": "Ladinagem",     "attribute": "des", "trainedOnly": true, "armorPenalty": true },
    { "key": "luta",          "label": "Luta",          "attribute": "for", "tags": ["ataque"] },
    { "key": "misticismo",    "label": "Misticismo",    "attribute": "int", "trainedOnly": true },
    { "key": "nobreza",       "label": "Nobreza",       "attribute": "int", "trainedOnly": true },
    { "key": "oficio",        "label": "Ofício",        "attribute": "int", "trainedOnly": true, "variants": true },
    { "key": "percepcao",     "label": "Percepção",     "attribute": "sab" },
    { "key": "pilotagem",     "label": "Pilotagem",     "attribute": "des", "trainedOnly": true },
    { "key": "pontaria",      "label": "Pontaria",      "attribute": "des", "tags": ["ataque"] },
    { "key": "reflexos",      "label": "Reflexos",      "attribute": "des", "tags": ["resistencia"] },
    { "key": "religiao",      "label": "Religião",      "attribute": "sab", "trainedOnly": true },
    { "key": "sobrevivencia", "label": "Sobrevivência", "attribute": "sab" },
    { "key": "vontade",       "label": "Vontade",       "attribute": "sab", "tags": ["resistencia"] }
  ],

  "resources": [
    { "key": "pv", "label": "Pontos de Vida", "abbr": "PV", "hasTemp": true, "minFormula": "-floor({max}/2)" },
    { "key": "pm", "label": "Pontos de Mana", "abbr": "PM" }
  ],

  "derived": [
    { "key": "armorPenalty", "label": "Penalidade de armadura", "abbr": "PdA", "formula": "{equip.armorPenalty}", "editable": false },
    { "key": "defense",      "label": "Defesa",                 "abbr": "DEF", "formula": "10 + min({attr.des}, {equip.maxAttr}) + {equip.defense}" },
    { "key": "dc",           "label": "CD de habilidades",      "abbr": "CD",  "formula": "10 + {halfLevel} + {spellcastingAttr}" },
    { "key": "carryLimit",   "label": "Limite de carga",        "abbr": "Carga", "formula": "10 + max({attr.for} * 2, {attr.for})" },
    { "key": "movement",     "label": "Deslocamento (m)",       "abbr": "Desl.", "formula": "9" }
  ],

  "level": {
    "$comment": "source vira \"classes\" na fase 4, quando classes forem itens.",
    "max": 20,
    "source": "manual",
    "xpTable": [0, 1000, 3000, 6000, 10000, 15000, 21000, 28000, 36000, 45000, 55000, 66000, 78000, 91000, 105000, 120000, 136000, 153000, 171000, 190000]
  },

  "sizes": [
    { "key": "minusculo", "label": "Minúsculo", "skillModifier": 5,   "tokenCells": 0.5 },
    { "key": "pequeno",   "label": "Pequeno",   "skillModifier": 2,   "tokenCells": 1 },
    { "key": "medio",     "label": "Médio",     "skillModifier": 0,   "tokenCells": 1 },
    { "key": "grande",    "label": "Grande",    "skillModifier": -2,  "tokenCells": 2 },
    { "key": "enorme",    "label": "Enorme",    "skillModifier": -5,  "tokenCells": 3 },
    { "key": "colossal",  "label": "Colossal",  "skillModifier": -10, "tokenCells": 6 }
  ],

  "damageTypes": [
    { "key": "normal",       "label": "Dano" },
    { "key": "corte",        "label": "Corte" },
    { "key": "impacto",      "label": "Impacto" },
    { "key": "perfuracao",   "label": "Perfuração" },
    { "key": "acido",        "label": "Ácido" },
    { "key": "eletricidade", "label": "Eletricidade" },
    { "key": "essencia",     "label": "Essência" },
    { "key": "fogo",         "label": "Fogo" },
    { "key": "frio",         "label": "Frio" },
    { "key": "luz",          "label": "Luz" },
    { "key": "psiquico",     "label": "Psíquico" },
    { "key": "trevas",       "label": "Trevas" },
    { "key": "cura",         "label": "Cura" }
  ],

  "currencies": [
    { "key": "tc", "label": "Tibar de cobre", "abbr": "TC", "ratio": 0.01 },
    { "key": "tp", "label": "Tibar de prata", "abbr": "TP", "ratio": 0.1 },
    { "key": "ts", "label": "Tibar",          "abbr": "T$", "ratio": 1 },
    { "key": "to", "label": "Tibar de ouro",  "abbr": "TO", "ratio": 10 }
  ],

  "traitFields": [
    { "key": "raca",      "label": "Raça" },
    { "key": "origem",    "label": "Origem" },
    { "key": "divindade", "label": "Divindade" },
    { "key": "tipo", "label": "Tipo de criatura", "type": "enum", "options": [
      { "key": "humanoide",  "label": "Humanoide" },
      { "key": "animal",     "label": "Animal" },
      { "key": "construto",  "label": "Construto" },
      { "key": "espirito",   "label": "Espírito" },
      { "key": "monstro",    "label": "Monstro" },
      { "key": "morto_vivo", "label": "Morto-vivo" }
    ] },
    { "key": "idiomas",   "label": "Idiomas" },
    { "key": "sentidos",  "label": "Sentidos" }
  ],

  "equipStats": [
    { "key": "defense",      "label": "Bônus de Defesa",         "aggregate": "sum", "default": 0 },
    { "key": "maxAttr",      "label": "Limite de atributo (DEF)", "aggregate": "min", "default": 99 },
    { "key": "armorPenalty", "label": "Penalidade de armadura",  "aggregate": "sum", "default": 0 }
  ],

  "itemKinds": [
    {
      "key": "weapon", "label": "Arma",
      "fields": [
        { "key": "proficiency", "label": "Proficiência", "type": "enum", "default": "simples", "options": [
          { "key": "simples", "label": "Simples" }, { "key": "marcial", "label": "Marcial" },
          { "key": "exotica", "label": "Exótica" }, { "key": "fogo", "label": "Arma de fogo" }
        ] },
        { "key": "purpose", "label": "Uso", "type": "enum", "default": "melee", "options": [
          { "key": "melee", "label": "Corpo a corpo" }, { "key": "melee_thrown", "label": "Corpo a corpo / arremesso" },
          { "key": "ranged", "label": "Disparo" }, { "key": "thrown", "label": "Arremesso" }
        ] },
        { "key": "wield", "label": "Empunhadura", "type": "enum", "default": "one_hand", "options": [
          { "key": "light", "label": "Leve" }, { "key": "one_hand", "label": "Uma mão" }, { "key": "two_hands", "label": "Duas mãos" }
        ] },
        { "key": "properties", "label": "Propriedades", "type": "text" }
      ]
    },
    {
      "key": "armor", "label": "Armadura / escudo",
      "statBonuses": ["defense", "maxAttr", "armorPenalty"],
      "fields": [
        { "key": "type", "label": "Tipo", "type": "enum", "default": "light", "options": [
          { "key": "light", "label": "Leve" }, { "key": "heavy", "label": "Pesada" },
          { "key": "shield", "label": "Escudo" }, { "key": "accessory", "label": "Acessório" }
        ] }
      ]
    },
    { "key": "gear", "label": "Equipamento" },
    {
      "key": "consumable", "label": "Consumível", "hasActivation": true, "hasSave": true,
      "fields": [
        { "key": "type", "label": "Tipo", "type": "enum", "default": "pocao", "options": [
          { "key": "pocao", "label": "Poção" }, { "key": "alquimico", "label": "Alquímico" },
          { "key": "municao", "label": "Munição" }, { "key": "outro", "label": "Outro" }
        ] }
      ]
    },
    {
      "key": "power", "label": "Poder", "physical": false, "hasActivation": true, "hasSave": true,
      "fields": [
        { "key": "type", "label": "Tipo", "type": "enum", "default": "geral", "options": [
          { "key": "classe", "label": "De classe" }, { "key": "concedido", "label": "Concedido" },
          { "key": "geral", "label": "Geral" }, { "key": "origem", "label": "De origem" }, { "key": "racial", "label": "Racial" }
        ] }
      ]
    },
    {
      "key": "spell", "label": "Magia", "physical": false, "hasActivation": true, "hasSave": true,
      "fields": [
        { "key": "circle", "label": "Círculo", "type": "number", "default": 1 },
        { "key": "school", "label": "Escola", "type": "enum", "default": "evocacao", "options": [
          { "key": "abjuracao", "label": "Abjuração" }, { "key": "adivinhacao", "label": "Adivinhação" },
          { "key": "convocacao", "label": "Convocação" }, { "key": "encantamento", "label": "Encantamento" },
          { "key": "evocacao", "label": "Evocação" }, { "key": "ilusao", "label": "Ilusão" },
          { "key": "necromancia", "label": "Necromancia" }, { "key": "transmutacao", "label": "Transmutação" }
        ] },
        { "key": "type", "label": "Tipo", "type": "enum", "default": "arcana", "options": [
          { "key": "arcana", "label": "Arcana" }, { "key": "divina", "label": "Divina" }, { "key": "universal", "label": "Universal" }
        ] }
      ]
    }
  ],

  "activation": {
    "executions": [
      { "key": "passive", "label": "Passiva" }, { "key": "standard", "label": "Padrão" },
      { "key": "move", "label": "Movimento" }, { "key": "full", "label": "Completa" },
      { "key": "reaction", "label": "Reação" }, { "key": "free", "label": "Livre" }, { "key": "special", "label": "Especial" }
    ],
    "durationUnits": [
      { "key": "instant", "label": "Instantânea" }, { "key": "scene", "label": "Cena" },
      { "key": "turn", "label": "Turno" }, { "key": "round", "label": "Rodada" },
      { "key": "sustained", "label": "Sustentada" }, { "key": "minute", "label": "Minuto" },
      { "key": "hour", "label": "Hora" }, { "key": "day", "label": "Dia" },
      { "key": "permanent", "label": "Permanente" }, { "key": "special", "label": "Especial" }
    ],
    "rangeUnits": [
      { "key": "self", "label": "Pessoal" }, { "key": "touch", "label": "Toque" },
      { "key": "short", "label": "Curto (9 m)" }, { "key": "medium", "label": "Médio (30 m)" },
      { "key": "long", "label": "Longo (90 m)" }, { "key": "special", "label": "Especial" }
    ],
    "targetTypes": [
      { "key": "self", "label": "Você" }, { "key": "creature", "label": "Criatura" },
      { "key": "object", "label": "Objeto" }, { "key": "area", "label": "Área" }
    ]
  },

  "$rules": "Em Tormenta20 o valor do atributo já é o modificador. Perícia = metade do nível + atributo + treino (+2/+4/+6) + tamanho (só algumas) + penalidade de armadura (só algumas).",
  "attackSkills": ["luta", "pontaria"],
  "skillTotal": "{halfLevel} + {attr} + {trained} + {sizeMod} + {armorPenalty}",

  "rolls": {
    "attributeCheck": "1d20 + {attr}",
    "skillCheck": "1d20 + {skill}",
    "initiative": "1d20 + {skill.iniciativa}",
    "attack": "1d20 + {skill}"
  },

  "damageAttribute": {
    "$comment": "Dano de arma soma FOR em corpo a corpo e arremesso; disparo não soma atributo.",
    "field": "purpose",
    "map": { "melee": "for", "melee_thrown": "for", "thrown": "for", "ranged": null }
  },

  "extraRolls": [
    { "key": "atk_melee",  "label": "Ataque corpo a corpo (Luta)",   "formula": "1d20 + {skill.luta}" },
    { "key": "atk_ranged", "label": "Ataque à distância (Pontaria)", "formula": "1d20 + {skill.pontaria}" }
  ],

  "tokenBar": "pv",

  "trainedBonus": [
    { "minLevel": 1,  "bonus": 2 },
    { "minLevel": 7,  "bonus": 4 },
    { "minLevel": 15, "bonus": 6 }
  ]
}
```
