# Plano: fundação do grid (Token.cells + calibração pela imagem)

Pedido original (resumido):

> **A)** `Token.cells` (lado em células) vira a fonte da verdade do tamanho; `width/height` deixam de
> ser persistidos e passam a ser derivados de `cells × cellSize` do mapa. Migration com backfill.
> **B)** No modal "Configurar mapa", botão **"Calibrar pela imagem"**: arrastar um retângulo sobre
> uma (ou N) célula(s) do desenho e o app calcula `cellSize` + `offset`, com prévia ao vivo e ajuste
> fino por setas.

Status: **aguardando aprovação**. Nada implementado ainda.

---

## 1. Por que (contexto)

Hoje `Token.width/height` são **pixels fixos** gravados no banco. Toda vez que o token muda de grid
— levar pra outro mapa (`scene:activate`/`scene:delete`), editar o `cellSize` do mapa atual
(`scene:updateGrid`) — alguém precisa lembrar de converter os pixels (`convertSizeToCellSize`) e
gravar de novo. Já esquecemos uma vez (corrigido em 09/09/2026, `docs/plano-mapas.md`): os dois
handlers moviam o token sem tocar no tamanho, e ele ficava menor/maior que a célula do destino.

Com `cells` como fonte, **não existe mais conversão**: os pixels são sempre `cells × cellSize do
grid atual`, calculados na hora em quem precisa (canvas, espiral de posicionamento, névoa). É
impossível gravar errado, porque não se grava pixel nenhum. Isso é o que destrava a Parte B:
recalibrar o grid de um mapa passa a ser uma operação **segura** (muda o desenho do grid e reencaixa
posições; nunca mexe no tamanho relativo dos tokens).

O item correspondente do `docs/backlog.md` sai no mesmo commit.

## 2. Decisões (e o porquê de cada uma)

**D1 — `cells` é inteiro ≥ 1; token não quadrado não existe.** Um token ocupa um quadrado de
`cells × cells` células. Hoje as alças do Konva já deixam esticar pra qualquer pixel (e em teoria
largura ≠ altura), mas nada no jogo usa isso: `cellRect`, `findFreeCells`, `tokensInTemplate` e o
spawn de criaturas já tratam tudo como "lado em células" (`Math.round(width / cellSize)`). Trocar o
modelo por um inteiro é assumir o que o código já fazia. Preço: perde-se o redimensionamento livre
(o Transformer passa a andar de célula em célula). Ganho: some uma classe inteira de bug.

**D2 — os pixels são derivados nos dois lados, a partir da MESMA função pura do `shared`.** Regra
da casa: cliente e servidor nunca podem discordar de geometria (é o mesmo motivo de
`DEFAULT_MAP_SIZE` e de `findFreeCells` rodarem nos dois). A função é
`tokenPixelSize(cells, cellSizePx)`; o `cellSizePx` vem de `effectiveCellSize(grid)`, que já existe
nos dois lados e já devolve **70 px pro grid `"none"`** (célula virtual).

**D3 — `width`/`height` somem do `Token` que trafega no socket.** Alternativa considerada: manter
os dois no `Token` serializado, só que calculados no `toToken`. Rejeitada porque `toToken(row)` é
chamado em 26 lugares que nem sempre têm a cena carregada — passaria a exigir o `cellSize` em todos,
e um esquecimento voltaria a gravar/emitir pixel errado (exatamente o bug que o plano quer matar).
Com o campo fora do tipo, o TypeScript aponta todo lugar que precisa derivar. O custo real disso
está no §3.4 (névoa).

**D4 — compatibilidade `width/height` na entrada: NÃO vale a pena (recomendação).** O pedido previa
um `preprocess` no `TokenSchema` aceitando `width/height` durante a transição. O problema: converter
pixel → célula **depende do `cellSize` do mapa**, que o `TokenSchema` não conhece (ele valida um
token solto, sem a cena). Então esse preprocess não tem como existir de forma honesta dentro do
schema. Os dois únicos lugares onde dado antigo pode aparecer são (a) as linhas do banco — resolvido
pela migration, que faz o JOIN com `Scene` e sabe o `cellSize`; e (b) um cliente antigo em outra aba
— que não existe (não há build publicado; o `make dev` recarrega todo mundo). **Recomendo o corte
limpo**: o schema só conhece `cells`. Se você preferir o cinto e o suspensório, dá pra aceitar um
`width` opcional em `token:create` e converter **no handler** (que tem a cena em mãos) — 5 linhas,
removidas depois. Diga qual você quer.

