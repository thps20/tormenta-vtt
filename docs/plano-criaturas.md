# Plano: criaturas do compêndio para o mapa

> Bloco de monstro como ficha NPC pré-montada no compêndio, paleta contextual sobre a Mesa e
> ficha rápida do NPC. Escrito em 08/09/2026, **antes** da implementação. Status: **aguardando
> aprovação do dono do projeto.**

**Princípio (o mesmo do compêndio de itens):** uma criatura é apenas um `Character` de `kind: "npc"`
pré-preenchido, **sem ids**. Soltar no mapa faz uma **cópia** (ficha nova + token vinculado), nunca um
vínculo com o compêndio: editar o goblin da mesa não mexe no compêndio e vice-versa. O servidor,
`computeCharacter`, o combate e o chat não ganham regra nenhuma nova — passa a existir só uma fonte
de fichas prontas.

**Regra número 1 respeitada:** nada de `"goblin"`, `"defesa"` ou `"1/4"` no código. Tudo que é regra
(quais atributos existem, o que é "tipo de criatura", que cor cada tipo tem, quantas células um
tamanho ocupa) sai do JSON do sistema; o código lê `def.traitFields`, `def.sizes[].tokenCells`,
`def.creatures.typeColors` etc.

**Nenhuma migration.** Criatura solta no mapa vira linha em `Character` (`data Json`) + linha em
`Token`, que já existem. As novidades de formato ficam dentro do `data` (validado por Zod) e no JSON
do sistema.

---

## Parte 0 — Mudanças no JSON do sistema e na ficha (base das outras três)

Antes de qualquer coisa: o bloco de monstro tem dados que a nossa ficha ainda não sabe guardar.

### 0.1 `SystemDefinitionSchema`: bloco `creatures` (opcional)

```jsonc
"creatures": {
  "$comment": "Como o app lê um bloco de criatura desta edição. Sistema sem este bloco não tem criaturas.",
  "typeField": "tipo",        // chave em traitFields[] com o tipo de criatura
  "ndField": "nd",            // chave em traitFields[] com o nível de desafio (só exibição)
  "defaultColor": "#7f1d1d",  // cor do token quando o tipo não estiver mapeado
  "typeColors": { "humanoide": "#b45309", "animal": "#4d7c0f", "construto": "#57534e",
                  "espirito": "#7e22ce", "monstro": "#991b1b", "morto_vivo": "#065f46" }
}
```

`validateSystemDefinition` confere: `typeField`/`ndField` existem em `traitFields[]`; cada chave de
`typeColors` é uma `options[].key` do `typeField`; cores no formato `HexColorSchema` que já existe.

**Por quê um bloco novo em vez de espalhar:** o código precisa de duas perguntas respondidas —
"onde está o tipo da criatura?" e "que cor esse tipo tem?". Deixar isso em `creatures` mantém
`traitFields[]` genérico (ele continua sendo "campo de texto sem regra") e deixa explícito que um
sistema sem criaturas simplesmente não declara o bloco.

### 0.2 `tormenta20.json`: dois `traitFields` novos

- `nd` — "Nível de desafio", tipo `text` (o ND é `"1/4"`, `"1/2"`, `"20"`: texto, não número).
- `deslocamentos` — "Outros deslocamentos", tipo `text` ("voo 12m, natação 9m"). O deslocamento
  normal já é o derivado `movement`, que é sobrescritível (`derivedOverrides.movement`).

### 0.3 `CharacterDataSchema`: `damageResponses`

```ts
export const DamageResponseSchema = z.object({
  /** Redução de dano (RD): subtrai do total. */
  reduction: z.number().int().default(0),
  /** "Reduz o dano à metade" (existe em homebrew; o Foundry não traz isso). */
  half: z.boolean().default(false),
  immune: z.boolean().default(false),
  vulnerable: z.boolean().default(false),
});

/** Resposta a dano da ficha. `all` vale para qualquer tipo (RD geral); `byType` é por damageTypes[].key. */
damageResponses: z.object({
  all: DamageResponseSchema.default({}),
  byType: z.record(KeySchema, DamageResponseSchema).default({}),
}).default({}),
```

