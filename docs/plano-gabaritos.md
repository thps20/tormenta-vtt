# Plano: Gabaritos de área de efeito (templates)

Escopo: ferramenta de mesa (GM e jogador) para desenhar círculo, cone, linha e quadrado no mapa,
no estilo Foundry — medir alcance de magias/poderes e ver quem está dentro. **Fora deste plano**:
qualquer automação de regra (dano, CD, resistência não são aplicados sozinhos — só desenha e
destaca), fog of war interagindo com os gabaritos, e entrada na pilha de desfazer (§9.6).
Vira **§9.9** do SPEC.

## Decisões

- **Ângulo do cone e largura da linha são constantes do sistema** (`templates.coneAngle`,
  `templates.lineWidth` no JSON, padrão pra toda a sala), não campos digitados por gabarito —
  confirmado com o dono do projeto. `tormenta20.json` usa **90°** de ângulo padrão. A barra de
  ferramentas continua com um campo de tamanho só (o comprimento do cone/linha, o raio do círculo,
  o lado do quadrado); `angle`/`width` são copiados do padrão do sistema (ou do preset, ver abaixo)
  pro gabarito no momento em que ele é criado, pra continuar correto mesmo se o GM editar o JSON
  depois. Estilo Foundry: lá o ângulo/largura padrão vêm da config do sistema, só a distância é
  digitada na hora.
- **Presets podem sobrescrever ângulo/largura**: `templates.presets[].angle`/`.width` são opcionais;
  quando ausentes, o preset usa o padrão do sistema (`coneAngle`/`lineWidth`). Só faz sentido em
  `shape: "cone"` (`angle`) e `shape: "line"` (`width`) — ignorado nos demais.
- **Gate por presença do bloco**: `SystemDefinition.templates` é opcional. Sem ele, a ferramenta
  "Área" nem aparece na barra — mesmo princípio de "regra número 1" do projeto: nada de ângulo
  padrão hardcoded no código caso um sistema futuro não declare `templates`.
- **Sem automação de regra**: só desenha e destaca alvos por geometria; não aplica dano/CD sozinho
  (mesmo espírito do resto do projeto — condições e dano por tipo também não automatizam).
- **Não entra na névoa nem no undo/redo (§9.6)**: como a régua, é ferramenta efêmera de mesa, fácil
  de apagar à mão, não precisa de Ctrl+Z. Também não é afetado pela névoa (o pedido não menciona —
  GM e jogadores veem os gabaritos independente de fog, igual à régua).
- **Quem pode criar/mover/girar/apagar**: dono (quem criou) ou GM; jogador só age no mapa **ativo**
  da sala (mesma regra de `ruler:update`/`combat:delay`). GM em qualquer mapa que acesse.
- **Interação por geometria**, não pelo hit canvas do Konva (mesmo motivo de sempre neste projeto:
  `docs/debug-condicoes.md`/`debug-token.md` — canvas de hit embaralhado no ambiente real).

## 1. `packages/shared` (schema + regras puras)

### 1.1 Schema do sistema (`src/schemas/system.ts`)
Novo bloco opcional em `SystemDefinitionSchema`:
```ts
templates: z.object({
  coneAngle: z.number().positive().max(180),   // graus
  lineWidth: z.number().positive(),            // na unidade do grid (m)
  presets: z.array(z.object({
    label: z.string().max(60),
    shape: z.enum(["circle", "cone", "line", "square"]),
    size: z.number().positive(),               // raio/comprimento/lado, na unidade do grid
    angle: z.number().positive().max(180).optional(),  // só cone; ausente = templates.coneAngle
    width: z.number().positive().optional(),           // só linha; ausente = templates.lineWidth
  })).default([]),
}).optional(),
```
`validateSystemDefinition` não precisa de checagem extra (sem referência cruzada a outra lista).

### 1.2 `tormenta20.json`
Adiciona o bloco `templates` com `coneAngle: 90`, `lineWidth: 1.5` (1 célula) e alguns `presets` de
exemplo (ex.: "Bola de fogo: círculo 6 m", "Cone 9 m", "Lufada: linha 9 m", "Muralha: quadrado 3 m").