**D5 — `x`/`y` continuam em pixels do mapa.** Não muda nesta rodada (o SPEC já decide isso pra
suportar grid `"none"` e token "fora do grid"). O que muda: todo lugar que **grava** posição de token
por conta própria (spawn, ponto de chegada, resize, reencaixe de grid) sempre alinha ao canto da
célula — como já faz hoje. O arraste livre continua obedecendo o `grid.snap` do mapa. Vou deixar
escrito no SPEC que uma etapa futura pode mover `x/y` pra células também.

**D6 — `cellSize`/`offsetX`/`offsetY` passam a aceitar decimal.** Hoje são `z.number().int()`. A
Parte B pede ajuste fino de ±0,1 px, e uma calibração honesta quase nunca dá inteiro (um mapa de
2048 px com 28 células dá 73,14). Passam a ser `z.number()` com 1 casa decimal (arredondo no
"Aplicar"). Inteiro continua válido, então nenhum dado existente quebra, e `grid` é `Json` no banco
— **sem migration pra isso**.

## 3. Parte A — `Token.cells` como fonte da verdade

### 3.1 `packages/shared` (começa aqui, como manda o CLAUDE.md)

`src/schemas/token.ts`
- `width` / `height` saem. Entra:
  `cells: z.number().int().min(1).max(20).default(1)` — "lado do token em células".
  O teto de 20 é só sanidade (um token colossal em T20 é 6); hoje o limite equivalente é o clamp de
  8 px do Transformer.
- `TokenCreateSchema` / `TokenPatchSchema` herdam automático (são `.omit`/`.partial` do mesmo
  objeto), então `token:update { id, cells }` já é o evento de redimensionar — **nenhum evento novo
  em `events.ts`**, só o comentário de `token:update` ("arrastar/redimensionar") que cita
  `width/height` e passa a citar `cells`.

`src/rules/placement.ts`
- Entra `tokenPixelSize(cells: number, cellSizePx: number): { width: number; height: number }` —
  `{ width: cells * cellSizePx, height: cells * cellSizePx }`.
- Entra `cellsFromPixels(px: number, cellSizePx: number): number` —
  `Math.max(1, Math.round(px / cellSizePx))`. É a MESMA conta que hoje está copiada em 5 lugares
  (`cellRect` do web, `cellRect` do server, `convertSizeToCellSize`, `placeTokensAtArrival`,
  `tokenCellCenters`). Usada pelo backfill (espelhando o SQL), pelo resize e pelo seed.
- **Sai `convertSizeToCellSize`** (e os 6 testes dela): com `cells` persistido, não existe mais
  "converter tamanho entre grids" — é o principal sintoma do bug que o plano elimina.
- `CellRect` e `findFreeCells` ficam como estão (já trabalham em células).

`src/fog/visibility.ts`
- `tokenCenter(t)` hoje é `{ x: t.x + t.width/2, ... }`. Passa a
  `tokenCenter(t: { x; y; cells }, cellSizePx)`. É o ponto de entrada do efeito colateral do §3.4.

`src/rules/templates.ts` e `src/rules/targets.ts` continuam recebendo `{ x, y, width, height }` em
pixels e **não mudam**: quem chama já vai ter o retângulo derivado em mãos. São funções de
geometria pura; não têm por que aprender o que é uma célula.

### 3.2 Migration + backfill

`apps/server/prisma/schema.prisma`: `width Float` / `height Float` → `cells Int @default(1)`.

Gerada com `--create-only` (o SQL do Prisma só faria `DROP COLUMN`, e aí o dado já teria ido embora):

```bash
pnpm --filter @tormenta-vtt/server exec prisma migrate dev --create-only --name token_cells
```

Depois edito o `migration.sql` pra ficar nesta ordem — adicionar, **backfillar**, só então apagar:

