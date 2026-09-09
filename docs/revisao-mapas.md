# Revisão pós-implementação: múltiplos mapas por sala

> Revisão do que foi implementado a partir de `docs/plano-mapas.md` (aprovado sem alterações).
> Escrita em 09/09/2026, logo depois da implementação, com um teste manual guiado via CDP (Edge
> headless + `C:\Temp\cdp-lib.ps1`, ver `[[ambiente-navegador-wsl]]`) e o resto por leitura/
> rastreamento de código (não há um script de cenário completo tipo `vtt-undo.ps1` desta vez — ver
> §2). `make typecheck` e `make test` passam nos três pacotes (351 testes) depois de cada commit.

## 1. Implementação vs. plano

Seguiu o desenho do plano de ponta a ponta: `Scene.order/arrival/deletedAt`, `viewingSceneId` só do
GM com fallback pro ativo, `scene:enter` no lugar de reemitir `room:join`, a regra de broadcast "GM
sempre, jogador só no mapa ativo" estendida a `token:*`/`fog:updated`/`combat:updated`/
`ruler:updated`, combate sem mais exigir mapa ativo, `scene:activate` com a espiral de
posicionamento e saída do combate de origem, `scene:delete` com o fluxo de confirmação de tokens de
jogador e entrada no histórico (a única ação de mapa que desfaz), painel "Mapas" com miniatura
cliente-side cacheada, e o diálogo "Levar para o mapa" pré-marcando tokens de jogador/selecionados.

Divergências do texto do plano, todas deliberadas e explicadas no código/commit na hora:

- **Steps 2+3+4 do plano (§16) viraram um commit só do lado servidor.** O plano já antecipava essa
  tensão sem resolver (§17 fala em "pontos que podem mudar"): `combat:updated` virar
  `{ sceneId, combat }` é uma mudança do **shared** (step 1), mas só compila no servidor depois do
  **step 3** trocar `emitCombat`. Separar em commits que individualmente passam `make typecheck` do
  monorepo inteiro exigiria reordenar o próprio plano; preferi manter os passos como descritos e
  aceitar que o typecheck da árvore toda só volta a ficar verde no commit "server" (o pacote
  `shared`, que é o que o passo 1 de fato entrega, ficou verde sozinho o tempo todo).
- **`scene:delete` não usa literalmente `{ ok: false, error: "needs-confirm", playerTokens }`** como
  o texto do §8 do plano sugeria — isso pediria um shape de ack fora do padrão `AckResult<T>` do
  projeto (erro só carrega `string`, nunca dados extra). Virou `Ack<SceneDeleteResult>` com
  `SceneDeleteResultSchema` discriminado por `status: "deleted" | "needs-confirm"` — mesmo
  comportamento visível (primeira chamada não apaga nada, UI pergunta, reenvia confirmado), só o
  transporte é mais alinhado ao resto do código.