### 1.3 Schema do gabarito (`src/schemas/payloads.ts`, novo `TemplateSchema`)
Geometria em **pixels do mapa** (mesma convenção de token/fog), discriminada por `shape`:
```ts
const TemplateBase = z.object({ id: IdSchema, ownerId: IdSchema, x: z.number(), y: z.number(), rotation: z.number().default(0), label: z.string().max(60).default("") });
TemplateSchema = discriminatedUnion("shape", [
  TemplateBase.extend({ shape: "circle", r: positive }),
  TemplateBase.extend({ shape: "cone",   length: positive, angle: positive }),   // angle copiado de templates.coneAngle na criação
  TemplateBase.extend({ shape: "line",   length: positive, width: positive }),   // width copiado de templates.lineWidth na criação
  TemplateBase.extend({ shape: "square", side: positive }),
]);
```
`TemplateUpsertSchema = z.object({ sceneId: IdSchema, template: TemplateSchema, live: z.boolean().optional() })`;
`TemplateRemoveSchema = z.object({ sceneId: IdSchema, templateId: IdSchema })`. Cap simples
`TEMPLATE_MAX_PER_SCENE = 200` (guarda-corpo, mesmo espírito do limite de shapes da névoa), checado
no servidor.

### 1.4 Regras puras (`src/rules/templates.ts`, testado em `templates.test.ts`)
- `pointInTemplate(point, template): boolean` — hit-test geométrico (ponto dentro de
  círculo/setor/retângulo girado); usado pelo `apps/web` para selecionar um gabarito por clique
  (geometria, não hit do Konva) e como base do próximo item.
- `tokensInTemplate(tokens, template, grid): Set<tokenId>` — regra do enunciado: token conta se o
  **centro da célula** dele está dentro da forma; token grande (mais de 1 célula) conta se
  **qualquer célula** dele estiver dentro. Fica em `shared` (puro, testável) mesmo só o cliente
  consumindo — é só destaque visual, o servidor não participa disso.
- `parseAreaText(text, def): { shape, size } | null` — casa "esfera/círculo de N m", "cone de N m",
  "linha/raio de N m", "quadrado/cubo de N m" (sem acento/caixa, mesmo estilo do importador do
  compêndio, `docs/plano-compendio.md`); devolve `null` sem match (o botão do card então abre a
  ferramenta sem preset, como pedido).

## 2. `apps/server`

### 2.1 Estado em memória (`src/services/templates.ts`)
Mesmo padrão de `presence.ts`: `Map<sceneId, Map<templateId, Template>>` (não persiste — nem
sobrevive a restart, igual à régua/presença). Funções `upsertTemplate`, `removeTemplate`,
`listTemplates(sceneId)`, `clearTemplates(sceneId)`. `clearTemplates` é chamado em `scene:delete`
para não vazar memória com mapas apagados.

### 2.2 Handlers (`src/socket/templates.ts`)
- `template:upsert { sceneId, template, live? }`: valida sceneId (GM: `requireScene`; jogador:
  `isActiveScene` + `canAccessScene`, igual a `ruler.ts`). Se `template.id` já existe no mapa,
  exige `ownerId` bater com `ctx.participantId` a menos que `ctx.role === "gm"` (mesma regra de
  dono de token); se é novo, força `ownerId = ctx.participantId` no servidor (ignora o que o
  cliente mandou — nunca confia em `ownerId` do payload, mesmo princípio do resto do projeto).
  Aplica o cap `TEMPLATE_MAX_PER_SCENE`. Persiste em memória, broadcast de `template:upserted`.
- `template:remove { sceneId, templateId }`: mesma checagem de dono/GM; broadcast `template:removed`.
- **Broadcast de mapa** — mesma regra de `ruler.ts`/`fog.ts`: GM sempre recebe; jogador só se
  `sceneId` é o mapa ATIVO da sala.
- Sem ack de dado relevante (broadcast já é suficiente, como a régua); erro vai no `ok:false` de
  sempre (`HandlerError`).

### 2.3 Snapshot / troca de mapa
- `room:join` (`services/snapshot.ts`): inclui `templates: listTemplates(activeSceneId)` no
  `RoomSnapshot`, igual a como já inclui tokens/combate do mapa ativo.
- `scene:enter` (`src/socket/scene.ts`): ack ganha `templates` junto de `{ tokens, combat }`.

## 3. `apps/web`

### 3.1 Store (`src/store/templates.ts`, novo domínio)
`byScene: Record<sceneId, Record<templateId, Template>>` + `selectedId: string | null` (seleção é
só local, não sincronizada). Ações: `upsertLocal`/`removeLocal` (aplicadas pelo `bindSocket.ts` nos
broadcasts, e otimisticamente por quem edita), `create`/`move`/`rotate`/`remove` (emitem
`template:upsert`/`template:remove` via `emitAck`, com throttle ~30/s durante arraste/rotação,
mesmo padrão de `updateRuler`). Populada a partir do snapshot (`room:join`) e de `scene:enter`,
igual a `tokens.ts`/`combat.ts`.