**Decisão (sua, 08/09/2026): o servidor não muda.** `token:apply-damage` continua aplicando o valor
que o cliente manda; nenhum cálculo novo em `services/applyDamage.ts`. A resposta a dano é dado +
exibição (preview da criatura, ficha rápida, detalhes da ficha) **e** uma sugestão no seletor de
"Aplicar" — descrita no §0.4. O Mestre sempre confirma.

### 0.4 Sugestão no seletor de "Aplicar dano"

Quando o GM marca um token no `ApplyDamageButton`, o multiplicador já vem pré-selecionado pela
resposta a dano da ficha vinculada, com um aviso ao lado ("Imune a fogo", "Resistente a fogo (RD 5)",
"Vulnerável a fogo"). Ele pode trocar o multiplicador ou digitar o valor à mão, como hoje.

Função pura nova em `packages/shared/src/rules/damageResponse.ts`:

```ts
export interface DamageSuggestion {
  /** Pré-seleção no seletor; null = nenhum multiplicador simples serve (usa `amount`). */
  multiplier: "1" | "0.5" | "2" | "0" | null;
  /** Valor já ajustado (sempre calculado, parcela por parcela). */
  amount: number;
  /** Aviso curto para a UI, com os rótulos do sistema. "" = nada a avisar. */
  note: string;
}

/** Sugestão de aplicação de um card de dano num alvo, pela resposta a dano dele. */
export function suggestDamage(
  def: SystemDefinition,
  damage: DamageRollComponent[],
  responses: CharacterData["damageResponses"],
): DamageSuggestion;
```

Isso funciona porque **cada parcela do card já tem o seu próprio `total`**
(`DamageRollComponentSchema.total`), então dano misto ("21 = 7 fogo + 14 frio") é ajustado parcela por
parcela. Regras: imune → parcela vira 0; `half` → metade arredondada para baixo; `vulnerable` → dobra;
`reduction` → subtrai (piso 0). A resposta `all` entra em toda parcela, inclusive nas sem tipo.
`multiplier` só é sugerido quando a conta inteira equivale a um dos quatro botões (caso comum: uma
parcela só, imune/vulnerável/metade); com RD ou tipos mistos, `multiplier` é `null` e a UI preenche o
campo de valor à mão — que já limpa o multiplicador hoje. Cura (`isHealingType`) nunca é ajustada.

---

## Parte 1 — Compêndio: entrada do tipo "criatura"

### 1.1 `CompendiumEntry` vira uma união discriminada

Hoje `CompendiumEntry` é sempre um item (`kind` = chave de `itemKinds[]`). Passa a ser:

```ts
/** Corpo comum a uma entrada de item e a um item embutido numa criatura (sem id, sem tags). */
const CompendiumItemBodySchema = z.object({
  kind: KeySchema, name, description, fields, actions: ActionTemplateSchema[],
  activation, enhancements, save, statBonuses, slots, price, page,
});

export const CompendiumItemEntrySchema = CompendiumItemBodySchema.extend({
  type: z.literal("item"),
  id: CompendiumIdSchema,
  tags: z.array(...).default([]),
});

export const CompendiumCreatureEntrySchema = z.object({
  type: z.literal("creature"),
  id: CompendiumIdSchema,
  name, tags, description, page,
  /** A ficha pronta: CharacterData sem imageUrl/bio e com itens SEM id. */
  sheet: CreatureSheetSchema,
});

/** Entrada sem `type` é item (todos os JSONs atuais). Mesmo truque do TokenConditionEntrySchema. */
export const CompendiumEntrySchema = z.preprocess(
  (v) => (isObject(v) && !("type" in v) ? { ...v, type: "item" } : v),
  z.discriminatedUnion("type", [CompendiumItemEntrySchema, CompendiumCreatureEntrySchema]),
);
```

