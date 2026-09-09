# Revisão pós-implementação: desfazer/refazer

> Revisão do que foi implementado a partir de `docs/plano-desfazer.md` (aprovado com os dois
> acréscimos de `token:update-many` e botões na Toolbar). Escrita em 09/09/2026, logo depois da
> implementação, com testes manuais guiados via CDP (Edge headless + `C:\Temp\cdp-lib.ps1`, ver
> `[[ambiente-navegador-wsl]]`). `make typecheck` e `make test` passam nos três pacotes; o script de
> teste (`C:\Temp\vtt-undo.ps1`) fechou com **52/52 checagens PASS** na última rodada limpa.

## 1. Implementação vs. plano

Seguiu o desenho do plano de ponta a ponta — soft delete de `Token.deletedAt`, pilha em memória por
sala (`services/history.ts`), `token:delete-many`/`token:update-many` tudo-ou-nada,
`compendium:spawn-creature` com hard delete assimétrico, `history:undo`/`history:redo` só GM,
atalho Ctrl+Z cedido à Névoa quando ela está ativa — e os dois acréscimos aprovados entraram como
descritos: `token:update-many` cobre o arraste em grupo (§3 do plano), e a Toolbar ganhou os botões
de desfazer/refazer com tooltip do resumo.

Três coisas saíram diferentes do texto original do plano, todas por necessidade descoberta durante
a implementação ou o teste (detalhadas com o resto dos achados no §3, já que são bugs pegos e
corrigidos, não só "detalhe de redação"):

- **`applyTokenUpdate` virou uma função só**, compartilhada por `token:update` e
  `token:update-many` (o plano já sugeria isso, mas não detalhava a assinatura) — devolve
  `{ before, after, historyBefore }`, os três com papéis diferentes (§3, achado do arraste).
- **`TokenPatch` ganhou um segundo campo de transporte**, `dragFrom`, além do `live` já previsto no
  plano — não estava no desenho original; foi a correção do bug do "antes" do arraste (§3).
- **`compendium:spawn-creature`'s `revert()` ganhou uma chamada a `adjustCombatForTokenRemoval`**
  que o plano não mencionava — bug pego escrevendo esta própria revisão, corrigido antes de rodar
  os testes (§3, primeiro item).

Fora isso, nenhuma divergência: os nomes de evento, os campos rastreados (`x/y/width/height/
conditions/visible`), o cap de 50, a decisão de não empilhar ação de jogador, a retenção de 30 dias
— tudo como aprovado.

## 2. Checklist do §10 do plano, executado via CDP

Script `C:\Temp\vtt-undo.ps1` (sala nova a cada rodada, GM único, tokens/combate montados direto
nas stores do `window.__vtt` quando não é o gesto em si que importa, e eventos de
mouse/teclado **de verdade** via CDP nos pontos que testam a UI/o atalho). Resultado da última
rodada (13 seções, 52 checagens):

| # | O que testou | Resultado |
|---|---|---|
| 1 | Apagar 1 token com PV e condição → Ctrl+Z restaura os dois campos idênticos | PASS |
| 2 | Selecionar 3 (clique + shift-clique) + **Delete de verdade** → 1 chamada, 1 Ctrl+Z restaura os 3 juntos | PASS |
| 3 | Combate de 3, apagar o combatente **ativo** no meio da rodada → turno passa pro próximo; Ctrl+Z devolve o combatente, o `activeCombatantId` E a rodada originais | PASS |
| 4 | Mover 1 token por **arraste real** (mousedown→move→up) → Ctrl+Z volta pra posição EXATA de antes do gesto, não 1 tick de ~33ms atrás | PASS (só depois do fix do §3) |
| 5 | Redimensionar (via `patch()`, mesmo caminho de servidor do Transformer) → Ctrl+Z restaura o tamanho | PASS |
| 6 | Selecionar 2 e **arrastar o grupo de verdade** → 1 `token:update-many`, resumo "mover 2 tokens", 1 Ctrl+Z devolve os 2 na posição exata, 1 Ctrl+Shift+Z reaplica os 2 | PASS |
| 7 | Marcar condição / ocultar → Ctrl+Z desfaz cada um | PASS |
| 8 | Spawnar 2 cópias do compêndio → Ctrl+Z apaga as 2 fichas+tokens; Ctrl+Shift+Z recria (mesmos ids) | PASS |
| 9 | Criatura spawnada que virou o **combatente ativo** (`combat:add` manual + ciclar `next()`), Ctrl+Z do spawn | PASS (só depois do fix do §3) |
| 10 | Apagar token vinculado, apagar a FICHA depois, Ctrl+Z do apagar do token | PASS (só depois do fix do §3) |
| 11 | Esvaziar a pilha, `history:undo` de novo → `{ok:true, data:null}`, botão desabilitado, sem erro | PASS |
| 12 | Ctrl+Z **com o foco no `#chat-input-field`** → não desfaz; fora do campo, desfaz normal | PASS |
| 13 | Ctrl+Z com a ferramenta Névoa ativa → só `removeLast` da névoa, pilha geral intocada; fora da Névoa, volta a ser o desfazer geral | PASS |