### 3.2 `store/tools.ts`
- `ToolMode` ganha `"template"`.
- Novo estado: `templateShape: "circle"|"cone"|"line"|"square"`, `templateSize` (metros, campo da
  barra), e `placing: { shape, origin, size, rotation } | null` — gesto de colocação em andamento
  (origem já clicada; cone/linha giram até o 2º clique). Ações `startPlacing`, `updatePlacingAngle`,
  `confirmPlacing` (chama `useTemplates.getState().create(...)` com a geometria final convertida
  pra pixels via `grid.ts`), `cancelPlacing` (Esc, já cai no `cancel()` geral).
- Atalho **T** em `KEY_TO_MODE` (`useToolShortcuts.ts`) — não é GM-only (jogador também coloca os
  próprios gabaritos).

### 3.3 `TemplateToolbar.tsx` (novo, ao lado da `Toolbar`, padrão de `FogToolbar.tsx`)
Segmented de forma (círculo/cone/linha/quadrado, ícones do lucide-react), campo numérico de tamanho
em metros (converte pra pixels só na hora de confirmar, via `grid.cellSize`/`unit` do sistema —
mesmo cálculo de `rules/measure.ts` mas invertido: metros → células → pixels da cena), e um
dropdown de presets (`def.templates.presets`) que preenche forma+tamanho ao escolher (não
posiciona sozinho — o clique no mapa continua definindo a origem).

### 3.4 Canvas (`VttCanvas.tsx` + novo `TemplateLayer.tsx`)
- **Decisão na implementação** (diferente do planejado abaixo): em vez de uma camada nova entre o
  grid e os tokens, o `TemplateLayer` entrou na última `<Layer>` já existente (a mesma de régua,
  névoa em desenho e caixa de seleção) — reaproveita a infraestrutura pronta em vez de inserir mais
  uma `<Layer>` do Konva. Efeito colateral aceito: os gabaritos desenham **por cima** dos tokens
  (fill translúcido a ~20%, então o token continua visível através dele), não por baixo como a ideia
  original abaixo pretendia. Sem prejuízo prático (a régua e a caixa de seleção já faziam o mesmo).
- ~~Camada nova entre "linhas do grid" e "tokens" (ordem hoje: mapa → grid → tokens → réguas; passa a
  ser mapa → grid → **templates** → tokens → névoa → réguas — abaixo dos tokens pra não tampar a
  arte deles, acima do grid pra ficar visível).~~
- Formas via Konva: `Circle` (círculo), `Wedge` (cone — setor nativo, ângulo e raio direto), `Rect`
  rotacionado (linha = retângulo comprimento×largura com origem numa ponta; quadrado = retângulo
  comprimento×comprimento com origem no centro), preenchimento translúcido + borda, `listening={false}`
  (toda interação é por geometria, não hit do Konva).
- Gesto de colocação: `mode === "template"` — clique no mapa vazio chama `startPlacing` com a
  origem; círculo/quadrado confirmam no mesmo clique; cone/linha atualizam `rotation` (ângulo
  origem→ponteiro) a cada `mousemove` e confirmam no segundo clique. Esc cancela (fluxo geral de
  `cancelNonce`).
- Selecionar um gabarito existente (modo Selecionar): `pointInTemplate` (via a ponte
  `apps/web/src/lib/templates.ts`) contra a posição do clique, varrendo os templates do mapa
  visitado (mesmo padrão de detecção manual de clique em token/badge de condição, por causa do hit
  canvas sabotado). Selecionado ganha alça de mover (arrastar o corpo) e alça de girar (ponto na
  "ponta"), ambas com pointer events manuais + throttle; `Delete`/`Backspace` remove (fora de campo
  de texto).
- Contagem "N alvos": `tokensInTemplate` sobre os tokens do mapa visitado, como rótulo no gabarito
  e anel de destaque nos tokens atingidos.

### 3.5 Botão "Colocar área" no card de item (chat)
Em `ItemCardMessage.tsx`, ao lado da linha "Área" (quando `card.area` não vazio e `canAct`): botão
que chama `parseAreaText(card.area, def)`; com match, `useTools.getState()` já entra no modo
`"template"` com `templateShape`/`templateSize` preenchidos pelo preset encontrado; sem match, só
troca pro modo `"template"` (sem preset), como pedido.