`CreatureSheetSchema = CharacterDataSchema.omit({ imageUrl: true, bio: true, items: true })
.extend({ items: z.array(CompendiumItemBodySchema).default([]) })` — ou seja: `level`,
`manualProgression`, `attributes`, `skills`, `resources`, `derivedOverrides`, `modifiers`, `traits`,
`currency`, `size`, `spellcastingAttribute`, `damageResponses` e os itens sem id.

**Por que união com `preprocess` e não um segundo evento/lista separada:** a paleta, a busca, o
arrasto e `dropTargets` já trabalham com "uma entrada"; separar em duas listas duplicaria tudo isso.
O `preprocess` mantém os oito JSONs atuais válidos sem tocar num byte deles, e o TypeScript vai
apontar, um por um, cada lugar que precisa perguntar `entry.type === "item"` antes de ler `entry.kind`
(`checkInsert`, `buildInsertPatch`, `EntryPreview`, agrupamento da paleta, importador).

Onde o bloco da criatura mora dentro da entrada: em `sheet`, não espalhado na raiz. Assim
`entryToCharacter` é quase um `CharacterDataSchema.parse(entry.sheet)` e fica óbvio o que é
"metadado de compêndio" (id, tags, página) e o que é "ficha".

### 1.2 Validação contra o sistema

Refatorar `validateCompendiumEntry` (`rules/compendium.ts`) extraindo `validateItemBody(def, body, where)`
— é o corpo que já existe — e acrescentar `validateCreatureEntry(def, entry)`, que confere:

- toda chave de `attributes`/`skills`/`resources`/`derivedOverrides`/`traits`/`currency` existe no sistema;
- `size` é uma `sizes[].key`; `spellcastingAttribute` é um atributo;
- toda chave de `damageResponses.byType` é um `damageTypes[].key`;
- o valor de `traits[def.creatures.typeField]` é uma opção declarada daquele `traitField`;
- cada item embutido passa pelo mesmo `validateItemBody`;
- `derivedOverrides` só usa derivados com `editable: true` (senão o override seria silenciosamente ignorado).

`validateCompendiumEntries` (loader) despacha por `type`. O teste `packages/shared/src/test/compendium.test.ts`
continua validando **todos** os arquivos da pasta, agora incluindo `creatures.json`.

### 1.3 `entryToCharacter`

```ts
/** Cópia da criatura como ficha NPC nova. `newId` é injetado (shared não escolhe como gerar ids). */
export function entryToCharacter(
  def: SystemDefinition,
  entry: CompendiumCreatureEntry,
  newId: () => string,
  opts?: { name?: string },
): { name: string; kind: "npc"; data: CharacterData }
```

Monta `CharacterData` com `CharacterDataSchema.parse({ ...entry.sheet, imageUrl: null, bio: "",
items: entry.sheet.items.map((body) => entryToItem(def, body, newId)) })`. `entryToItem` é
reaproveitado sem mudança (ele só lê o corpo do item, que agora é o tipo compartilhado).

`opts.name` existe para o nome numerado ("Goblin 3"); sem ele, `entry.name`.

### 1.4 Visibilidade: `compendium:list`

O ack passa de `CompendiumEntry[]` para:

```ts
"compendium:list": (payload: {}, ack: Ack<{ entries: CompendiumEntry[]; roomIds: string[] }>) => void;
```

- **Filtro no servidor:** `entries.filter((e) => e.type !== "creature" || ctx.role === "gm")`. Um
  jogador nunca recebe o bloco de nenhuma criatura — nem nome, nem PV. (A UI *também* esconde, mas a
  regra que vale é a do servidor.)
- `roomIds` = ids que vieram da fonte da sala (homebrew). A paleta usa isso para mostrar o chip
  "Sala" **só quando houver conteúdo** — sem inventar campo dentro da entrada, que também é o formato
  dos arquivos em disco.

