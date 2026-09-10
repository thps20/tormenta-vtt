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

## SPEC (`docs/SPEC.md`)

Nova seção **§9.9 Gabaritos de área de efeito (templates)**, no mesmo estilo de §9.3 (Névoa):
modelo (`SystemDefinition.templates`, `Template` discriminado por forma), eventos
(`template:upsert`/`upserted`, `template:remove`/`removed`), regra de broadcast por mapa ativo,
permissão (dono/GM, jogador só no mapa ativo), ferramenta na barra (atalho T, sub-modos, campo de
tamanho, presets), botão "Colocar área" no card de item, e as limitações conhecidas (sem automação
de regra, `angle`/`width` fixos por sistema, cap de 200 gabaritos por mapa, não entra no undo).
Soma também uma linha na tabela de eventos (§5) e, quando a feature estiver pronta, uma linha em
"Estado da implementação" (§8).

## Arquivos principais

- `packages/shared/src/schemas/system.ts`, `packages/shared/systems/tormenta20.json`
- `packages/shared/src/schemas/payloads.ts` (ou um `schemas/template.ts` novo, seguindo o padrão de
  `schemas/fog.ts`)
- `packages/shared/src/rules/templates.ts` + `templates.test.ts`
- `packages/shared/src/events.ts`
- `apps/server/src/services/templates.ts`, `apps/server/src/socket/templates.ts`
- `apps/server/src/services/snapshot.ts`, `apps/server/src/socket/scene.ts` (incluir `templates`)
- `apps/web/src/store/templates.ts`, `apps/web/src/store/tools.ts`
- `apps/web/src/components/TemplateToolbar.tsx`, `apps/web/src/components/TemplateLayer.tsx`
- `apps/web/src/components/Toolbar.tsx`, `VttCanvas.tsx`, `useToolShortcuts.ts`
- `apps/web/src/components/chat/ItemCardMessage.tsx`
- `apps/web/src/lib/templates.ts` (ponte pixel/grid com as regras puras de `shared`)
- `docs/SPEC.md`

## Verificação

- `make typecheck && make test` (novo `templates.test.ts` cobre `tokensInTemplate`,
  `pointInTemplate`, `parseAreaText`; `systems.test.ts` continua validando o `tormenta20.json` com
  o bloco novo).
- Manual com `make dev`: GM cria círculo/cone/linha/quadrado pela barra (T), confere ângulo do cone
  e largura da linha batendo com o metro do sistema, gira/move/apaga; jogador só mexe no mapa ativo
  e só no próprio; recarregar a página (F5) mantém os gabaritos do mapa (via snapshot); trocar de
  mapa não mostra os do outro; botão "Colocar área" de uma magia com "esfera de 6 m" abre a
  ferramenta já com círculo 6 m.
