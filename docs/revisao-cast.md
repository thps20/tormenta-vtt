# Revisão: Cast — tela de exibição (docs/plano-cast.md)

> Passada de revisão pedida ao terminar as 7 etapas do plano: implementação vs. plano, a lista de
> efeitos do `VttCanvas` que `readOnly` desliga e os quatro casos de borda pedidos. Escrito em
> 17/09/2026, depois de `make typecheck && make test` passarem no monorepo inteiro (27 + 20 + 7
> suites; 461 + 220 + 80 testes — shared/server/web). **Não inclui** teste manual em navegador (duas
> janelas, GM + `?display=`) nem numa projeção física de verdade — só verificação de código e
> automatizado até aqui.

## 1. Status das decisões (§9 do plano)

- **Modo de câmera padrão amarrado à mesa física**: implementado em `services/display.ts#getCameraMode`
  — sem escolha explícita do GM, mesa física ligada → `"free"`; desligada → `"follow"`. A tela reporta
  o próprio `tabletop.enabled` por `display:set-tabletop-hint` (evento novo, não estava no plano
  original — precisei dele porque o padrão depende de um dado que só a TELA tem, não o servidor).
  Uma vez que o GM escolhe um modo (`display:set-camera-mode`), fica travado nele — a dica de mesa
  física não volta a mudar sozinha. Testado em `services/display.test.ts`.
- **Handout "para todos"**: implementado. `handout:show`/`handout:close` emitem `display:handout`
  pra `rooms.display` só quando `target === "all"`/`!row.whisperTo`; sussurro nunca chega lá. Server
  manda o `HandoutCard` já denormalizado (reaproveitei `buildHandoutCard`, a mesma função que já
  existia pro chat) — troquei o payload de `Handout` pra `HandoutCard` no meio da implementação
  porque `HandoutOverlay.tsx` (reaproveitado sem alteração) espera esse formato.
- **Régua do Mestre**: implementada sem nenhum código de servidor — a tela já está em
  `rooms.players`, então `ruler:updated` chega sozinho; só faltava o cliente ler
  `useTools().remoteRulers` e passar pro `VttCanvas`, que já sabia desenhar (`RulerShape`).
- **Blackout**: implementado — `services/display.ts` guarda o estado em memória por sala (mesmo
  padrão de `movementLimit.ts`), `display:set-blackout` (GM only) e `display:blackoutChanged`
  (GM + telas). Cobre a tela inteira, por cima de handout e mapa (ver §3.4).

## 2. `readOnly`: o que desliga no `VttCanvas` (pedido explícito da revisão)

`VttCanvas.tsx` ganhou três props novas (`readOnly?`, `controlledView?`, `labelScale?`), todas
opcionais e sem efeito quando omitidas — nenhum call site existente (`RoomPage`) muda de
comportamento. Com `readOnly`:

1. **`<Stage listening={!readOnly}>`** — a mudança que faz o resto ser desnecessário: Konva para de
   processar QUALQUER evento de ponteiro do Stage inteiro (clique, drag, wheel, hover), então nenhum
   dos handlers abaixo chega a disparar. Não precisei desligar cada `onClick`/`onDragStart`/etc
   individualmente nos ~15 lugares que os usam.
2. **`draggable={!readOnly && mode === "pan"}`** no Stage — redundante com o item 1, mantido por
   clareza/defesa em profundidade.
3. **`saveView()`** (grava zoom/pan no `sessionStorage`) vira no-op — a tela nunca tem enquadramento
   próprio pra lembrar (vem de fora, `controlledView`).
4. **Efeito de auto-fit/restaurar enquadramento** (o que roda em `scene.id`/dimensões mudando) —
   pulado inteiro; substituído pelo efeito novo que traduz `controlledView` (centro+zoom em pixels
   do mapa) pra `stagePos`/`stageScale`.
5. **Duas escutas de teclado** (tecla Y = marcar alvo sob o ponteiro; Backspace no modo Régua) —
   ambas ganharam `if (readOnly) return;` no topo do efeito.
6. **HUD inferior** (zoom/snap/grid/token novo) — todo o bloco (`#vtt-hud-bottom`) só renderiza sem
   `readOnly`.