O compêndio da sala (`services/compendium.ts`, hoje um stub que devolve `[]`) passa a poder conter
criaturas **só por tipo**: quando existir a tabela/tela de homebrew, uma entrada `type: "creature"`
já será aceita e mesclada por `mergeCompendium`. Nenhuma tela nova nesta fase.

### 1.5 Importador: `ameacas` → `creatures.json`

`scripts/import-foundry-compendium.ts` deixa de pular o pack `ameacas` (83 atores `type: npc`) e
ganha um conversor de criatura. Mesmas regras de sempre: só mecânica no repositório, nada inventado,
o que não casar vira TODO em `scripts/import-report.md`, saída ordenada e idempotente,
`custom.json` continua com precedência.

Mapeamento (todos por tabela `MAP.*`, conferindo que a chave existe no JSON do sistema):

| Foundry | Nosso |
|---|---|
| `system.atributos.<a>.base` | `attributes.<a>.base` |
| `system.attributes.pv/pm.max` | `resources.<pv/pm> = { current: max, temp: 0, maxOverride: max }` |
| `system.attributes.defesa.base` | `derivedOverrides.defense` |
| `system.attributes.cd` | `derivedOverrides.dc` |
| `system.attributes.movement.walk` | `derivedOverrides.movement` |
| `movement.fly/swim/climb/burrow` (≠ 0) | `traits.deslocamentos` ("voo 12m, natação 9m") |
| `system.attributes.nd` (`"1/4"`) | `traits.nd` |
| `system.attributes.nivel.value` | `level` (com `manualProgression: true`) |
| `system.tracos.tamanho` (`med`, `gra`…) | `size` (via `MAP.size`, que já existe) |
| `system.detalhes.tipo` (`hum`, `mon`, `ani`, `con`, `esp`) | `traits.tipo` (via `MAP.creatureType`) |
| `system.detalhes.sentidos` / `origem` / `divindade` | `traits.*` correspondentes |
| `system.tracos.idiomas.value[]` | `traits.idiomas` |
| `system.tracos.resistencias.<tipo>` | `damageResponses.byType.<tipo>`; a chave genérica `dano` → `damageResponses.all` |
| `system.pericias.<abrev>` | `skills.<pericia>` (reaproveita `skillByPrefix`) |
| `items[]` (`arma`/`poder`/`magia`/`equipamento`/`consumivel`/`tesouro`) | `sheet.items[]`, pelo mesmo conversor de item já existente |

**Perícias e o truque do "outros" (importante).** O Foundry guarda o **total** da perícia
(`inic.value = 4`), enquanto a nossa ficha guarda entradas e calcula o total pela fórmula
`skillTotal` do sistema. O importador então: grava `trained` do Foundry, calcula a ficha com
`computeCharacter` e ajusta `skills.<k>.other` pela diferença (`other += foundry.value - computado`).
Assim o total bate com o livro **usando a fórmula do próprio sistema**, sem hardcode — e a iniciativa
do bloco (`1d20 + {skill.iniciativa}`) sai certa de graça. Se a diferença não puder ser zerada, vai
para o TODO.

Números conferidos na fonte: 83 criaturas; ND de 1/4 a 20; tipos `hum` 43, `mon` 26, `ani` 8,
`con` 4, `esp` 2; tamanhos `med` 45, `gra` 22, `eno` 7, `peq` 5, `col` 3, `min` 1; 35 resistências
com valor e 20 imunidades/vulnerabilidades; itens embutidos: 203 poderes, 127 armas, 70 magias,
29 equipamentos, 22 consumíveis, 12 tesouros.

**Sem imagens** (`imageUrl: null`): o token nasce com inicial + cor, como já acontece hoje.
**Página**: `pageOf(system.source)`, como nos itens — quando houver.

**Descrições** (só com `--with-descriptions`, em `descriptions.local.json`, fora do git): a da
criatura na chave `<id>`; a de cada item embutido numa chave nova
`creatureItemTextKey(id, i) = "<id>#item<i>"`, aplicada por `withLocalTexts`. Sem o arquivo, a UI
mostra "ver livro, p. X" como já faz.

