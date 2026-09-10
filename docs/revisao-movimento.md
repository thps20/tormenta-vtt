# Revisão: movimento por teclado e orçamento de deslocamento (docs/plano-movimento.md)

> Passada de revisão pedida ao terminar as 5 etapas do plano (+ o ajuste de `{race.movement}` antes
> da etapa 1 e o ajuste do GM com "ignorar limite"): implementação vs. plano, e os quatro casos de
> borda pedidos. Escrito em 10/09/2026, depois de `make typecheck && make test` passarem (17 + 8 +
> 4 suites, 308 + 78 + 56 testes) no monorepo inteiro. **Não inclui** teste manual em navegador —
> só verificação de código e automatizado até aqui.

## 1. Os dois ajustes pedidos antes de começar

- **`{race.movement}`** (antes da etapa 1): `derived.movement` do `tormenta20.json` trocou de uma
  constante `"9"` pra `"{race.movement}"`. Placeholder novo genérico (`SystemDefinition.race?: {
  kind }`, aponta o `itemKinds[]` cujos campos `number` alimentam `{race.<campo>}` — o código nunca
  sabe que a chave se chama "race", só que existe um bloco `race` no JSON, mesmo espírito de
  `level.classes`/`tokenBar`). Testado em `rules.test.ts` (Anão 6, Humano 9, sem raça → 9 do
  `default` do campo, override do GM → override) — os quatro casos pedidos.
- **GM com "ignorar limite" ligado não consome orçamento**: acabou não precisando de um `if`
  específico pro GM. `checkMovement` já libera **sem consumir pra QUALQUER UM** (GM incluso) assim
  que a trava da sala está desligada (`§2.2` do plano, passo 4) — então a garantia pedida já vale
  por construção, sem caso especial. Deixei um comentário em `services/movement.ts` citando o
  ajuste, pra quem ler o código não achar que foi esquecido.

## 2. Decisões D1–D7: status

Todas implementadas como descrito no plano, sem divergência:

- **D1** (sem duplicar `diagonals`/`unit`): `movement.diagonals?` é opcional, ausente = `grid.diagonals`.
- **D2** (âncora, não `dragFrom`): `Combatant.movementAnchorX/Y`, só o patch final (sem `live`)
  consome e avança a âncora; os ecos `live` são validados (podem ser recusados) mas nunca persistem.
- **D3** (fora do combate = livre): `checkMovement` libera assim que o token não tem `Combatant` no
  combate ativo da cena.
- **D4** (orçamento resolvido no início do turno, gravado): `startTurnMovement`, chamado de todo
  lugar que muda `activeCombatantId`.
- **D5** (caminho/gasto públicos pra quem vê o combatente): `movementBudget/Used/Diagonals` vão pra
  todo mundo que recebe aquele combatente na lista (a visibilidade em si é a mesma de sempre,
  `tokenVisibleTo`); `movementPath` só vem preenchido na entrada do combatente que É a vez — `[]`
  nos demais, mesmo pro GM (não é "esconder do jogador", é "só o ativo tem caminho pra mostrar").
- **D6** (segurar tecla = 1 movimento): `useTokenMoveShortcuts` confirma ao soltar ou 250 ms depois
  da última tecla — uma entrada de histórico por rajada.
- **D7** (desfazer não estorna): confirmado por leitura de código, sem mudança — `writeTrackablePatch`
  (`services/history.ts`, usado por Ctrl+Z) chama `prisma.token.update` direto, nunca passa por
  `checkMovement`/`commit()`. O botão de zerar gasto (`combat:set-movement { used: 0 }`) continua
  sendo o caminho pra corrigir à mão.

## 3. Casos de borda pedidos

### 3.1 Arrasto em grupo com o combatente da vez + um token fora do combate

**Verificado, comportamento correto por construção — sem bug, sem mudança.**

