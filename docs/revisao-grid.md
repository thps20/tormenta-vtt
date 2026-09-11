# Revisão pós-implementação: fundação do grid (Token.cells + calibração)

> Revisão do que foi implementado a partir de `docs/plano-grid.md` (aprovado com as duas decisões
> em aberto resolvidas pelo dono do projeto: D4 corte limpo, sem compat de `width/height`; D1
> `cells` inteiro, sem uso de redimensionamento livre hoje). Escrita em 11/09/2026, logo depois da
> implementação, só por leitura/rastreamento de código (sem teste manual guiado via CDP desta vez).
> `make typecheck` e `make test` passam nos três pacotes depois de cada um dos três commits.

## 1. Implementação vs. plano

Seguiu o desenho do plano de ponta a ponta: `Token.cells` (inteiro ≥ 1) substitui `width`/`height`
no schema, no Prisma e no banco; `tokenPixelSize`/`cellsFromPixels` (shared) são a única conta de
célula↔pixel de tamanho; `resnapTokenPosition` (server) reencaixa só posição, nunca tamanho;
`SceneGeometry { fog, cellSizePx }` substitui o parâmetro `fog` solto em toda a cadeia de
visibilidade; `SizedToken` (web) deriva `width`/`height` uma vez no topo do `VttCanvas`; a
calibração pela imagem (`GridCalibrator.tsx`) usa a mesma função pura testada
(`calibrateFromRect`) que o componente só invoca depois de resolver pixel de tela → pixel do mapa.

Divergências do texto do plano, todas mecânicas/de execução, não de desenho:

- **A migration não saiu de `prisma migrate dev --create-only`** como o plano descrevia — o
  comando recusa rodar em ambiente não-interativo (`Prisma Migrate has detected that the
  environment is non-interactive`). Usei `prisma migrate diff --from-schema-datamodel
  --to-schema-datamodel --script` (não precisa de banco, só compara os dois `schema.prisma`) pra
  gerar o SQL bruto, criei a pasta da migration à mão com o nome/timestamp no padrão das outras, e
  apliquei com `prisma migrate deploy` (não-interativo). O SQL final é exatamente o que o plano
  pedia (`ADD COLUMN` → backfill → `DROP COLUMN`, nessa ordem); só o comando que gerou o esqueleto
  mudou.
- **O commit da Parte A não foi dividido em shared/server/web** como uma leitura apressada do §3
  do plano poderia sugerir — o próprio §7 ("Ordem dos commits") já previa isso: "Parte A inteira
  … num commit só, porque `packages/shared` é consumido como fonte TS: mudar só o shared deixa o
  repo sem compilar." Segui essa instrução à risca.
- **A árvore de trabalho tinha duas features pendentes e não-commitadas** (decomposição
  bruto/ajuste de dano e rolagem automática de iniciativa de NPCs, de uma sessão anterior) que
  tocam alguns dos MESMOS arquivos do plano do grid (`socket/token.ts`, `services/snapshot.ts`,
  `RoomPage.tsx`, `docs/SPEC.md`, `docs/backlog.md`). Isso não está no plano (que não previa
  outras features em andamento) — separei cada um desses 5 arquivos linha a linha (reconstruindo
  "HEAD + só as linhas do grid" e comparando com `diff` antes de cada commit) pra não misturar as
  três features na história. Consequência prática: esses 5 arquivos ainda aparecem como
  modificados no `git status` depois dos três commits do grid — é o esperado, é a **outra** feature
  esperando a vez dela, não sobra do grid.
- **`Token.cells` no `TokenSchema` não tem nenhum `z.preprocess` de compatibilidade** (D4,
  confirmada pelo dono do projeto): corte limpo. Não há como ter ficado pela metade — o
  TypeScript acusaria qualquer lugar que ainda tentasse ler `token.width`.

## 2. Casos de borda pedidos explicitamente

- **Token 2×2 na borda do mapa depois de recalibrar.** ~~`scene:updateGrid` (server) reencaixava a
  POSIÇÃO de cada token com `resnapTokenPosition` sem grudar no limite do mapa~~ — **corrigido**
  (11/09/2026, a pedido do dono do projeto, depois desta revisão): `resnapTokenPosition` agora
  recebe `map: {width, height}` e gruda o canto reencaixado dentro dele com o mesmo `clampToMap`
  que `findFreeCells`/o botão de novo token já usam (`side = cells × cellSize do grid NOVO`, então
  um token 2×2 gruda pelo próprio lado de 2 células, não só 1). Testado em `grid.test.ts`
  (`apps/server`): token 1×1 e 2×2 na borda, calibração que empurraria pra fora fica grudada no
  maior x/y que ainda cabe no mapa; token já dentro do mapa continua devolvendo a MESMA referência
  (sem custo extra quando o clamp não muda nada). Ver SPEC §9.7.