**Pack `convocacoes` (18 atores `type: simple`): recomendo NÃO importar agora.** Olhei os 18: são
convocações que escalam com o nível do conjurador, então o bloco no Foundry vem quase vazio —
Defesa 10 em 16 dos 18, PV 0 ou 1 em 12 deles, sem ND e sem tipo de criatura. Importar isso gera
18 entradas que não servem para soltar no mapa. Se você quiser, entra depois num passo próprio com
os valores conferidos no livro (em `custom.json`, que é o lugar do "confirmado à mão").

---

## Parte 2 — Paleta contextual (a mesma paleta, com dois contextos)

### 2.1 Contexto na store

`useCompendium` ganha `context: "sheet" | "map"` e `open({ context, kind })`. A paleta não vira dois
componentes: `CompendiumPaletteProps.character` passa a ser `Character | null` e entra
`context: PaletteContext`. Regras derivadas do contexto:

| | Ficha aberta (`sheet`) | Mesa em foco (`map`), GM | Mesa em foco (`map`), jogador |
|---|---|---|---|
| Entradas | itens (comportamento atual) | itens + criaturas | só itens (o servidor nem manda criaturas) |
| Chip inicial | aba de itens ativa | **Criaturas** | nenhum |
| Enter / "+" | insere na ficha | solta no centro da área visível | nada (só consulta) |
| Arrastar | para a ficha | para o mapa | não arrasta |

Chips: os de `itemKinds[]` como hoje, mais **Criaturas** (só GM) e **Sala** (só quando
`roomIds.length > 0`), que filtra por origem em vez de por tipo.

### 2.2 Onde ela aparece e como abre

- Modo novo `"map"` no `CompendiumPalette`: painel flutuante de 384 px **à esquerda da área do mapa**,
  sem o fundo escurecido do modo `floating` (o mapa continua visível e utilizável — é o alvo da
  soltura). Montado pelo `RoomPage`, dentro do `<main>`, ao lado do `VttCanvas`.
- Atalho: hook novo `useMapPaletteShortcut` no `RoomPage`, com o **mesmo** `isOpenPaletteShortcut`
  (Ctrl+Espaço, Ctrl+Shift+Espaço, "/" fora de campo de texto). Só arma quando não há ficha aberta,
  nem modal, e o foco não está digitando — assim ele nunca briga com o atalho do drawer da ficha,
  que continua sendo do drawer.
- Esc fecha; soltar fora do mapa cancela; Esc durante o arrasto cancela só o arrasto (igual hoje).

### 2.3 Preview de criatura

Componente novo `CreaturePreview.tsx` (irmão de `EntryPreview.tsx`), montado quando a linha focada é
`type: "creature"`. Tudo com rótulos vindos do JSON do sistema:

- cabeçalho: nome · ND (`creatures.ndField`) · tamanho (`sizes[].label`) · tipo (`options[].label`);
- recursos (`resources[]`: PV, PM), derivados (`derived[]`: Defesa, CD, Deslocamento) e iniciativa
  (`characterTiebreakBonus`, que já existe, sobre a ficha computada);
- resistências/imunidades/vulnerabilidades por tipo, com o `DamageTypeBadge` que já existe;
- ataques: rótulo, fórmula final e tipo de dano (mesma montagem do `EntryPreview`);
- nomes das habilidades e poderes (itens com `activation`), sem o texto;
- "ver livro, p. X" (`seeBook`) quando não houver descrição local;
- **quantidade** (número, 1..20, com as setas do input) e **toggle "invisível ao soltar"**
  (padrão **ligado**), lembrado na sessão (`sessionStorage`, lido na criação da store).

Enter no preview: solta `count` cópias no **centro da área visível do mapa**, com a mesma espiral.

### 2.4 Alvo de soltura "mapa" e o fantasma das células