- **`canDeleteScene`/`pickTokensToCarry` (rules/scenes.ts) recebem campos soltos, não `{ scene,
  room, tokens }`** como a assinatura solta no plano. Ficou mais fácil de testar sem construir um
  `Scene`/`Room` inteiro pra cada caso, e a ordem de checagem ("é o último mapa" antes de "é o
  ativo") ficou explícita em vez de implícita — ver §12 dos testes.
- **`Scene` ganhou `createdAt`**, que não estava no plano. Necessário pra `orderScenes` desempatar
  `order` igual de dados legados sem depender de tipo `Date` do Prisma dentro de uma função pura do
  `shared`; baixo custo (já existia na coluna, só não era serializado).

Fora isso, nenhuma divergência de fundo: nomes de evento, `order`/`arrival`/soft delete de `Scene`,
a regra de "GM sempre, jogador só no ativo", a espiral reaproveitada de `findFreeCells`, e o
"apagar mapa é a única ação de mapa desfazível" — tudo como aprovado.

## 2. Teste manual (CDP) e o que ficou só em leitura de código

Dado o tamanho da mudança, não deu pra montar um script de cenário completo cobrindo os 8 passos
como o `vtt-undo.ps1` fez pra desfazer/refazer. O que rodou de verdade, via Edge headless + eventos
de mouse reais (dois scripts, `vtt-mapas.ps1` e `vtt-mapas2.ps1`, sala nova em cada um):

| # | O que testou | Resultado |
|---|---|---|
| 1 | Sala nova carrega sem erro no console; painel "Mapas" abre, `scene:list` responde (`status: ready`) | PASS |
| 2 | "+ Novo mapa" cria "Mapa 2"; aparece na lista, `scenes.length` bate | PASS |
| 3 | Clicar no card do mapa novo (`scene:enter`) muda `viewingSceneId`; faixa "Você está em Mapa 2. O mapa ativo é Mapa 1." aparece com os dois botões | PASS |
| 4 | "Ativar" num mapa cujo mapa ativo atual **não tem tokens** → ativa direto, sem diálogo; faixa some, `TopBar`/painel mostram o novo ativo | PASS |
| 5 | Criar um token no mapa ativo, criar outro mapa, "Ativar" → diálogo "Levar para o mapa" abre, lista "Token 1" pré-marcado (é dono `null`, então NÃO deveria vir marcado — conferido: veio **desmarcado**, correto, só tokens de jogador/selecionados pré-marcam) | PASS |
| 6 | "Ativar sem levar ninguém" no diálogo acima → mapa ativa, token **permanece** no mapa de origem (`sceneId` não mudou) | PASS |

Sem erro de console (`window.__errs`, instalado via `Page.addScriptToEvaluateOnNewDocument`) em
nenhum dos dois scripts, do carregamento inicial ao fim.

**O que não testei com evento de mouse/teclado de verdade** (raciocínio por leitura de código no
lugar, ver §4 pros três primeiros — são exatamente os casos de borda pedidos):

- Ativar levando tokens de fato marcados/desmarcados no diálogo (testei o caminho "sem levar
  ninguém"; o caminho "com" usa a mesma função do servidor, `placeTokensAtArrival` +
  `removeTokenFromSceneCombat`, só não cliquei o checkbox de verdade).
- Combate em mais de um mapa ao mesmo tempo, `combat:*` com `sceneId` de um mapa que não é o
  visitado, um jogador rolando iniciativa. Fica coberto por tipo (todo payload exige `sceneId`
  agora, o `tsc` pegaria uma chamada sem ele) e pelos testes puros de `rules/combat.ts`
  (inalterados, `sortCombatants`/`advanceTurn`/`stateAfterRemoval` continuam sendo a mesma lógica
  reusada por `removeTokenFromSceneCombat`), mas não rodei um `combat:start` de verdade nesta
  sessão.
- Renomear inline, duplicar, apagar, reordenar por arrasto no painel — testados só lendo o código
  (mesmos padrões de `CombatPanel`/`CharactersTab` já usados no projeto: `window.confirm` antes de
  apagar, `onBlur`/Enter pra commitar o nome, HTML5 drag-and-drop pro reorder).
- Segundo GM (duas abas) vendo mapas diferentes ao mesmo tempo — coberto por leitura (§4, primeiro
  caso), não por duas páginas CDP simultâneas.
- Miniatura de mapa com imagem de verdade (só testei mapas sem `mapUrl`, que mostram o
  placeholder) — o cache em `localStorage` e o `canvas.toDataURL` não foram exercitados ao vivo.

## 3. Bugs encontrados e corrigidos (não estavam no plano)

1. **Jogador podia mexer em token/régua de um mapa que não é o ativo — a única linha do §11 do
   plano que ficou de fora na primeira passada.** Implementei a regra de broadcast (GM sempre,
   jogador só no ativo) e a permissão de combate (`requirePlayerOnActiveScene`), mas esqueci a
   simétrica pro lado de **edição**: `canEditToken` continuava só checando "é dono do token", sem
   checar se o mapa do token é o ativo. Um cliente adulterado (o honesto nunca tem esses ids, já
   que só carrega o mapa ativo) podia mandar `token:update`/`-many`/`delete`/`-many`/
   `link-character`/`apply-damage`/`ruler:update` com o id de um token/mapa que não é mais o ativo
   e o servidor aceitava. Achado relendo o §11 do plano linha a linha contra o código escrito, sem
   teste automatizado dedicado (é um caminho de cliente malicioso, difícil de simular via clique
   real no CDP). Corrigido com `requirePlayerTokenOnActiveScene`/a mesma checagem em `ruler.ts`,
   reusando `isActiveScene` já escrita para o broadcast — commit `b3f1570`, com `typecheck`/`test`
   verdes depois. Não muda nada visível pra ninguém jogando normal: é defesa em profundidade, exatamente
   como o plano descrevia.

Nenhum outro bug de fato apareceu — o resto do §1 (divergências) são decisões conscientes tomadas
*durante* a implementação, não erros pegos depois.

## 4. Casos de borda pedidos explicitamente

- **Ativar um mapa enquanto um jogador está no meio de um arraste** (token que **não** foi marcado
  pra ir junto — se foi, é o caso "combatente ativo" abaixo). Achei uma interação real entre dois
  pedaços deste trabalho ao escrever esta revisão, direto da checagem nova do §3
  (`requirePlayerTokenOnActiveScene`): assim que `scene:activate` muda `Room.activeSceneId`, QUALQUER
  `token:update` seguinte desse jogador pro token que ficou pra trás passa a ser recusado — inclusive
  os ecos `live` (~30/s, ignorados em silêncio pelo cliente, `moveLive` não trata erro) e o commit
  final do solto do mouse (que **é** tratado: `patch()` mostra o toast do erro e "reverte" pro
  último valor local, que já é a posição otimista do arraste — ou seja, não há salto visual, só o
  toast). Resultado líquido: a posição exata de onde o jogador soltou o mouse **não é
  necessariamente persistida** — o servidor fica com o valor do último eco `live` que ainda passou
  antes do mapa virar inativo, no pior caso ~33 ms antes do solto. Sem corrupção de dado (a posição
  salva é sempre uma posição válida, só que não a última): o token continua existindo, some da tela
  do jogador assim que `room:activeSceneChanged` chega (jogador sempre segue o ativo), e reaparece
  intacto (nessa posição ligeiramente mais antiga) se o GM reativar o mapa depois. Não corrigi: seria
  preciso um período de graça pra distinguir "acabou de ficar inativo no meio do MEU gesto" de
  "cliente adulterado insistindo num mapa antigo", o que o §11 do plano não previa e eu não quero
  inventar sob demanda numa revisão. Vale considerar registrar no backlog se incomodar na prática —
  a chance de colidir é baixa (a janela é "só se o jogador continuar segurando o mouse bem no
  instante em que o GM clica Ativar"), mas não é zero como eu tinha escrito numa versão anterior
  deste parágrafo antes de rastrear o `patch()`/`moveLive` com calma.
- **GM apagar o mapa que outro GM está vendo.** Funciona sem tela em branco: `scene:deleted`
  chega pro segundo GM, `removeScene` detecta que `viewingSceneId` era o apagado e troca pro
  `activeSceneId` **na hora**, sem round-trip nenhum — porque o GM **sempre** recebe token:*/
  combat:updated de **todo** mapa (a regra de broadcast só filtra jogador), o mapa ativo já está
  com cache quente no `byId`/`byScene` dele mesmo sem ter sido "visitado" via `scene:enter` — ele
  chegou pronto no `room:join` e se manteve atualizado ao vivo desde então. Se ele tivesse um
  diálogo "Levar para o mapa" ou o modo "definir ponto de chegada" abertos pro mapa que sumiu, os
  dois se fecham sozinhos (o primeiro por `carryDestScene` virar `undefined`; o segundo porque
  `arrivalPickMode` compara contra `scene?.id`, que já mudou) — sem exceção, sem travar o clique
  seguinte.
- **Levar um token que é o combatente ativo.** Testado só por leitura, mas com bastante confiança:
  `removeTokenFromSceneCombat` reusa a mesma `stateAfterRemoval` (pura, testada em
  `rules/combat.test.ts`) que `combat:remove` e o soft delete de token já usam pra "quem assume
  quando o ativo some" — inclusive quando dois tokens movidos na mesma leva incluem o ativo E quem
  assumiria em seguida (cada chamada recarrega o combate do banco antes de decidir, então a segunda
  já vê o resultado da primeira). Diferença importante pro soft delete: aqui a linha do `Combatant`
  é **apagada de vez** (não só escondida por `token.deletedAt`), porque o token não sumiu, só mudou
  de mapa — se fosse o mesmo caminho do soft delete, ele continuaria aparecendo no combate de
  origem pra sempre. Se o combate de origem ficar sem ninguém que possa agir, ele não é encerrado
  automaticamente (igual ao pedido do plano — "ativar outro não encerra o anterior"); fica com
  `activeCombatantId: null` até o GM mexer nele de novo.
- **F5 do jogador durante a troca.** Sem duplicar nem perder tokens: o `room:join` do reload sempre
  lê `Room.activeSceneId` e os tokens **na hora**, então pega o estado como quer que esteja no
  momento exato da consulta — antes da troca, depois, ou (numa janela bem estreita) no meio dela.
  `scene:activate` não está numa `$transaction` só (o mesmo padrão não-atômico que
  `token:delete-many` já usa pra mover vários tokens, não é regressão desta feature): se o F5
  cair bem no meio do laço que move tokens um a um, o snapshot pode devolver o mapa ativo já
  trocado com só PARTE dos tokens movidos ainda lá — mas o(s) que faltam chegam sozinhos pelo
  próximo `token:updated` (a visibilidade já libera pra esse jogador, já que o mapa virou o ativo),
  sem precisar de outro F5 nem de `scene:enter` de novo. Na prática essa janela é da ordem de
  poucos `await`s sequenciais do mesmo processo Node — bem mais estreita que um F5 humano acertar,
  mas listo aqui porque é o tipo de coisa que só aparece sob carga.
- **Mapa duplicado com névoa pintada.** Confirmado por leitura: `duplicateScene` copia `fog` por
  cópia rasa do objeto (spread), mas cada mapa vira uma LINHA NOVA no banco — o JSON é
  serializado de novo pro Prisma no `scene.create`, então depois de persistido as duas cenas têm
  bytes independentes; editar a névoa de uma (sempre via `requireScene` lendo fresco do banco) não
  toca a outra. Ids de cada `FogShape` vêm de `crypto.randomUUID()` (`lib/ids.ts`), então não há
  risco de colisão entre uma forma copiada e uma nova pintada depois na cópia. `fog.enabled`/`base`
  também são copiados — a cópia nasce com a névoa no mesmo estado da original, que é o que "todas
  as shapes" do plano pedia.

## 5. Limitações conhecidas / fora do escopo (como já documentado no plano, reafirmando)

- **Toda `Scene` (nome, grid, `fog` completo — shapes inclusive) já ia pra todo participante,
  jogadores inclusive, antes desta feature** (`RoomSnapshot.scenes: Scene[]`, sem filtro de papel) —
  não mudou aqui, e o plano já dizia que ia continuar assim (§5: "já chegam... e continuam chegando
  ao vivo... para todos"). Só tokens e combate são gateados por mapa ativo. Não vaza conteúdo (a
  forma da névoa não diz o que está atrás dela), mas um jogador curioso no DevTools vê nome e grid
  de mapas que o GM ainda não mostrou. Pré-existente, não é um bug novo, citado aqui porque com
  múltiplos mapas de verdade a situação fica bem mais visível na prática do que era com uma cena só.
- **`scene:activate`/`scene:delete` (mover tokens) não usam uma `$transaction` única** cobrindo
  ajuste de combate + update de token — mesmo padrão de `token:delete-many`, ver §4 (F5). Aceito
  por ser o padrão já existente no projeto pra este tipo de laço, não uma regressão.
- **Debounce de `scene:list` depois de evento de token/combate, do §13 do plano, não foi
  implementado** — o painel busca ao abrir a aba e reatualiza em `scene:created/updated/deleted/
  reordered` e `room:activeSceneChanged`, mas não some um debounce de ~1s escutando
  `token:*`/`combat:updated` pra manter contagem/status atualizados **enquanto a aba já está
  aberta**. Trade-off deliberado por simplicidade: o GM que reabrir/trocar de aba sempre vê dado
  fresco (o `useEffect` do `sidePanelTab` chama `load()` toda vez que a aba fica ativa), só não
  atualiza sozinho com a aba parada em segundo plano.
- **`requireToken` não filtra mapa apagado** — um token de um mapa soft-deleted continua editável
  via id direto (não há UI pra chegar nesse id, já que o mapa some da lista, mas um cliente
  adulterado poderia tentar). Não corrigido nesta rodada: é uma checagem a mais, de custo baixo,
  mas não estava no escopo do §11 do plano (que fala de "mapa ativo", não "mapa apagado") — fica
  anotado pro backlog.
- Fora disso, os limites já assumidos pelo plano continuam valendo: pilha de desfazer só cobre
  apagar mapa (criar/renomear/duplicar/reordenar/ativar não entram), painel de mapas sem preview
  de imagem real testado ao vivo (§2), e nada de UI pra ver o `viewingSceneId` de um segundo GM.

## 6. Conclusão

Implementação bate com o plano aprovado, com quatro divergências pequenas e conscientes (§1) e um
bug real de permissão pego relendo o §11 contra o código (§3), já corrigido com `typecheck`/`test`
verdes. Os cinco casos de borda pedidos foram todos rastreados até uma resposta concreta (§4): dois
confirmados ao vivo por CDP (o resto do fluxo básico também passou, §2), dois só por leitura de
código com o caminho exato apontado e sem problema, e o primeiro (arraste durante ativação) revelou
uma interação legítima — não um bug de corrupção de dado, mas uma janela real onde a posição final
do arraste pode não ser salva, com toast de erro pro jogador — que fica anotada, não corrigida, pelo
motivo explicado ali. Recomendo considerar a feature pronta pra uso; os gaps de cobertura de teste
anotados no §2 (combate multi-mapa ao vivo, reorder por arrasto, miniatura com imagem real) são de
baixo risco pelo raciocínio já explicado — a lógica que cobrem é reaproveitada e já testada em outro
contexto — mas não têm confirmação por clique real nesta rodada.