- **Calibrar com grid "none" e tokens no mapa.** Funciona pelo mesmo caminho de qualquer troca de
  tipo de grid: o botão "Calibrar pela imagem" já troca `gridType` pra `"square"` no estado local do
  modal (decisão do plano — "recalibrar nunca faz sentido continuar sem grid"), mas **nada é
  emitido ainda** nesse clique; só quando o Mestre clica "Salvar" no modal é que `scene:updateGrid`
  roda de verdade. Nesse momento, `resnapTokenPosition` trata `fromGrid: {type:"none"}` exatamente
  como qualquer outro grid (`cellAt`/`cellToPoint` já usam a célula virtual de 70px pro tipo
  `"none"`, sem código especial) — os tokens são reencaixados da grade virtual de 70px pra célula
  calibrada de verdade. `cells` (tamanho) não muda em nenhum momento desse fluxo. Testado só por
  leitura, com confiança alta: é o mesmo código que já cobre "grid `none` ↔ `square`" no
  `grid.test.ts` do servidor (`resnapTokenPosition`), só que chegando por um caminho de UI novo.
- **Desfazer um resize (Ctrl+Z).** `cells` está em `TRACKABLE_TOKEN_FIELDS`
  (`services/history.ts`), no lugar de `width`/`height`; `pickTrackableTokenPatch` grava
  `{ before: { cells: N }, after: { cells: M } }` no mesmo diff de sempre, e
  `writeTrackablePatch` (usado por `revert`/`apply` da entrada de histórico) escreve esse patch
  direto no Prisma — `cells` é uma coluna `Int` normal, sem nada de especial a preservar. O
  Transformer redimensiona sempre em célula inteira agora (D1), então não existe mais "desfazer um
  resize pra um valor não-inteiro" — o antes/depois do undo é sempre um par de inteiros exatos.
  `describeTokenChange` continua dizendo "redimensionar" pro toast (só trocou `width`/`height` por
  `cells` na checagem). Nenhuma mudança de comportamento visível pro Mestre: Ctrl+Z de um resize
  continua funcionando exatamente como antes.
- **Levar um token 2×2 pra um mapa de célula 100.** `scene:activate`/`scene:delete` (`server`) só
  reposicionam: `placeTokensAtArrival` recebe `Pick<DbToken, "id"|"cells">[]` e roda `findFreeCells`
  com `cells: row.cells` (2) direto no grid de DESTINO — sem nenhuma conversão. O `token.update`
  final grava só `{ sceneId, x, y }`; `cells` nunca é tocado. Resultado: o token continua 2×2 EM
  CÉLULAS no mapa novo (era o requisito do plano — "recalibrar/trocar de mapa nunca muda o tamanho
  relativo"), e em pixels ele passa de 140×140 (grid antigo, célula 70) pra 200×200 (grid novo,
  célula 100) — maior em pixels, mesmo tamanho em células. É exatamente o comportamento que elimina
  a classe de bug que motivou o plano (o token não fica mais pequeno/grande DEMAIS pro grid novo,
  porque não há mais conversão nenhuma pra escorregar).
- **Gabarito de círculo com token 2×2 parcialmente dentro — contagem de alvos igual à de antes.**
  `tokensInTemplate`/`targetsFromTemplate` (shared, `rules/templates.ts`/`rules/targets.ts`) não
  mudaram: continuam recebendo `{x, y, width, height}` e subdividindo o token em `cols × rows`
  centros de célula (`cols = round(width / cellSizePx)`). Como `SizedToken.width` agora é sempre
  `cells * cellSizePx` calculado com o MESMO `cellSizePx` que `VttCanvas`/`RoomPage` passam pra
  essas funções (`effectiveCellSize(scene.grid)` nos dois lados), `width / cellSizePx` dá `cells`
  exato, sem arredondamento de fronteira — a contagem de quantas células o token ocupa, e portanto
  quantos "centros" testar contra o círculo, é bit-a-bit a mesma de antes da migration. Verificado
  por leitura das duas funções e dos pontos de chamada (`RoomPage.tsx` deriva `sizedTokens` com
  `sizeTokens(tokens, scene.grid)` antes de passar pra `targetsFromTemplate`); nenhum teste novo foi
  necessário porque a assinatura dessas funções shared não mudou — os testes existentes
  (`targets.test.ts`, `templates.test.ts`) continuam passando com fixtures que já usam
  `width`/`height` direto (são genéricas, não `Token` de verdade).