`VttCanvas` registra em `dropTargets` o alvo `"map"` com
`accepts: (e) => e.type === "creature" && isGm`. Nada muda na paleta nem na store — era exatamente
para isso que o registro existe (`docs/plano-compendio.md` §8).

Durante o arrasto sobre o mapa, o canvas desenha um **fantasma**: `count` retângulos de células
(lado = `sizes[tamanho].tokenCells`, mínimo 1 célula), na cor do tipo da criatura, com
`listening={false}`, atualizados a cada `moveDrag`. As posições vêm da função pura de espiral —
a **mesma** que o servidor roda ao criar, então o que você vê é onde os tokens caem.

### 2.5 Espiral e numeração (funções puras em `shared`, testadas)

Arquivo novo `packages/shared/src/rules/placement.ts`:

```ts
export interface CellRect { col: number; row: number; cells: number }

/**
 * `count` posições livres a partir da célula `start`, andando em espiral (anéis de raio Chebyshev
 * crescente, ordem fixa dentro do anel) e pulando células ocupadas. Cada posição escolhida passa a
 * contar como ocupada para as seguintes. Devolve menos que `count` só se estourar `maxRadius`.
 */
export function findFreeCells(opts: {
  start: { col: number; row: number };
  cells: number;                  // lado do token em células (>= 1)
  count: number;
  occupied: CellRect[];
  bounds: { cols: number; rows: number };
  maxRadius?: number;             // padrão 12
}): { col: number; row: number }[];

/** ["Goblin"] quando count = 1 e nenhum "Goblin" existe; senão ["Goblin 1", ...] a partir do maior existente. */
export function numberedNames(base: string, count: number, existing: string[]): string[];
```

**Decisão (pequeno acréscimo ao que você pediu):** a numeração continua a partir dos tokens que já
estão na cena. Sem isso, soltar 3 goblins e depois mais 2 daria dois "Goblin 1" e dois "Goblin 2" no
mesmo mapa. Com N = 1 e nenhum homônimo, o nome fica sem número, como você pediu.

Conversão célula ↔ pixel continua sendo do `lib/grid.ts` no web (`snapToGrid` já existe; entram
`cellAt(point, grid)` e `cellRect(token, grid)`), e o servidor faz a mesma conta a partir de
`scene.grid`. Grid `"none"`: usa célula virtual de 70 px, exatamente como o botão "novo token" já faz.

**Refatoração de tabela:** o `findFreeSpot` que existe hoje dentro do `VttCanvas.tsx` (só 1×1, em
pixels) passa a ser um caso particular de `findFreeCells`. Um lugar só para a regra, e o botão
"novo token" ganha de brinde o respeito a tokens grandes.

### 2.6 Evento de soltura

```ts
/** Solta `count` cópias de uma criatura do compêndio na cena (GM). Uma transação, um broadcast. */
"compendium:spawn-creature": (payload: {
  sceneId: string; entryId: string; count: number /* 1..20 */; visible: boolean;
  /** Ponto de soltura em PIXELS DO MAPA (o servidor converte em célula e roda a espiral). */
  x: number; y: number;
}, ack: Ack<Token[]>) => void;
```

**Por que o cliente manda o ponto e não as posições:** servidor é a fonte da verdade. Ele carrega os
tokens da cena, roda a **mesma** `findFreeCells` e decide onde cada cópia cai — um cliente adulterado
não consegue empilhar tokens nem sair do mapa. O fantasma continua batendo porque a função é a mesma.

Handler (`socket/compendium.ts`), só GM:

1. carrega a entrada (`listCompendium`) e confirma `type === "creature"`;
2. `entryToCharacter` por cópia, com o nome numerado (`numberedNames` sobre os nomes já na cena);
3. **uma `prisma.$transaction`**: N `Character` (`kind: "npc"`, `ownerId: null`) + N `Token`
   (`characterId` da ficha, `width/height = tokenCells × cellSize`, `color` =
   `def.creatures.typeColors[tipo] ?? defaultColor`, `imageUrl: null`, `visible` = do toggle,
   `zIndex` sequencial);
