# Tipos da ficha rápida do NPC (NpcQuickCard)

Bloco com os tipos NOVOS do contrato `NpcQuickCardProps` (docs/plano-criaturas.md §3), pronto para
colar em outra ferramenta (o AI Studio vai desenhar a UI de verdade sobre este contrato). `Token` e
`ConditionDef`/`TokenCondition` vêm completos aqui; `Character`, `ComputedCharacter` e
`SystemDefinition` são grandes demais para duplicar de novo — cole **também** o conteúdo de
`docs/tipos-para-ui.md` (mesmo formato, mesma convenção `Key`/`Id`) na mesma sessão da ferramenta.

**Atenção:** os tipos de `Token`/`ConditionDef`/`TokenCondition` são a forma **inferida** dos
schemas Zod (`packages/shared/src/schemas/token.ts`, `.../schemas/system.ts`), com defaults já
aplicados. Se o schema mudar, regenere este bloco.

```ts
// --- Tipos já existentes, reproduzidos aqui pra o contrato ficar legível -----

type Id = string;
type Key = string;

type TokenHp = { current: number; max: number };

/** Condição ativa no token. Sem `expiresRound` = permanente (não expira em combat:next). */
type TokenCondition = { key: Key; expiresRound?: number };

type Token = {
  id: Id;
  sceneId: Id;
  name: string;                 // 1..64
  /** null = desenha um círculo com a inicial do nome. */
  imageUrl: string | null;
  /** Canto superior esquerdo, em pixels do mapa. */
  x: number;
  y: number;
  width: number;                // > 0
  height: number;               // > 0
  rotation: number;             // default 0
  zIndex: number;               // default 0
  /** false = só o GM vê. */
  visible: boolean;              // default true
  /** Participante que "controla" o token. null = só o GM. */
  ownerId: Id | null;
  color: string;                 // default "#e11d48"
  /** Ficha vinculada. null = sem ficha (o NpcQuickCard exige characterId não-null). */
  characterId: Id | null;
  /** PV do token SOLTO (sem ficha) — ignorado quando characterId aponta pra uma ficha, que é
   *  sempre o caso do NpcQuickCard (ele mostra o recurso `tokenBar` da FICHA, nunca isto). */
  hp: TokenHp | null;
  conditions: TokenCondition[]; // default []
};

/** Modificador que uma condição aplicaria na ficha (mesmo formato de Modifier.target: um seletor
 *  como "attr.for", "skill.luta", "derived.defense"...). Hoje só estrutura: nenhum código aplica
 *  isto na ficha ainda, a condição no token não afeta os valores calculados. */
type ConditionModifier = { target: string; value: number };

/** Marcador de condição do sistema (T20: Abalado, Cego, Atordoado...). */
type ConditionDef = {
  key: Key;
  label: string;
  /** SVG monocromático embutido (um `<svg>...</svg>`), pra desenhar o ícone. */
  icon: string;
  color: string;      // hex #rrggbb
  description: string; // default ""
  modifiers: ConditionModifier[]; // default []
  /** Duração inicial (rodadas) sugerida ao marcar a condição com combate ativo. */
  defaultDuration?: number;
};

// --- Contrato da ficha rápida ------------------------------------------------

/**
 * Ficha rápida de um NPC: abre no clique simples em token NPC do GM, no lugar do TokenInspector
 * genérico (que continua existindo pra qualquer outro token, atrás de um botão "Token" no card).
 * `character`/`computed` vêm de `computeCharacter(def, character)` — a MESMA função que a ficha
 * completa usa, então os valores nunca divergem. `def`/`computed` são cole-também de
 * docs/tipos-para-ui.md; nada aqui hardcoda um rótulo ("Defesa", "PV") fora do JSON do sistema.
 */
interface NpcQuickCardProps {
  token: Token;
  /** A ficha NPC vinculada (token.characterId aponta pra ela). */
  character: Character;
  /** computeCharacter(def, character): atributos, perícias, derivados e recursos já resolvidos. */
  computed: ComputedCharacter;
  /** Definição do sistema: todo rótulo da UI sai daqui (nada de "Defesa"/"PV" escrito no componente). */
  def: SystemDefinition;
  /** conditions[] do sistema (pra achar label/ícone/cor por key). */
  conditions: ConditionDef[];
  /** Condições ATIVAS neste token agora (token.conditions, já filtrado/ordenado por quem chama). */
  activeConditions: TokenCondition[];

  /** Delta no recurso `def.tokenBar` da ficha (negativo tira, positivo cura). Ex.: -8 num clique "-8". */
  onHpChange: (delta: number) => void;
  /** Dispara character:roll { type: "action", itemId, actionId } — uma ação vive DENTRO de um item. */
  onRoll: (ref: { itemId: Id; actionId: Id }) => void;
  /** Usa um item ativo (character:use-item): desconta o custo e publica o card no chat. */
  onUseItem: (itemId: Id) => void;
  /** Liga/desliga uma condição no token (permanente; duração fica pro TokenInspector/ConditionMenu). */
  onToggleCondition: (key: Key) => void;
  /** Troca pro TokenInspector genérico (nome, cor, dono, imagem, apagar) — o mesmo token, outra aba/modo. */
  onOpenFullSheet: () => void;
  onClose: () => void;
}

// --- Exemplo: Goblin batedor, PV 6/12, Abalado, com Clava e Fúria (poder) ---

const exampleQuickCard: Pick<NpcQuickCardProps, "token" | "activeConditions"> = {
  token: {
    id: "tok_goblin_1",
    sceneId: "scene_1",
    name: "Goblin batedor",
    imageUrl: null,
    x: 560,
    y: 420,
    width: 70,
    height: 70,
    rotation: 0,
    zIndex: 4,
    visible: true,
    ownerId: null,
    color: "#991b1b",
    characterId: "char_goblin_1",
    hp: null,
    conditions: [{ key: "abalado" }],
  },
  activeConditions: [{ key: "abalado" }],
};

// character/computed viriam de computeCharacter(def, character) sobre a ficha "char_goblin_1"
// (kind: "npc", PV atual 6, PV máximo 12 em computed.resources.pv.max, Defesa em computed.derived.defense).
// Ver docs/tipos-para-ui.md pros tipos Character/ComputedCharacter/SystemDefinition completos.
```