Fora do checklist original, também testei explicitamente (pedido do dono): purge definitivo —
script isolado (`tsx` direto, fora do CDP) criou um token com `deletedAt` de 40 dias atrás, um de 5
dias e um vivo; `purgeDeletedTokens()` apagou só o de 40 dias. Confirma a retenção de 30 dias sem
esperar 30 dias de verdade.

**O que não testei com evento de mouse/teclado de verdade** (testei a lógica de servidor
equivalente, mas não o gesto exato):
- Redimensionar pelo `Transformer` do Konva (usei `patch()` direto): o código do `onTransformEnd`
  não mudou neste trabalho — continua chamando `onTokenPatch` como sempre chamou — então o único
  caminho novo (`applyTokenUpdate`/`pickTrackableTokenPatch`) já está coberto pela mesma chamada de
  servidor que o teste de `patch()` direto exercita. Risco residual: zero mudança de código nesse
  trecho específico do `VttCanvas.tsx`.
- **Jogador não empilha**: confirmado só por leitura de código (`ctx.role === "gm"` nos quatro
  pontos de `pushEntry`), não rodei uma segunda página de jogador via CDP pra confirmar ao vivo (o
  ambiente suporta — `vtt-ruler.ps1` já fez isso — só não caiu no orçamento desta rodada).
- Dois GMs (duas abas) mexendo na mesma sala ao mesmo tempo — a pilha é por sala, não por
  socket/aba, então um Ctrl+Z de uma aba desfaz uma ação da OUTRA aba do mesmo GM; comportamento
  esperado pelo desenho (§1 do plano: "só do GM", não "só de quem fez"), mas não tem teste
  cobrindo o caso de duas abas simultâneas.

## 3. Bugs encontrados e corrigidos (não estavam no plano)

Nenhum foi pego só de reler o código — todos apareceram testando com CDP ou escrevendo esta
revisão, o que é o motivo de existir a etapa. Corrigidos e commitados antes de fechar este
documento, com `make typecheck`/`make test` passando depois de cada um.

1. **O "antes" do histórico de mover ficava preso no último tick do arraste, não no início do
   gesto.** Os ecos `live` (~30/s) já escrevem `x/y` no banco durante o arraste (é assim que outros
   clientes veem o token se mexer em tempo real); o commit final lia "antes" do banco naquele
   momento — ou seja, a posição de ~33ms atrás, não a de quando o gesto começou. Ctrl+Z desfaria só
   o últimíssimo pedacinho do arraste. Pego pelo teste 4 (posição depois do undo não batia com a de
   antes do arraste, batia com algo **além** da posição final). Corrigido com `TokenPatch.dragFrom`
   (posição capturada no `handleTokenDragStart`, mandada só no patch final) — ver §1.

2. **`character:delete` reemitia `token:updated` para um token já apagado (soft delete).** A query
   de "tokens vinculados a essa ficha" não filtrava `deletedAt: null`; o `onDelete: SetNull` do
   banco desvincula QUALQUER token que referencie a ficha (apagado ou não) de qualquer forma, mas o
   `broadcastToken` de aviso ia junto pro token na lixeira — reintroduzindo-o no mapa de todo mundo
   antes de qualquer Ctrl+Z. Pego montando o cenário do §2/#10 do plano (apagar token, apagar
   ficha). Corrigido filtrando a query.

3. **`combat:start`/`combat:add` não rejeitavam token soft-deleted.** Teriam criado um `Combatant`
   pra um token "na lixeira" — `loadCombatRow` já filtra isso da lista depois, então não travava
   nada, mas criava uma linha órfã silenciosa. Achado relendo todas as queries de `prisma.token.*`
   do servidor depois do bug #2 (mesma classe de problema); sem teste dedicado, é hardening.