4. broadcast: `character:created` por ficha (`broadcastCharacter` — NPC vai só para o GM) e
   `token:created` por token (`broadcastToken` — respeita `visible` e a névoa por participante,
   então token invisível não vaza para jogador nenhum);
5. ack com os tokens criados (o GM vê todos), e o cliente seleciona o primeiro.

Iniciativa: nada a fazer. O token tem ficha vinculada, então `combat:add`/`combat:start` já usam
`characterTiebreakBonus(def, character)` — o `{skill.iniciativa}` do bloco — em `combat.tiebreakBonus`.

---

## Parte 3 — Ficha rápida do NPC (contrato agora, UI do AI Studio depois)

### 3.1 O contrato

Vai para `docs/tipos-ficha-rapida.md`, no mesmo formato autocontido de `docs/tipos-combate.md` e
`docs/tipos-para-ui.md` (bloco `ts` sem imports, pronto para colar no AI Studio).

```ts
interface NpcQuickCardProps {
  token: Token;
  character: Character;
  /** computeCharacter(def, character): atributos, perícias, derivados e recursos já resolvidos. */
  computed: ComputedCharacter;
  /** Definição do sistema: TODO rótulo da UI sai daqui (nada de "Defesa" escrito no componente). */
  def: SystemDefinition;
  /** conditions[] do sistema + as ativas no token (chave + rodada de expiração). */
  conditions: ConditionDef[];
  activeConditions: TokenCondition[];

  /** Delta no recurso `tokenBar` do sistema (negativo tira, positivo cura). */
  onHpChange: (delta: number) => void;
  /** Dispara character:roll { type: "action" }. */
  onRoll: (ref: { itemId: string; actionId: string }) => void;
  onUseItem: (itemId: string) => void;
  onToggleCondition: (key: string) => void;
  onOpenFullSheet: () => void;
  onClose: () => void;
}
```

**Único desvio do que você escreveu:** `onRoll` recebe `{ itemId, actionId }` em vez de só
`actionId`. No nosso modelo uma ação vive **dentro** de um item (`CharacterItem.actions[]`) e o
evento `character:roll` exige os dois ids; um id solto não identifica a rolagem.

### 3.2 Versão mínima e onde ela entra

**Decisão (sua, 08/09/2026): no lugar do `TokenInspector`, não como aba dele.** Clique simples num token NPC do GM
(token com `characterId` de uma ficha `kind: "npc"`) abre o `NpcQuickCard`; qualquer outro token
abre o `TokenInspector` de sempre. O card tem um botão "Token" que troca para o `TokenInspector`
(nome, cor, dono, imagem, apagar continuam lá) e um "Ficha completa" que abre o drawer.

Por que substituir e não empilhar em abas: os dois painéis ocupam o mesmo canto e respondem à mesma
seleção; abas obrigariam a escolher uma aba padrão e, na prática, seria sempre a mesma. Um botão de
ida e volta é menos UI para o mesmo resultado — e quando a versão do AI Studio chegar, é só trocar o
componente, porque o `RoomPage`/`VttCanvas` só decide *qual* painel mostrar.

Conteúdo da versão mínima (sem capricho visual, que vem depois): nome + tipo/ND, barra de PV com
−/+ e campo de dano, Defesa e demais derivados, lista de ataques (clique rola), lista de itens com
ativação (clique usa), atalhos de condição e os dois botões acima.

---

## Ordem de implementação (um commit por passo, `make typecheck && make test` em cada)