```sql
ALTER TABLE "Token" ADD COLUMN "cells" INTEGER NOT NULL DEFAULT 1;

-- Registra os tokens não quadrados antes de arredondar (D1): aparece no log do migrate.
DO $$
DECLARE n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM "Token" WHERE "width" <> "height";
  IF n > 0 THEN RAISE NOTICE 'Token.cells: % token(s) não quadrado(s) arredondado(s) pela largura', n; END IF;
END $$;

-- cells = round(width / cellSize da cena), mínimo 1. Grid "none" usa a célula virtual de 70 px,
-- a mesma convenção de effectiveCellSize() nos dois apps.
UPDATE "Token" t
SET "cells" = GREATEST(1, ROUND(CAST(t."width" / c.cell AS numeric))::int)
FROM (
  SELECT s.id,
         CASE WHEN COALESCE(s."grid"->>'type', 'square') = 'square'
              THEN COALESCE(NULLIF(CAST(s."grid"->>'cellSize' AS numeric), 0), 70)
              ELSE 70 END AS cell
  FROM "Scene" s
) c
WHERE t."sceneId" = c.id;

ALTER TABLE "Token" DROP COLUMN "width";
ALTER TABLE "Token" DROP COLUMN "height";
```

Conferência depois de aplicar (roda na sala de teste, antes de commitar):
`SELECT cells, count(*) FROM "Token" GROUP BY 1 ORDER BY 1;` — esperado: quase tudo `1`, o ogro do
seed em `2`, nada em `0` (impossível pelo `GREATEST`) nem absurdamente alto.

### 3.3 `apps/server` — onde `cells` entra no lugar dos pixels

| Arquivo | Mudança |
|---|---|
| `services/serialize.ts` | `toToken`: `cells: t.cells` no lugar de `width`/`height`. |
| `services/grid.ts` | `cellRect(token, grid)` usa `token.cells` direto (some o `round`). `resnapToken` vira **`resnapTokenPosition`**: só reencaixa `x/y` na mesma célula; a parte de tamanho deixa de existir. |
| `services/permissions.ts` | `PLAYER_EDITABLE`: `"width", "height"` → `"cells"`. |
| `services/history.ts` | `TRACKABLE_TOKEN_FIELDS`: idem. `describeTokenChange`: `set.has("cells")` → "redimensionar". |
| `socket/compendium.ts` | `token.create` grava `cells: cellsPerSide` (some o `× cellSize`). |
| `socket/encounter.ts` | idem, com `placement.cellsPerSide`. |
| `socket/spawnHistory.ts` | o `apply()` (redo de spawn) recria com `cells: token.cells`. |
| `socket/scene.ts` | `placeTokensAtArrival` perde o parâmetro `originCellSize` e a conversão inteira: lê `row.cells`, roda a espiral, devolve **só `{x, y}`**. `SceneDeleteMove.before/after` e `GridTokenMove.before/after` perdem `width/height`. `scene:updateGrid` chama `resnapTokenPosition`. |
| `scripts/seed-test.ts` | tokens com `cells: 1` (e o ogro com `cells: ogroCells`). |

Efeito colateral bom: os comentários grandes de `scene.ts` e `grid.ts` que explicavam a conversão de
tamanho somem junto — menos coisa pra alguém manter certa no futuro.

### 3.4 `apps/server` — a névoa precisa saber do grid (o custo real da D3)

`isPointRevealed(fog, tokenCenter(token))` decide se um jogador enxerga um token. Com `cells`, o
centro depende do `cellSize` do mapa. Hoje a assinatura dessas funções carrega só `fog: FogConfig`:

- `services/visibility.ts`: `tokenVisibleTo`, `tokenHiddenFrom`, `emitTokenToPlayers`
- `socket/token.ts`: `broadcastToken`
- `services/combat.ts`: `maybeReemitCombatForToken`
- ~30 chamadas espalhadas por `token.ts`, `scene.ts`, `fog.ts`, `compendium.ts`, `encounter.ts`,
  `spawnHistory.ts`, `character.ts`, `targets.ts`, `chatVisibility.ts`

Em vez de acrescentar um segundo parâmetro `cellSizePx` em toda essa cadeia (fácil de passar errado),
troco o parâmetro `fog: FogConfig` por **`geom: SceneGeometry = { fog: FogConfig; cellSizePx: number }`**,
com um helper `sceneGeometry(scene: Scene)` em `services/grid.ts`. Praticamente todas as chamadas
hoje são `..., toScene(sceneRow).fog)` e viram `..., sceneGeometry(toScene(sceneRow)))` — mecânico,
uma linha cada, e o compilador acha todas. É a maior parte do diff da Parte A; sem novidade
conceitual.