`handleTokenDragEnd` roda `clampToMovementBudget` (→ `movementBudgetFallback`, `store/combat.ts`)
**por token**, não uma vez pro grupo inteiro — o token líder e cada um dos `others` são checados
independentemente, na mesma função pura que o teclado usa. Pro token fora do combate,
`movementBudgetFallback` devolve `null` assim que não acha `Combatant` pra ele (mesmo D3 do
servidor) — segue com o destino normal, sem nenhum efeito colateral do vizinho de grupo estar
travado. Pro combatente da vez, se o deslocamento do GRUPO (mesmo delta pra todos) estourasse o
orçamento DELE, só a posição DELE vira a âncora — o outro token do grupo termina no lugar certo. No
servidor, `token:update-many` aplica cada patch por `applyTokenUpdate`/`checkMovement`
independentemente também (mesmo raciocínio) — os dois lados concordam.

Uma nuance que vale registrar (não é um bug introduzido por esta feature, é uma característica
pré-existente de `token:update-many`, ver §4 abaixo): a permissão (`canEditToken`) é conferida
tudo-ou-nada pra TODOS os patches antes de aplicar qualquer um, mas o orçamento de deslocamento (e
qualquer outra checagem de negócio, como condição inválida) é checado DENTRO do loop, patch a
patch. Como o cliente já pré-calcula a posição segura antes de mandar (via
`movementBudgetFallback`), na prática o servidor concordando com o cliente é o caminho comum; só
diverge numa corrida de verdade (outro evento mexeu no mesmo combatente entre o clamp do cliente e
o servidor processar) — nesse caso o comportamento já preexistente (patches anteriores do lote já
persistidos, o handler todo devolve erro) se aplica, sem ser específico de movimento.

### 3.2 Turno mudando no meio de um arraste (ou de uma rajada de teclado)

**Achado + corrigido.**

Os ecos "ao vivo" (`tokens.moveLive` → `token:update { live: true }`) são *fire-and-forget*
(`void emitAck(...)`, `store/tokens.ts#flushMoves`) — ninguém olha o `ack`. Se o turno mudar de mão
NO MEIO de um arraste (GM clica "Próximo", ou o combatente adia), o servidor passa a recusar os
ecos daquele token (`checkMovement`: "não é a vez dele" pro dono jogador) — mas o cliente que está
arrastando nunca fica sabendo, porque não olha o resultado do eco. A posição local (aplicada
otimisticamente por `moveLive`) continua "andando" na tela de quem arrasta, cada vez mais longe da
posição real que o servidor tem (que parou de aceitar atualizações).

Ao SOLTAR, o patch final (`tokens.ts#patch`) É checado com `ack`. Se também for recusado (o turno
ainda não é dele), o código ORIGINAL revertia pra `get().byId[patch.id]` — que, pelo motivo acima,
já não é mais a posição real do servidor, é a última posição otimista local (potencialmente bem
longe de onde o token realmente está pros outros participantes). O toast "Não é o seu turno"
aparecia, mas o token ficava visualmente "preso" numa posição fantasma só naquele cliente, até
algum outro evento reemitir o token de verdade.

**Correção**: `store/tokens.ts#revertTarget` — quando o patch recusado tem `dragFrom` (o ponto
confirmado pelo servidor ANTES do gesto começar, já mandado pelo arraste; agora também pela rajada
de teclado, que não mandava antes), reverte pra ele em vez do valor ambiente do store. `dragFrom`
nunca fica desatualizado pelos ecos `live` perdidos (foi capturado no início do gesto, uma vez só),
então reverter pra ele é sempre seguro. Patches sem `dragFrom` (edição avulsa, não um gesto)
continuam revertendo pro valor anterior, sem mudança de comportamento.

Isso **não interrompe** o gesto no meio (a tecla segurada continua "andando" localmente até soltar
ou o timeout de 250 ms) — só garante que, se o final for recusado, o snap-back é pro lugar certo.
Interromper no meio exigiria uma re-checagem de turno a cada passo (com toast a cada tecla), que
o plano não pedia e que achei desproporcional pro tamanho da janela de risco (alguém precisaria
clicar "Próximo" bem no meio do arraste/rajada de outra pessoa).

### 3.3 Combate iniciado com token já selecionado e teclado

**Verificado, comportamento correto por construção — sem bug, sem mudança.**