7. **Dica de ferramenta** (canto superior direito, "Arraste tokens para mover...") — idem.
8. **`labelScale`** (não é bem um "desligamento", mas é o outro lado da mesma mudança): multiplica
   `fontSize`/caixa do nome e da barra de PV do token (`TokenNode`). Não toquei em badge de
   condição, tooltip nem rótulo de régua/gabarito — ficaram de fora por não estarem citados
   explicitamente no pedido ("nomes de token e números (PV, iniciativa)"), e o tooltip de condição
   não apareceria de qualquer jeito sem hover (`listening=false`).

**O que eu NÃO mudei, de propósito**: `TokenInspector`/`NpcQuickCard`/`ConditionMenu` continuam no
código, mas nunca renderizam pra `DisplayPage` — ela sempre passa `selectedTokenId={null}` e nenhum
gesto consegue mudar isso (item 1). Não precisei de `if (readOnly)` neles.

## 3. Desvios do plano

- **`buildSnapshot` reaproveitado sem "zerar" campos** (plano §1.6 dizia `chat: []`, `targets: []`,
  `macros: []`, `favoriteEntryIds: []` explícitos pra tela). Implementei diferente: troquei o tipo
  do segundo parâmetro de `DbParticipant` pra um `SnapshotActor` estrutural (`{id, nickname, role,
  sessionToken}`) e passei um ator sintético pra tela — sem nenhum `if` especial dentro da função.
  Os campos citados acabam vazios de QUALQUER jeito, porque os filtros por `participantId` que já
  existiam (chat, alvos, favoritos, macros) nunca acham nada pro id sintético `"display"`. Mais
  simples que a versão do plano, ao custo de rodar algumas queries (histórico de chat, favoritos)
  que o resultado descarta — aceitável pro volume de uma sala.
- **`autoCamera` do combate não filtra gabarito por dono** (plano §4.1 dizia "gabaritos cujo
  `ownerId` é o dono do combatente da vez"). Na prática `Template.ownerId` é sempre quem CRIOU o
  gabarito (o `participantId` de verdade), nunca um sentinela tipo `"gm"` — não dá pra saber "é do
  GM" só olhando o campo. Troquei por: todos os gabaritos ativos entram como CONTEXTO (puxam o
  enquadramento quando cabem, nunca disputam com o combatente da vez pelo foco obrigatório em zoom
  travado). Resultado prático é bem parecido; só não distingue "gabarito de quem" quando há vários
  gabaritos de jogadores diferentes na tela ao mesmo tempo em modo automático.
- **Emissão do "seguir o Mestre" não estava no plano detalhado, mas era necessária pra ele
  funcionar**: `lib/castCamera.ts#useEmitGmView`, chamado de `RoomPage`, sonda
  `VttCanvasHandle.getView()` a cada 150ms (só quando há tela conectada e o modo é "follow") e emite
  `display:view`. Sem isso "Seguir o Mestre" nunca atualizaria depois do primeiro `display:join`.

## 4. Casos de borda pedidos

### 4.1 Revogar com a tela aberta