### 3.5 `apps/web` — derivar os pixels uma vez, no topo

Truque pra não espalhar `cells × cellSize` por 20 componentes: derivo **uma vez** e passo adiante um
"token com tamanho".

`src/lib/grid.ts`
- `export type SizedToken = Token & { width: number; height: number }`
- `export function sizeTokens(tokens: Token[], grid: GridConfig): SizedToken[]` (usa
  `tokenPixelSize` do shared).
- `cellRect(token, grid)` passa a ler `token.cells`.
- `clampToMap`, `tokensInBox`, `gridLines` continuam iguais (recebem números).

`src/components/VttCanvas.tsx`
- Um `useMemo` no topo transforma `tokens` em `SizedToken[]`; **todo o resto do arquivo continua
  lendo `token.width`** (render do Konva, `tokenRadius`, `conditionLayout`, barra de PV, marcadores
  de condição, `tokensInTemplate`, caixa de seleção). Diff pequeno pro tamanho do arquivo.
- **Transformer (redimensionar) passa a andar de célula em célula**:
  - `boundBoxFunc`: arredonda a caixa pro múltiplo de `cellSize` mais próximo **durante** o arrasto,
    então a alça "pula" de célula em célula e o GM vê exatamente o que vai ficar (hoje o snap só
    acontece ao soltar, e só se `snap` estiver ligado);
  - `onTransformEnd`: `cells = cellsFromPixels(width, cellSize)`, posição alinhada ao canto,
    `onTokenPatch({ id, cells, x, y })` — sem `width/height`;
  - vale também com grid `"none"` (célula virtual de 70 px) e com o `snap` do mapa desligado: o
    **tamanho** é sempre inteiro em células, o **snap** continua sendo só sobre a posição.
- `handleCreateToken`: chama `onTokenCreate(pos)` (o parâmetro `size` some).
- `creatureGhost` e `findFreeSpot` já trabalham em células — não mudam.

Outros arquivos do web:
- `RoomPage.tsx`: `createToken({ ..., cells: 1 })`; `targetsFromTemplate`/`tokenCenter` passam a
  receber os tokens já dimensionados (`sizeTokens`) / o `cellSizePx`.
- `TokenInspector.tsx`: a linha de geometria mostra `1×1 células (70×70 px)` em vez de `70×70`.
  (Um seletor de tamanho em células no Inspector seria útil, mas é escopo novo — fica de fora.)
- `lib/useTokenMoveShortcuts.ts`: o `clampToMap` do movimento por teclado usa o tamanho derivado.
- `store/tokens.ts`: **nada** — `applyPatchLocally`/`revertTarget` são genéricos sobre o patch.

## 4. Parte B — calibrar o grid pela imagem

### 4.1 Onde fica

No `MapConfigModal`, ao lado do campo "Tamanho da célula", um botão **"Calibrar pela imagem"**
(ícone `Crosshair`). Desabilitado sem imagem (`mapUrl === null`) — não há o que calibrar num
retângulo vazio. Se o grid estiver em `"none"`, calibrar liga o modo `square` automaticamente (é
óbvio o que a pessoa quis).

Abre um overlay em cima do modal (componente novo `src/components/GridCalibrator.tsx`), porque a
prévia de 560 px do modal é pequena demais pra mirar uma célula.

### 4.2 A tela

Um `<canvas>` só (sem Konva — é um desenho, não uma cena com objetos), que desenha nesta ordem:
imagem → grid de prévia (valores atuais) → retângulo sendo arrastado.

- **Zoom livre**: roda do mouse com foco no ponteiro (mesma conta do `handleWheel` do `VttCanvas`);
  arrastar com o botão do meio (ou segurando espaço) faz pan. Botão "Ajustar" volta pro 100%.
- **Arrastar pra calibrar** (botão esquerdo): o retângulo é **forçado a quadrado**
  (`lado = max(|dx|, |dy|)`, seguindo o sentido do arrasto), porque a célula do modelo é quadrada —
  deixar arrastar um retângulo qualquer só criaria a dúvida de qual lado manda.