- **"Colocar área" de magia com cone antes e depois de recalibrar.** Gabaritos (`Template`) são
  efêmeros por design (SPEC §9.9: "se perdem num restart do servidor") e **nunca são reencaixados**
  por `scene:updateGrid` — só tokens passam por `resnapTokenPosition`; `services/templates.ts`
  nem é importado por `socket/scene.ts` no handler de `updateGrid`. Isso já era assim antes deste
  plano (gabaritos guardam geometria em pixels absolutos, sem referência a `cellSize` depois de
  criados) — recalibrar não é diferente de qualquer outra edição de grid nesse aspecto: um cone
  criado ANTES da calibração mantém o comprimento em pixels de antes, então se a calibração mudou o
  `cellSize` de forma significativa, o cone passa a cobrir um número de células diferente do que
  cobria quando foi desenhado (maior se o `cellSize` diminuiu, menor se aumentou) — mas nunca
  quebra, nunca desalinha visualmente do PRÓPRIO ponto de origem, só do grid ao redor dele. Um cone
  criado DEPOIS da calibração usa o `cellSize` já calibrado desde o início (`cellsFromSizeUnits`/
  `templateSizePx`, `apps/web/src/lib/templates.ts`, chamados com o `scene.grid` atual), então nasce
  correto. Não é um bug desta implementação — é a mesma limitação que já existia pra qualquer
  `scene:updateGrid`, só mais visível agora que calibrar é um fluxo dedicado e mais fácil de usar
  no meio de uma sessão já em andamento (com gabaritos might já estarem na mesa). Fica registrado
  aqui, não no backlog: corrigir exigiria dar a `Template` uma referência ao `cellSize` de criação e
  reescalar geometria em `scene:updateGrid`, mudança de escopo bem maior que "reencaixar posição de
  token" — decisão de se vale a pena é do dono do projeto.

## 3. Limitações conhecidas / fora do escopo (como já documentado no plano, reafirmando)

- **Redimensionamento livre não existe mais** (D1, confirmada): o Transformer sempre anda em célula
  inteira, com ou sem `snap` de posição ligado. Token que antes tinha sido esticado pra um tamanho
  não-múltiplo de célula foi arredondado pra baixo/cima pelo backfill da migration (25 tokens 1×1, 4
  2×2, 1 4×4 na sala de teste — nenhum "não quadrado" registrado no `RAISE NOTICE`).
- **Tokens de meia célula** (Minúsculo 0,5 em T20) continuam arredondando pra 1 célula cheia ao
  soltar do compêndio — anotado no backlog (`docs/backlog.md`), não corrigido: exigiria `cells`
  fracionário, fora do escopo deste plano.
- **Gabaritos não são reencaixados por `scene:updateGrid`/calibração** — ver §2 acima ("Colocar
  área"). Pré-existente (gabaritos são efêmeros e em pixels absolutos desde sempre), não corrigido.
- **Calibração é só manual** (decisão do plano, confirmada): nenhuma tentativa de detectar grid já
  desenhado na imagem.

## 4. Conclusão

Os três commits (`Token.cells` como fonte da verdade + migration/backfill/conferência,
`GridConfig` decimal, calibração pela imagem) implementam o plano sem desvio de desenho — só
ajustes mecânicos de execução (ferramenta de migration, escopo de commit único na Parte A, e a
separação linha a linha de arquivos compartilhados com features pendentes de outra sessão). Dos
seis casos de borda pedidos, cinco funcionam corretamente (grid "none" → calibrado, desfazer
resize, levar token 2×2 entre mapas, contagem de alvos em gabarito, e — depois do fix acima —
token na borda do mapa após recalibrar) e um expõe uma limitação real **pré-existente** ao plano
(gabaritos não acompanham mudança de grid, decisão de design de longa data — efêmeros, em pixels
absolutos) que a calibração pela imagem só torna mais provável de aparecer na prática — não quebra
o app, fica registrada acima para o dono do projeto decidir se vale um fix futuro.