| # | Passo | Onde |
|---|---|---|
| 1 | Bloco `creatures` no schema do sistema + `traitFields` `nd`/`deslocamentos` + `damageResponses` na ficha | `shared` |
| 2 | União `CompendiumEntry`, `CreatureSheetSchema`, `validateCreatureEntry`, `entryToCharacter` + testes | `shared` |
| 3 | `placement.ts` (`findFreeCells`, `numberedNames`) + testes; `VttCanvas` passa a usar | `shared`, `web` |
| 4 | Importador: `ameacas` → `creatures.json`, relatório atualizado | `scripts` |
| 5 | `compendium:list` com `{ entries, roomIds }` + filtro de criatura por papel | `shared`, `server`, `web` |
| 6 | `compendium:spawn-creature`: handler, transação, broadcast | `shared`, `server` |
| 7 | Paleta contextual: contexto na store, modo `"map"`, chips, atalho no `RoomPage` | `web` |
| 8 | `CreaturePreview` (quantidade + invisível) e soltura por Enter | `web` |
| 9 | Alvo de soltura "mapa" + fantasma das células no canvas | `web` |
| 10 | `suggestDamage` + pré-seleção e aviso no `ApplyDamageButton` | `shared`, `web` |
| 11 | Contrato `docs/tipos-ficha-rapida.md` + `NpcQuickCard` mínimo | `docs`, `web` |
| 12 | `docs/SPEC.md`: §9.5 nova, §3.3/§5/§8 atualizadas | `docs` |

## Testes (todos no `shared`, funções puras)

- `entryToCharacter`: cópia com ids novos (ficha e ações), itens embutidos viram `CharacterItem`
  válidos, `kind: "npc"`, `ownerId` fora do escopo da função; `opts.name` sobrescreve o nome.
- `validateCreatureEntry`: atributo/perícia/derivado/tipo de dano/tamanho/tipo de criatura inexistente
  dá mensagem apontando a entrada; derivado não editável em `derivedOverrides` é erro.
- `findFreeCells`: célula de destino livre; célula ocupada por token 1×1 empurra para a vizinha;
  token 2×2 pula qualquer célula tocada por outro token (inclusive por um 1×1 no canto);
  N cópias não se sobrepõem entre si; respeita os limites do mapa; determinístico (mesma entrada,
  mesma saída — é isso que faz fantasma e servidor concordarem).
- `numberedNames`: N = 1 sem homônimo → sem número; N = 1 com "Goblin" na cena → "Goblin 2";
  N = 3 a partir de "Goblin 2" → "Goblin 3..5".
- `suggestDamage`: imune → ×0; vulnerável → ×2; `half` → ×½; RD → valor à mão com o total certo;
  duas parcelas de tipos diferentes (imune a uma, vulnerável à outra) → `multiplier: null` e o valor
  somado parcela por parcela; alvo sem resposta a dano → ×1 e aviso vazio; cura nunca é ajustada.
- `systems.test.ts` e `compendium.test.ts` continuam passando, agora cobrindo `creatures.json` e
  o bloco `creatures` do `tormenta20.json`.

## Fora do escopo desta fase (backlog)

- Aplicar resistência/imunidade/vulnerabilidade **no servidor** (`token:apply-damage`). Nesta fase o
  cálculo é sugestão de UI (§0.4) e o Mestre confirma; o servidor segue aplicando o que recebe.
- Tela de homebrew da sala (criar/editar criatura na sala): só o **tipo** é aceito agora.
- Importar `convocacoes` (`type: simple`) — dados degenerados no Foundry, ver §1.5. Se um dia entrar,
  é à mão em `custom.json`, com os blocos conferidos no livro.
- Imagens de criatura (o pack tem `img`, mas seguimos sem copiar arte).
- UI caprichada da ficha rápida (vem do AI Studio sobre o contrato do §3.1).

## Decisões do dono do projeto (08/09/2026)

1. **Resistências**: guardar e exibir; o servidor não muda. No seletor de "Aplicar", o multiplicador
   correspondente vem pré-selecionado com o aviso ("resistente a fogo") e o Mestre confirma (§0.4).
2. **Ficha rápida**: no lugar do `TokenInspector`, com botão de ida e volta (§3.2).
3. **`convocacoes`**: fora do importador (§1.5).