### 3.6 Toolbar principal
`Toolbar.tsx` ganha a entrada `{ mode: "template", label: "Área", shortcut: "T", Icon: ... }` na
lista `TOOLS` (não GM-only) — só aparece se `def.templates` existir (checagem no componente pai,
que já tem o `SystemDefinition` da sala).

## 4. Desfazer/refazer (GM e jogador)

**Decisão na implementação**: além do pedido, `TemplateUpsertSchema` ganhou `dragFrom` (x/y/rotation
capturados no MOUSEDOWN de mover/girar) — sem ele, o "antes" que o servidor lê no commit final já
refletia os ecos `live` do arraste (só ~33ms atrás do fim do gesto, não o início dele), o mesmo bug
que `TokenPatch.dragFrom` já resolve pra token (docs/plano-desfazer.md §3). `VttCanvas.tsx` captura
`startTemplate` no mousedown de mover/girar e manda `dragFrom` no `onTemplateCommit` final.

- **Servidor (GM)**: `apps/server/src/socket/templates.ts` — `template:upsert`/`template:remove`
  fora de `live`, quando `ctx.role === "gm"`, montam uma `HistoryEntry` (`services/history.ts`,
  `pushEntry`/`emitHistoryUpdated`, mesmo padrão de `socket/token.ts`). `getTemplate` (novo em
  `services/templates.ts`) dá o objeto inteiro antes de sobrescrever/remover. `templateChangeAction`
  decide "colocar"/"mover"/"girar" (ou `null` = nada mudou, não empilha) comparando `dragFrom` (ou o
  próprio `before`, na criação) com o `saved`. `templateAreaLabel` converte o tamanho de pixels pra
  metros com o `grid` do sistema + um `prisma.scene.findUnique` (só no commit final, não em cada
  `live`) — "cone 9 m" no resumo. `revert`/`apply` reescrevem o gabarito em memória direto
  (`writeTemplate`/`writeTemplateRemoval`), sem linha de banco pra invalidar — best-effort, como a
  régua.
- **Cliente (jogador)**: `apps/web/src/store/templateHistory.ts` (novo) — pilha local, só undo (sem
  redo, como a Névoa). Empilhado em `RoomPage.tsx` (`handleTemplateCreate`/`handleTemplateCommit`, só
  quando `!isGm`) e `useDeleteSelectionShortcut.ts` (`deleteSelectedTemplate`). `useToolShortcuts.ts`:
  Ctrl+Z do jogador (que antes não fazia nada) chama `useTemplateHistory.getState().undo()`.
  `describeTemplateAreaChange`/`templateAreaLabel` (novo, `apps/web/src/lib/templates.ts`) montam o
  mesmo texto do lado do cliente — já tem `sizeUnits` da UI, não precisa converter de pixels do banco.

## 5. Criar por clique e arrasto

Substituiu o fluxo de 2 cliques (cone/linha giravam até o 2º clique) por inteiro — não sobrou nada
do fluxo antigo. `VttCanvas.tsx`: `templateCreateRef` (origem + ponteiro cru do mousedown) +
`templateDraftLive` (tamanho/rotação recalculados a cada `mousemove`) substituem o antigo
`placingTemplate`. Confirma no `mouseup`: acima do limiar de ~4px de tela (mesmo da caixa de
seleção) usa o tamanho/rotação do arrasto; abaixo, usa `templateTool.sizeUnits` da barra e rotação 0
(clique-sem-arrasto — presets continuam funcionando).

- **Snap**: por forma (refinado no §7 — a primeira versão usava `snapToVertexOrCenter` pra toda
  origem e meia célula pro tamanho de qualquer forma; ficou certo só pro cone). Os quatro só valem
  com "Grudar no grid" ligado (o toggle já existente, `snapEnabled`) E `scene.grid.type !== "none"`
  — Alt/Shift são um *override* temporário desse toggle, não um mecanismo paralelo.
- **Rótulo ao vivo**: `templateDraftLabel` (`VttCanvas.tsx`) monta "6 m • 2 alvos" a partir do
  rascunho; `TemplateLayer.tsx` ganhou o prop `draftLabel` e desenha perto do rascunho, mesmo padrão
  do rótulo "N alvos" dos gabaritos de verdade.
- **Células cobertas**: `templateCoveredCells` (novo, `lib/templates.ts`) devolve os cantos (em
  pixels) das células cujo CENTRO cai no gabarito (mesma regra de `tokensInTemplate`), com um
  guarda-corpo de 4000 células. `TemplateLayer.tsx` desenha um `Rect` translúcido por célula
  (`CellFill`), mais fraco que o contorno geométrico — pros gabaritos de verdade E o rascunho, só
  quando `scene.grid.type !== "none"`.