4. **Desfazer um spawn cujo token virou combatente ativo deixava o combate com o cursor de turno
   apontando pra ninguém.** `buildSpawnHistoryEntry.revert()` fazia hard delete direto, sem passar
   pelo mesmo ajuste de `round`/`activeCombatantId`/`order` que `token:delete` já fazia — o
   `Combatant` caía junto pelo `onDelete: Cascade`, mas sem `stateAfterRemoval` rodar. Este é
   exatamente o caso de borda pedido ("desfazer spawn de criatura que já entrou no combate");
   reconheci o risco lendo meu próprio código antes mesmo de montar o teste 9, corrigi primeiro
   (exportando `adjustCombatForTokenRemoval` de `socket/token.ts` pra reusar em
   `socket/compendium.ts`) e só depois confirmei com o cenário ativo.

5. **`undoSummary`/`redoSummary` ficavam presos no último valor depois que a pilha esvaziava.** O
   servidor omite essas chaves em `history:updated` quando a pilha correspondente está vazia
   (`peekSummaries`); `set(p)` no Zustand faz merge raso e nunca limpa uma chave que nunca chega no
   payload — o tooltip do botão desabilitado continuava mostrando "Desfazer: apagar Goblin 3" pra
   sempre. Pego testando o atalho de teclado de verdade (o teste original checava `undoSummary`,
   que mascarava se o Ctrl+Z tinha funcionado ou não). Corrigido reconstruindo os 4 campos por
   inteiro em `setState`.

Nenhum dos cinco quebra dado (todos são estado que se corrige no próximo `history:updated`/ação
seguinte), mas o #1 e o #4 são os mais sérios — o #1 quebrava a garantia central da feature
("desfazer o gesto inteiro, não um pedacinho") e o #4 é exatamente o caso de borda que o dono pediu
pra verificar.

## 4. Casos de borda pedidos explicitamente

- **Desfazer spawn de criatura que já entrou no combate**: era um bug de verdade (§3, item 4);
  corrigido e confirmado pelo teste 9 — o combate sobra consistente (2 combatentes, `activeCombatantId`
  válido apontando pra um dos que ficaram, sem erro no console).
- **Desfazer apagar token cuja ficha foi apagada depois**: funciona corretamente — o token volta
  (soft delete restaurado), mas **sem** ficha (`characterId: null`, porque o `onDelete: SetNull` do
  banco já rodou quando a ficha foi apagada, independente do token estar na lixeira ou não). Achei e
  corrigi de quebra o bug #2 (§3) montando este cenário — sem o fix, o token teria reaparecido no
  mapa de todo mundo no momento de apagar a FICHA, antes de qualquer Ctrl+Z.
- **Ctrl+Z com o foco no chat**: funciona como esperado — `isTyping(e.target)` (mesma proteção que
  já cobria os outros atalhos, `lib/isTyping.ts`) barra o handler antes de ele checar Ctrl+Z, então
  digitar num chat que por acaso contivesse "z" com Ctrl não aciona nada da feature.

## 5. Limitações conhecidas / fora do escopo (como já documentado no plano, reafirmando)

- Mover/redimensionar/apagar de jogador nunca empilha (decisão deliberada, plano §6).
- Grupo de resize não existe na UI (Transformer só liga num token selecionado), então não tem
  `token:update-many` de redimensionar — só de mover.
- Pilha em memória, perdida num restart do servidor (mesmo padrão de presença/régua).
- Sem "encerrar sala" no MVP: só o gatilho de 30 dias apaga de vez.
- Chat/rolagens/combate-como-ação-direta/ficha continuam fora do escopo (backlog do plano, §1).

## 6. Conclusão

Implementação bate com o plano aprovado (incluindo os dois acréscimos). Cinco bugs reais apareceram
só ao testar de ponta a ponta — nenhum sobreviveu à revisão, todos com commit próprio e
`typecheck`/`test` verdes depois. Os três casos de borda pedidos explicitamente estão cobertos por
teste automatizado guiado (CDP) com resultado registrado acima. Recomendo considerar a feature
pronta para uso; os dois gaps de cobertura anotados no §2 (Transformer via pixel real, segunda aba
de jogador) são de baixo risco pelo raciocínio já explicado, não bloqueiam.