- **"Cobre N células"**: um `<input type="number">` (1–20, padrão 1). Arrastar sobre 10 células e
  informar 10 divide o erro de mira por 10 — é o jeito preciso, e fica dito na UI
  ("dica: arraste sobre várias células pra ganhar precisão").
- **Prévia ao vivo**: assim que solta o arrasto, o grid inteiro é redesenhado com os valores novos
  sobre a imagem; a divergência aparece na hora nas bordas do mapa (é lá que 0,2 px de erro por
  célula vira 6 px de erro visível).
- **Ajuste fino** (com o canvas focado): setas = `offsetX/offsetY` ±1 px; **Shift+setas** = ±0,1 px;
  `+`/`-` = `cellSize` ±1 px, com Shift ±0,1. Os mesmos três valores também aparecem como campos
  numéricos (`step` 0,1) acima do canvas — teclado é pra quem já sabe, campo é pra descobrir.
- **Rodapé**: "Aplicar" e "Cancelar". "Aplicar" só escreve `cellSize`/`offsetX`/`offsetY` no estado
  do `MapConfigModal` e fecha o overlay — **quem salva de verdade continua sendo o "Salvar" do
  modal** (que emite `scene:updateGrid`). Assim dá pra calibrar, olhar a prévia pequena, recalibrar,
  e só então commitar; e "Cancelar" no modal descarta tudo, como já descarta hoje.

### 4.3 A conta (pura, testável)

Arquivo novo `src/lib/gridCalibration.ts` — sem React, sem canvas, só números (mesmo espírito de
`lib/grid.ts`):

```ts
/** Retângulo arrastado (em pixels do MAPA) + quantas células ele cobre -> grid calibrado. */
export function calibrateFromRect(
  rect: { x: number; y: number; side: number },
  cellsCovered: number,
): { cellSize: number; offsetX: number; offsetY: number };
```

- `cellSize = round1(rect.side / cellsCovered)`, grudado em `[8, 1000]` (o mesmo limite do schema);
- `offsetX = round1(((rect.x % cellSize) + cellSize) % cellSize)` (reaproveita a ideia de
  `normalizeOffset`, que já garante `[0, cellSize)`), idem `offsetY`;
- `round1 = (v) => Math.round(v * 10) / 10` — a precisão que a D6 abre.

A conversão "pixel do canvas → pixel do mapa" fica no componente:
`mapX = (canvasX - panX) / zoom * (mapWidth / img.naturalWidth)`. Na prática o fator é 1 (o
`mapWidth` vem do próprio upload), mas deixo explícito pra não depender disso.

### 4.4 O que a calibração NÃO faz

- **Não detecta o grid desenhado na imagem** (decisão do pedido). Só calibração manual.
- **Não mexe no tamanho dos tokens.** É a consequência direta da Parte A: `cells` é a fonte, então
  recalibrar redesenha o grid, reencaixa as **posições** (`scene:updateGrid` → `resnapTokenPosition`,
  mantendo cada token na mesma coluna/linha) e pronto. Antes da Parte A isso teria redimensionado
  todo mundo em pixels — mais um motivo pra ordem A→B.
- `GridConfigSchema`: `cellSize: z.number().min(8).max(1000)` e `offsetX/Y: z.number()` (sem
  `.int()`). O `handleSave` do modal arredonda pra 1 casa em vez de `Math.round`.

## 5. Testes

**`packages/shared`** (`src/rules/placement.test.ts`)
- `tokenPixelSize`: `(1, 70) → 70×70`; `(2, 100) → 200×200`; `(3, 70) → 210×210`.
- `cellsFromPixels` (a conta do backfill e do resize): `140/70 → 2`; `100/70 → 1`; `10/70 → 1`
  (mínimo 1, nunca 0); `145/70 → 2` (quase-2 continua 2 — é o caso do token esticado à mão hoje);
  `70/70 → 1`.
- Ida e volta: `cellsFromPixels(tokenPixelSize(n, c).width, c) === n` pra vários `n`/`c`.
- Os 6 testes de `convertSizeToCellSize` saem junto com a função.

**`apps/server`**
- `services/grid.test.ts`: `cellRect` lendo `cells`; `resnapTokenPosition` (troca de `cellSize`, só
  offset, `none` ↔ `square`, "nada mudou devolve a mesma referência") — os casos de tamanho somem.