## 6. Área estruturada nos itens

- `packages/shared/src/schemas/character.ts`: `TemplateAreaSchema` (novo) — discriminada por `kind`
  ("shape" com `shape`/`size`, ou "text" com `text`), `nullable`, com `preprocess` migrando o formato
  antigo (string solta, persistida em `Character.data` e `ChatMessage.item`, ambos `Json`) sem
  migration de banco. Reaproveitada em `ActivationSchema.area` **e** `ItemCardSchema.area` — os dois
  precisavam do mesmo tratamento (`ItemCardSchema` não estava no pedido original, mas
  `ChatMessageSchema.parse()` roda em TODA leitura do histórico, `serialize.ts:toChatMessage`; sem o
  `preprocess` ali, um card antigo no banco quebraria `room:join` inteiro).
- `schemas/template.ts`: `TemplateShapeSchema` (novo, extraído do `discriminatedUnion`) — fonte única
  do enum de forma, usada em `Activation.area.shape` e `TemplatePresetSchema.shape`.
- `schemas/system.ts`: `TemplatesDefSchema.shapeLabels` (novo, obrigatório dentro do bloco opcional
  `templates`) — nome de cada forma na linguagem do sistema. `tormenta20.json`: círculo = "Esfera"
  (linguagem do livro), resto igual ao nome da forma. `TemplateToolbar.tsx` trocou o array hardcoded
  de labels por este campo, pra não ter dois vocabulários divergentes pra mesma forma (regra
  número 1).