`useTokenMoveShortcuts` nunca guarda estado de combate/turno em variável de React (closure) — toda
decisão lê `useCombat.getState()`/`useRoom.getState()` NA HORA (zustand, fora do ciclo de render).
Então mesmo que o token já estivesse selecionado antes de `combat:start`, o próximo keydown (início
de uma rajada nova, `burstTokensRef.current` nulo) reavalia `canMoveNow` com o estado ATUAL —
inclusive se o combate acabou de começar, ou se acabou de virar a vez de outra pessoa. O
`draggable` do token no canvas (`VttCanvas`) segue o mesmo raciocínio: é uma prop calculada a cada
render a partir do `combat` que vem da store, então reage sozinha.

A única janela real é a mesma do caso 3.2: se uma rajada de teclado JÁ estava em andamento (tecla
segurada) e o combate muda de estado no meio dela, a rajada não aborta na hora (só é checada de
novo ao confirmar) — mas agora reverte pro lugar certo (`dragFrom`) se for recusada, coberto pela
correção acima.

### 3.4 Grid alterado no meio do turno

**Achado + corrigido.**

`scene:updateGrid` (GM muda `cellSize`/`offset`/tipo do grid) pode REENCAIXAR tokens da cena
(`services/grid.ts#resnapToken`) pra continuarem na mesma célula/tamanho relativo — e escreve a
posição nova direto (`prisma.token.update`), sem passar por `token:update`/`checkMovement`. Se o
token reencaixado é o combatente DA VEZ, a âncora do orçamento (`movementAnchorX/Y`) ficava
apontando pro pixel ANTIGO — e o próximo passo mediria `destino − âncora` com o `cellSize` NOVO a
partir de um ponto que não existe mais no grid atual: o resultado em células fica incorreto (podia
bloquear um passo pequeno de verdade, ou liberar um passo grande demais, dependendo de quanto o
grid mudou).

**Correção**: `services/movement.ts#reanchorActiveCombatant`, chamada de `scene:updateGrid` pra
cada token reencaixado — se ele é o combatente da vez, a âncora vira a posição NOVA (pós-reencaixe).
`movementUsed`/`movementBudget`/`movementPath` não mudam (mesmo espírito de D4: a correção vale só
daqui pra frente, não reescreve o que já foi gasto/desenhado com a geometria antiga).

## 4. Simplificações e divergências pequenas em relação ao texto do plano

- **`combat:set-movement { used }` sempre reinicia diagonais/âncora/caminho**, não só quando
  `used === 0`. O plano (§2.4) descrevia isso pro botão "zerar gasto" especificamente; generalizei
  pra qualquer valor de `used` que o GM mande, porque não existe uma âncora/caminho coerente pra um
  gasto "editado à mão" sem também redefinir de onde o próximo passo é medido — a alternativa
  (manter a âncora antiga) deixaria o próximo passo calculado sobre um "usado" que não bate com a
  distância geométrica percorrida. Só o botão de zerar usa isso na UI hoje.
- **`movementBudgetFallback`/o revert por `dragFrom` valem pro teclado também**, não só pro arraste
  — o plano descrevia a recusa (§4.2) em cima de `VttCanvas#handleTokenDragEnd`; estendi pra
  `useTokenMoveShortcuts#confirmBurst` pelo mesmo motivo (D2/D6 já pedem que o teclado se comporte
  como o arraste) e porque, sem isso, o caso 3.2 se repetiria idêntico via teclado.
- **`token:update-many` continua não sendo atômico no banco** (característica pré-existente,
  §3.1 acima) — não tentei um `$transaction` do Prisma pra isso; seria uma mudança maior, fora do
  que o plano pedia, e o padrão de "tudo-ou-nada" que já existe (permissão) continua valendo pro
  caso comum.

## 5. Não feito nesta passada

- Teste manual em navegador (dois clientes, um combate de verdade) — só verificação de código e
  automatizada (`make typecheck && make test`) até aqui.
- Testes de integração pra `services/movement.ts`/`socket/combat.ts`/`socket/token.ts` (batem no
  Postgres real): o plano só pedia testes das funções puras em `packages/shared` + o caso de
  teclado em `apps/web/src/lib/grid.test.ts`, ambos feitos. O projeto não tem harness de teste de
  integração pra handlers de socket ainda (mesma lacuna já registrada em `docs/revisao-combate.md
  §9`) — os dois casos de borda corrigidos aqui (3.2 e 3.4) foram verificados por leitura de código
  e rastreamento manual do fluxo, não por um teste automatizado que reproduza a corrida.