- `socket/scene.test.ts`: fixtures de `SceneDeleteMove` sem `width/height`.
- `services/chatVisibility.test.ts`: fixture de token com `cells: 1`.
- Backfill: o SQL não roda no vitest; o que garanto é (a) a fórmula gêmea testada em
  `cellsFromPixels` e (b) a conferência manual do §3.2 na sala de teste (`make db-reset` + seed +
  migrate).

**`apps/web`**
- `lib/grid.test.ts`: `cellRect` com `cells`; `sizeTokens` com grid `square` e com `"none"` (70 px).
- `lib/gridCalibration.test.ts` (novo): 1 célula exata (`side 70, n 1 → 70`); N células
  (`side 731, n 10 → 73,1`); offset negativo/maior que a célula normalizado pra `[0, cellSize)`;
  clamp em 8 e 1000; arredondamento pra 1 casa.

`make typecheck && make test` verdes antes de cada commit (o `typecheck` é quem vai listar, de
graça, todo lugar que ainda lê `token.width`).

## 6. Docs a atualizar

- **`docs/SPEC.md`**: §3.3 (criar token "com `width = height = cellSize`" → "com `cells: 1`";
  redimensionar "emite `token:update {id, width, height}`" → `{id, cells}`, em células inteiras);
  §3.4 (campos editáveis pelo jogador: `cells` no lugar de `width/height`); §4 tabela **Token**
  (campos + a explicação de `cells`); §4 nota de "coordenadas em pixels" (acrescenta: *tamanho* em
  células, *posição* em pixels, e que uma etapa futura pode mover a posição pra células); §9.7
  (linhas 587–609 e 630–634: some a conversão de tamanho entre grids, fica só o reencaixe de
  posição); §3.2 (o botão "Calibrar pela imagem", Parte B).
- **`docs/backlog.md`**: remover o item "Tamanho de token em células (`Token.cells`)…" (linhas
  75–89) — é exatamente isto.
- **`docs/plano-mapas.md`**: as passagens sobre `convertSizeToCellSize` ficam desatualizadas. Planos
  antigos são registro histórico (não reescrevo), mas acrescento uma linha no topo apontando pra cá.

## 7. Ordem dos commits

1. **"Usa Token.cells como fonte da verdade do tamanho do token"** — Parte A inteira (shared +
   migration + server + web) num commit só, porque `packages/shared` é consumido como fonte TS:
   mudar só o shared deixa o repo sem compilar. Inclui SPEC + backlog (a casa pede SPEC no mesmo
   commit da mudança de comportamento).
2. **"Aceita grid com tamanho e deslocamento decimais"** — D6: `GridConfigSchema` + o arredondamento
   do modal. Pequeno e independente.
3. **"Adiciona calibração do grid pela imagem"** — Parte B: `gridCalibration.ts` + testes +
   `GridCalibrator.tsx` + botão no modal + SPEC §3.2.

Atenção prática: a árvore hoje tem bastante coisa **não commitada** (visão de grupo / party). Vou
adicionar ao commit só os arquivos desta mudança, não `git add -A`.

## 8. Riscos e limites

- **Redimensionamento livre acaba.** Quem tivesse esticado um token pra 1,5 célula vai vê-lo virar
  1 ou 2 (a migration arredonda). É a D1; se você usa isso na mesa, me diga antes que eu reveja.
- **`tokenCells` fracionário do sistema** (`minusculo: 0.5` no `tormenta20.json`) continua sendo
  arredondado pra 1 célula — igual a hoje (`Math.max(1, Math.round(...))`). Suportar "meio token"
  de verdade exigiria `cells` fracionário e mudaria a espiral de posicionamento: fora deste plano.
- **O diff da névoa (§3.4) é grande e chato** (~30 chamadas), ainda que mecânico. É o preço da D3.
  Se preferir um plano menor agora, a alternativa é manter `width/height` no `Token` serializado
  (derivados no `toToken`) — mas aí `toToken` passa a exigir a cena em 26 lugares e o risco de
  emitir pixel errado volta pela porta dos fundos. Recomendo pagar o preço uma vez.
- **`scene:updateGrid` com `cellSize` muito diferente ainda "espalha" os tokens**: manter a mesma
  coluna/linha com uma célula 3× maior joga o token longe em pixels. É o comportamento de hoje e não
  mudo nesta rodada — calibrar costuma mexer poucos px, não triplicar a célula.