- `rules/templates.ts`: `parseAreaText` ganhou "`<forma>` com N m" além de "de" (cobre "esfera com 6m
  de raio"); `formatArea` (novo) monta o texto legível ("Esfera 6 m" / o texto) pro card, preview do
  compêndio (`EntryPreview.tsx`) e ficha rápida (`NpcQuickCard.tsx`, que antes não mostrava área
  nenhuma). `rules/enhancements.ts`: `areaSet` continua só texto (sobrescreve qualquer forma
  estruturada, sem mudança de comportamento).
- Editor (`ItemsSection.tsx`): `AreaField` (novo) — select de modo (Nenhuma/Forma/Especial; "Forma"
  só aparece com `def.templates`) + select de forma (rótulos de `shapeLabels`) + número + unidade do
  grid.
- Importador: `Converter.activation()` casa `s.area` com `parseAreaText`; `Report.areaShapes`/
  `areaTexts` contam o resultado, reportados no `import-report.md`. **Rodado em 10/09/2026**: 54
  entradas viraram forma reconhecida, 33 ficaram como texto livre.
- `ItemCardMessage.tsx`: removido o `parseAreaText(card.area)` do card — `card.area` já vem
  estruturado do servidor; o botão "Colocar área" só aparece com `kind === "shape"`.

## 7. Snap por forma

A primeira versão do §5 usava `snapToVertexOrCenter` (vértice OU centro, o mais perto) pra origem
de QUALQUER forma e meia célula pro tamanho de qualquer forma — funciona bem pro círculo/cone (a
regra do centro decide as células sozinha), mas deixava quadrado e linha cobrindo meia célula de
sobra em qualquer lado ímpar de células. Ajuste pedido: cada forma tem seu próprio snap de origem/
tamanho/direção, todos sob o mesmo toggle "Grudar no grid" + Alt solta (agora conferido o tempo
todo do arrasto, não só no mousedown — pequena correção de consistência encontrada nesta rodada).

- **Círculo**: origem só `snapToCellCenter` (era `snapToVertexOrCenter`). Tamanho continua meia
  célula (`roundToHalfCell`, sem mudança).
- **Cone**: sem mudança nenhuma (`snapToVertexOrCenter`, meia célula, 15°).
- ~~**Quadrado**: origem só `snapToGrid` (vértice). Tamanho em célula inteira (`roundToWholeCell`) —
  o vértice onde a origem grudou vira um CANTO do quadrado final via `squareCenterFromCorner`.~~
  **Superseded pelo §8**: origem em vértice ainda deixava um lado ÍMPAR de células com o centro
  exatamente na borda de células vizinhas em certos arrastos (a correção do dono do projeto) —
  virou âncora de CÉLULA, não de vértice.
- ~~**Linha**: origem (a ponta) só `snapToGrid`. Comprimento em célula inteira. Direção em passos
  de 45° (`roundAngleToStep`). Largura sem mudança.~~ **Superseded pelo §8**: origem em vértice
  deixava a linha CENTRADA numa linha do grid (metade numa fileira de células, metade na vizinha),
  não dentro de uma fileira inteira — também virou âncora de célula.

## 8. Correção: quadrado/linha como conjuntos de células

Ajuste sobre o §7: quadrado e linha (com grid ativo) deixam de ser geometria contínua "com snap" e
viram **conjuntos de células inteiras por definição** — nunca geometria livre. A âncora não é mais
um PONTO (vértice), é a CÉLULA sob o cursor no mousedown; o resto (quantas células, pra que lado)
vem do arrasto em termos de célula, não de pixel/distância.

- **`apps/web/src/lib/grid.ts`**: `cellCenter(cell, grid)` (novo) — centro em pixels de uma célula
  por índice `{col,row}` (inverso de `cellAt` + meio lado); usado pra achar de onde a linha "sai".
- **`apps/web/src/lib/templates.ts`** — trocou `roundToWholeCell`/`squareCenterFromCorner` (§7,
  removidos) por funções que trabalham em índice de célula, não em tamanho contínuo:
  - `squareFromAnchorCell(anchorCell, pointerCell, grid)`: `cells` (n) = distância Chebyshev entre
    as duas células + 1; o quadrante (`pointerCell.col/row >= anchorCell.col/row`) decide se o
    bloco cresce pra frente ou pra trás a partir da âncora em cada eixo — ela nunca fica de fora.
    Devolve x/y (centro, o que o `Template` guarda) e `side` já em pixels, calculados a partir dos
    CANTOS das células via `cellToPoint` (não há conversão de tamanho contínuo envolvida).
    `newSquareFromAnchorCell` monta o `Template` inteiro.
  - `cellStep(cellSizePx, direction)`: distância entre o centro de uma célula e o centro da
    PRÓXIMA na mesma direção — `cellSize` reto, `cellSize × √2` na diagonal (a distância real entre
    dois centros vizinhos na diagonal é maior; **bug pego pelo teste da escada**: usar `cellSize`
    fixo pra comprimento fazia uma linha diagonal de N células cobrir só ~N/√2 células de verdade).
  - `lineTipFromAnchorCell(anchorCell, direction, grid)`: sai do CENTRO da célula-âncora até a
    borda (direção reta) ou o canto (diagonal) mais próximos da direção, usando
    `cellStep(...)/2` como distância — fórmula padrão de "centro até a borda de um quadrado numa
    direção θ", `(size/2) / max(|cos θ|, |sin θ|)`. Sai do CENTRO (não de um vértice) pra linha
    ocupar 100% da célula, nunca ficar centrada numa linha do grid.
  - `newLineFromAnchorCell(anchorCell, direction, cells, grid, ownerId)`: `length = cells *
    cellStep(...)` (não `cells * cellSize`, por causa do bug acima); `width` sempre `cellSize`
    (célula inteira, ignora `templates.lineWidth` nesse modo — a regra aqui é célula inteira,
    independente do que o sistema configurar).
  - `cellsFromSizeUnits(sizeUnits, def)`: converte o campo de tamanho da barra (metros) numa
    contagem de células — usado só no clique-sem-arrasto (presets), mínimo 1.
- **`VttCanvas.tsx`**: `templateCreateRef` virou uma união discriminada por `kind`: `"cell"`
  (quadrado/linha com grid ativo — âncora é `{col,row}`, não um ponto) ou `"free"` (círculo/cone
  sempre; quadrado/linha sem grid ativo — origem é um ponto, como antes). `templateDraftLive`
  deixou de ser um "saco de parâmetros" (`origin/sizeUnits/rotation/squareCorner/sign`, §7) e virou
  DIRETAMENTE o `Template` calculado — simplifica bastante: `mousedown`/`mousemove` montam o
  gabarito final na hora (com `newSquareFromAnchorCell`/`newLineFromAnchorCell` pro `kind: "cell"`,
  `newTemplate` pro `"free"`) e o `mouseup` só decide se usa o rascunho (arrastou) ou monta de novo
  com o clique-sem-arrasto (`buildClickCellTemplate`, novo helper do arquivo — quadrado ancora na
  célula clicada e cresce pra baixo/direita, linha aponta pra direita, mesma regra do arrasto). Não
  existe mais useMemo derivando o Template do estado — um a menos pra manter sincronizado.
  Consequência da mudança de modelo: Shift não solta mais a direção da linha ancorada em célula
  (só os 45° fazem sentido nesse modo — livre quebraria a garantia de célula inteira); pra
  direção livre, Alt tira a linha do modo "cell" inteiro, caindo no `"free"` de sempre.
- ~~**`TemplateLayer.tsx`**: quadrado/linha com células cobertas conhecidas (grid ativo) desenham só
  o BLOCO de células (`CellBlock` — um `Rect` POR CÉLULA, cada um com o próprio stroke).~~
  **Superseded pelo §9**: isso desenhava uma borda em CADA célula, criando linhas internas visíveis
  entre células vizinhas — o dono do projeto pediu de volta um preenchimento único com só o
  contorno externo, "como era antes".
- **Testes** (`apps/web/src/lib/templates.test.ts`): os 4 cenários pedidos — linha horizontal de 6
  células cobre exatamente (3..8, 4); linha diagonal de 3 cobre a escada (3,4)→(4,5)→(5,6); quadrado
  2×2 ancorado em (3,4) cobre (3..4, 4..5); arrasto pra cima/esquerda inverte a âncora sem sair da
  célula clicada. Mais linha vertical e o teste de 1 célula (não 4 pela metade).

## 9. Correção: sem bordas internas entre células

Ajuste sobre o §8: o `CellBlock` (um `Rect` com stroke POR CÉLULA) desenhava uma linha visível na
fronteira entre células vizinhas — o pedido era voltar a um preenchimento único com só o contorno
EXTERNO do conjunto de células, "como era antes" (a forma lisa de antes do §8).

A saída acabou não precisando de nenhum algoritmo de "contorno da união de polígonos": dado que só
existem duas famílias de forma aqui, cada uma tem uma solução exata e barata.

- **Quadrado (sempre) e linha no EIXO do grid (múltiplo de 90°)**: as células cobertas SEMPRE
  formam um retângulo sólido (um bloco n×n, ou uma fileira 1×n) — a própria forma lisa geométrica
  (`TemplateShapeNode`, o `Rect` de sempre) já é PIXEL A PIXEL essa mesma área, por construção
  (`newSquareFromAnchorCell`/`newLineFromAnchorCell`, §8). Não tem "união" pra calcular: é só
  desenhar a forma lisa de novo, sem nenhum `Rect` por célula. Também sem o overlay sutil de célula
  por cima (`CellFill`) — seria a MESMA área desenhada duas vezes, não informação nova.
- **Linha na DIAGONAL (múltiplo de 45°, mas não de 90°)**: aqui uma célula só toca a vizinha por um
  CANTO — elas nunca compartilham uma aresta inteira (diferente do bloco sólido acima). Sem aresta
  compartilhada, não existe "borda interna" nenhuma pra remover: desenhar cada célula com o próprio
  contorno (`CellBlock`, mantido, sem mudança) JÁ é exatamente o contorno externo da escada — os
  "degraus" da escada são as próprias bordas de cada célula. O pedido pareceu implicar um algoritmo
  de contorno pra esse caso, mas a geometria (células só se tocando no canto) já resolve sozinha.
- **`packages/shared`/`apps/web/src/lib/templates.ts`**: `templateIsSolidBlock(t)` (quadrado sempre;
  linha só se `rotation` é múltiplo de 90°) e `templateIsDiagonalLine(t)` (linha, múltiplo de 45° mas
  não de 90°) — os dois testes puros que decidem qual desenho usar, extraídos pra serem testáveis
  (`isAngleMultipleOf`, privada, mesma folga de ponto flutuante de `roundAngleToStep`). Nenhuma
  mudança nas funções que calculam as células cobertas (`templateCoveredCells` etc.) — só a
  renderização, como pedido.
- **`TemplateLayer.tsx`**: `TemplateBody` decide entre 3 casos — `templateIsDiagonalLine` → `CellBlock`
  (célula por célula, como já era); `templateIsSolidBlock` → só `TemplateShapeNode` (forma lisa, sem
  `CellFill` por cima); nenhum dos dois (círculo/cone sempre; uma linha LIVRE, ângulo fora dos
  múltiplos de 45° — só acontece com Alt numa linha que por acaso saiu bem perto de 45°, ou numa
  cena sem grid) → forma lisa + `CellFill` por cima, como já era pra círculo/cone.
- **Testes** (`apps/web/src/lib/templates.test.ts`): `templateIsSolidBlock`/`templateIsDiagonalLine`
  pras 4 formas nos ângulos relevantes (eixo, diagonal, livre) — sem teste de snapshot visual (o
  projeto não tem infra pra isso); a garantia de que as células cobertas continuam certas já vem
  dos testes do §8, que não mudaram.

## SPEC (`docs/SPEC.md`)

**§9.9 Gabaritos de área de efeito (templates)** cobre as cinco partes: modelo
(`SystemDefinition.templates` com `shapeLabels`, `Template` discriminado por forma), persistência,
eventos (com `dragFrom`), **desfazer/refazer** (GM na pilha geral, jogador com Ctrl+Z local),
**ferramenta "Área" por clique-e-arrasto** (§7/§8: círculo no centro de célula, cone vértice-ou-
centro a 15°, quadrado/linha ancorados em CÉLULA com grid ativo — sempre conjuntos de células
inteiras — e geometria livre nos dois quando o grid está desligado; §9: quadrado/linha no eixo
desenham a forma lisa de sempre — já é a união das células —, só a linha na diagonal desenha célula
a célula, sem borda interna nenhuma pros outros dois casos), destaque de alvos, **área estruturada**
(`Activation.area`, editor, importador) e o botão "Colocar área". Também: uma linha na tabela de
eventos (§5, `dragFrom` no payload), o escopo de §9.6 (Desfazer/refazer) ganhou a menção aos
gabaritos do GM, e a linha de "Estado da implementação" (§8 do SPEC) foi atualizada (undo/redo
deixou de ser uma limitação).

## Arquivos principais

- `packages/shared/src/schemas/{template,system,character}.ts`, `systems/tormenta20.json`
- `packages/shared/src/rules/{templates,enhancements,activation}.ts` + testes
- `apps/server/src/services/templates.ts` (`getTemplate`), `apps/server/src/socket/templates.ts`
  (desfazer do GM)
- `apps/web/src/lib/{grid,templates}.ts` (+ `templates.test.ts`), `store/templateHistory.ts` (novo),
  `store/templates.ts`, `useToolShortcuts.ts`, `useDeleteSelectionShortcut.ts`
- `apps/web/src/components/{VttCanvas,TemplateLayer,TemplateToolbar,RoomPage}.tsx`
- `apps/web/src/components/character/ItemsSection.tsx`
- `apps/web/src/components/chat/ItemCardMessage.tsx`, `compendium/EntryPreview.tsx`,
  `NpcQuickCard.tsx`
- `scripts/import-foundry-compendium.ts`
- `docs/SPEC.md`, `docs/backlog.md`

## Verificação

- `make typecheck && make test` (`templates.test.ts` em `shared` cobre `tokensInTemplate`,
  `pointInTemplate`, `parseAreaText`, `formatArea`, `describeTemplateChange`, `TemplateAreaSchema`;
  `templates.test.ts` em `apps/web` cobre `pixelsToUnit`, `roundToHalfCell`, `roundAngleToStep`,
  `cellsFromSizeUnits`, os 4 cenários pedidos com `newSquareFromAnchorCell`/`newLineFromAnchorCell`
  + `templateCoveredCells` (linha reta, diagonal, quadrado 2×2, âncora invertida), e
  `templateIsSolidBlock`/`templateIsDiagonalLine` (§9); `grid.test.ts` cobre
  `snapToVertexOrCenter`/`cellCenter`; `systems.test.ts` continua validando o `tormenta20.json` com
  `shapeLabels`).
- Importador rodado (`pnpm import:compendium`): 54 áreas viraram forma reconhecida, 33 ficaram texto
  livre (`scripts/import-report.md`).
- Manual com `make dev`: GM arrasta pra criar as 4 formas; confere quadrado/linha no eixo SEM borda
  interna nenhuma (preenchimento único, só o contorno externo — igual a antes do §8), linha na
  diagonal com o contorno seguindo os degraus da escada; quadrado/linha SEMPRE em célula inteira
  (nunca sobra meia célula, nunca linha centrada num grid line), célula clicada sempre coberta mesmo
  arrastando pra trás; linha só nos eixos/diagonais (sem Shift pra soltar); círculo/cone continuam
  com a forma lisa + overlay sutil de célula por cima, sem borda interna nenhuma (já não tinham);
  Alt tira quadrado/linha do modo célula (geometria livre); clique-sem-arrasto em quadrado/linha
  ainda usa o preset, agora arredondado pra células inteiras a partir da célula clicada; Ctrl+Z
  desfaz colocar/mover/girar/apagar com toast (GM pela pilha geral, jogador só as próprias); item
  com "esfera de 6 m" no editor mostra "Forma" pré-selecionada, card no chat mostra "Esfera 6 m" e o
  botão "Colocar área"; item com área "especial" não mostra o botão; recarregar (F5) preserva os
  gabaritos do mapa ativo.