**Coberto.** `display:create-token`/`display:revoke-token` chamam `kickConnectedDisplays`: emite
`display:revoked` pra `rooms.display(roomId)` e, em seguida, `io.in(...).disconnectSockets(true)` —
força o fechamento do transporte. No cliente, `bindSocket` liga `display:revoked` a
`useCast.setRevoked()`; `DisplayPage` observa `revoked` e troca o canvas por uma mensagem de tela
cheia ("Link de exibição revogado..."). A reconexão automática (`bindSocket`'s `connect` handler)
tentaria `display:join` nesse ponto SE `lastJoinDisplay` ainda estivesse setado e o socket
reconectasse sozinho — mas como o servidor já forçou o disconnect, e o React não desmonta
`DisplayPage` sozinho, o comportamento observável é: tela mostra o aviso e fica assim (não tenta de
novo escondido) porque `revoked` nunca é limpo. Considero isto o comportamento certo — reconectar
sozinha com um token que acabou de ser revogado seria só gerar erro atrás de erro.

### 4.2 Trocar de mapa ativo com a tela em modo mesa física (recalcular zoom)

**Coberto — achei e corrigi um bug real ao escrever este caso.** Antes disso, confirmei que o
ESTADO em si troca certo: `room:activeSceneChanged` já cai em `setActiveScene` (`store/room.ts`),
que trata a tela como "jogador" (`me.role === "player"`) e chama `enterScene` → `scene:enter` —
exatamente por isso este evento está na allowlist de somente leitura (`DISPLAY_ALLOWED_EVENTS`);
sem ele, a tela ficaria com os tokens/combate/pinos/desenhos do mapa ANTERIOR até o próximo F5. Zero
código novo pra isso — é o mesmo caminho que qualquer jogador de verdade já usa. A primeira versão só recalculava o
zoom travado dentro das transições de "seguir"/"automático"; em modo **Livre** (o recomendado pro
plano físico, §7 do plano original) nenhuma das duas roda, então trocar de mapa deixaria o zoom
travado na escala do mapa ANTERIOR. Adicionei um terceiro efeito em `useCastCamera`
(`packages/apps/web/src/lib/castCamera.ts`) que corrige só o `zoom` (mantendo o centro) sempre que
`tabletopZoom` muda — em QUALQUER modo de câmera, sem transição suave (é calibração, não um
movimento de câmera). `rules/tabletop.ts#tabletopZoom` em si já era puro e testado; o que faltava
era garantir que o resultado dele fosse sempre aplicado.

### 4.3 Handout aberto quando o mapa troca

**Coberto, sem mudança — comportamento herdado do jogador normal, documentado como tal.** O overlay
de handout não é por mapa (é um evento avulso, guardado em `useCast.displayHandout`, independente de
`scene`). Trocar o mapa ativo não fecha o handout — é exatamente o que já acontece com
`HandoutOverlay` pra qualquer jogador hoje (`RoomPage` não fecha handout ao trocar de cena). Só fecha
quando o GM manda `handout:close`, ou quando o Mestre liga o Blackout (próximo item).

### 4.4 Blackout durante handout

**Coberto.** Em `DisplayPage.tsx`, o bloco do blackout e o do handout são mutuamente exclusivos na
árvore (`{blackout && (...)}` / `{!blackout && displayHandout && (...)}`) — com blackout ligado, o
overlay do handout simplesmente não é renderizado, mesmo que `displayHandout` continue setado por
baixo. Reativar a tela (blackout off) faz o handout reaparecer se o GM não tiver fechado — decidi
que isso é o comportamento certo (o Mestre "apagou a mesa" pra um efeito dramático, não pediu pra
fechar nada) e não vi motivo pra fechar o handout escondido só porque o blackout ligou.

## 5. O que ficou fora (fiel ao §8 do plano, sem surpresa)

Presentation API, mais de um link de exibição por sala, régua/alvos/pings/handout de um "próprio
jogador" na tela (só o do Mestre chega — a tela em si não pode ter os seus, nunca é dona de nada),
interação por toque, modo de câmera por tela (é por SALA). Modo de câmera, blackout e a dica de mesa
física são estado em memória — não sobrevivem a um restart do servidor (mesmo padrão de
`movementLimit.ts`/`drawingPermission.ts`, documentado no SPEC §8).

## 6. Testes automatizados que cobrem isto

- `packages/shared/src/rules/tabletop.test.ts` (22): escala física, zoom da mesa, rotação, câmeras
  seguir/automática (zona morta, prioridade do combatente da vez com zoom travado).
- `apps/server/src/services/display.test.ts` (23): token (gerar/bater/revogar/rotacionar),
  allowlist de somente leitura, modo de câmera padrão×explícito×mesa física, blackout, demanda de
  miniatura, e a tela filtrada "como jogador" em token/pino/desenho/combatente/chat/grupo.
- Sem teste dedicado pro lado React (`castCamera.ts`, `DisplayPage.tsx`, `CalibrationPanel.tsx`,
  `CastMenu.tsx`) — nenhum dos dois pacotes web tem infraestrutura de teste de componente hoje (só
  `vitest` puro em `apps/web`, sem testing-library); a lógica que dava pra extrair como função pura
  (a matemática de câmera) já está no shared e testada de lá.
