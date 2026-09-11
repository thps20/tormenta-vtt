# Revisão: sistema de alvos (docs/plano-alvos.md)

> Passada de revisão pedida ao terminar os 5 commits: implementação vs. plano, e os quatro casos de
> borda pedidos. Escrito em 10/09/2026, depois de `make typecheck && make test` passarem (18 + 8 + 4
> suites, 330 + 82 + 56 testes) no monorepo inteiro. **Não inclui teste manual em navegador** — só
> verificação de código e automatizado até aqui; recomendo uma passada com `make dev` + `make
> seed-test` (GM e dois jogadores) antes de considerar a feature fechada, sobretudo pelo risco de
> Alt anotado no plano (§6) e listado de novo no fim deste documento.

## 1. As três perguntas: como saíram

- **Q1 (quem vê os alvos dos outros)**: exatamente como recomendado. `mine` (meus alvos) sempre visível
  pra mim; `others` só desenha com "Mostrar alvos dos outros" ligado (checkbox por usuário,
  `localStorage`, desligado por padrão); alvos do **GM nunca vão a jogador nenhum** — bloqueado tanto
  no broadcast (`socket/targets.ts#broadcastTargets`, `if (role !== "player") return;`) quanto no
  snapshot (`services/snapshot.ts`, `if (... roleByParticipant.get(t.participantId) === "gm") return
  [];`).
- **Q2 (apagar o gabarito não restaura a seleção manual)**: como recomendado — `clearTargets()`
  zera `mine` e volta `source` pra `"manual"`; não existe nenhum estado guardando "o que era antes
  do gabarito" pra restaurar.
- **Q3 (20/1 natural, adicionada depois do plano)**: `rolls.attackAutoHit`/`attackAutoMiss` no JSON,
  avaliadas antes de `attackHit` (`services/rolls.ts#computeRollTarget`, `apps/server`), exatamente
  na ordem pedida. O card mostra "Acertou X (20 natural)"/"Errou X (1 natural)" via um campo
  `reason` no `RollTarget` (`"auto-hit" | "auto-miss" | "compare" | "no-rule"`) que não estava no
  desenho original do plano (a primeira versão só previa `hit`/`targetValue`) — acrescentado porque
  sem ele não haveria como o CLIENTE saber *por que* decidiu (natural vs. comparação) pra escolher o
  texto certo, já que a redação por viewer (§2.4 do plano) já apaga `targetValue` antes de chegar no
  navegador. `DiceRoll.natural` (resultado do d20) também é novo em relação ao rascunho original,
  pelo mesmo motivo — o card precisa do número pra montar "(20 natural)".

## 2. `packages/shared`: como saiu vs. o plano

Tudo do §1 do plano entrou como desenhado, com um ajuste de arquitetura não previsto:

- **Ciclo de import evitado**: o plano não previa isso, mas `schemas/system.ts` **não** importa
  `rules/targets.ts` em tempo de execução — só em `import type`. Importar `parseHitRule` de lá
  fecharia um ciclo (`system.ts → rules/targets.ts → rules/compute.ts → rules/progression.ts →
  schemas/character.ts → system.ts` de novo, pra ler `KeySchema`), que quebrava a inicialização do
  módulo (`KeySchema` chegava `undefined` em `character.ts`, achado rodando `vitest run` no shared —
  8 suites falhavam com "Cannot read properties of undefined"). A validação de `attackHit`/
  `attackAutoHit`/`attackAutoMiss` em `validateSystemDefinition` reimplementa a divisão em
  `left`/`op`/`right` localmente (`splitHitRuleOrFail`, comentado no próprio arquivo) em vez de
  reusar `parseHitRule` — pequena duplicação (~15 linhas) deliberada pra manter `system.ts` sem
  puxar `rules/compute.ts` pra dentro do grafo de import dele, mesmo padrão que já valia pra
  `rules/placeholders.ts`/`modifierTarget.ts` (as únicas duas regras que `system.ts` já importava
  de verdade antes desta feature).
- `rules/targets.ts` (`parseHitRule`, `evaluateHitRule`, `hitRuleTargetLabel`,
  `resolveTargetPlaceholder`, `naturalD20`, `toggleTarget`, `pruneTargets`, `targetsFromTemplate`):
  todas as funções do plano existem; `pruneTargets` existe e é testada (`targets.test.ts`) mas
  **não tem chamador no cliente** — ver §3 abaixo.
- `evaluateHitRule` devolve `targetValue` de qualquer lado que tenha `{target.*}` (não fixei "sempre
  o lado direito"), então `"{target.derived.defense} <= {total}"` funciona igual a
  `"{total} >= {target.derived.defense}"` — testado em `systems.test.ts` ("aceita attackHit lendo o
  outro lado").
- `RollTarget`/`DiceRoll.natural`/`targets` como descrito, mais o campo `reason` do item Q3 acima.

## 3. `apps/server`: como saiu vs. o plano

Bate com o §2 do plano. Pontos que o plano deixava em aberto e a implementação decidiu:

- **`target:set` preserva a ORDEM em que o cliente marcou** (`orderedAccepted`, `socket/targets.ts`),
  não a ordem que o `prisma.token.findMany` devolveu — importante pro Alt "vira o único alvo"
  continuar determinístico depois de uma rejeição parcial.
- **Broadcast pra outros jogadores**: uma consulta de tokens/névoa (`prisma.token.findMany` +
  `loadTokenInfo`) por chamada de `target:set`, e dentro dela um `tokenVisibleTo` por outro
  jogador — O(jogadores × alvos), aceitável pro tamanho de mesa do projeto (mesmo raciocínio do
  card de iniciativa em lote, que já paga esse custo).
- **Limpeza em cascata**: `token:delete`/`delete-many` (inclusive o `apply()` de redo do desfazer)
  chamam `syncTargetsAfterTokenRemoval`; `scene:activate` chama `clearPlayerTargetsOnActivate`
  (só jogadores); `scene:delete` chama `clearSceneTargets` (síncrono, sem broadcast — ninguém
  deveria estar vendo alvos de um mapa que acabou de ser apagado). **Não coberto**: a limpeza
  definitiva de 30 dias (`services/cleanup.ts`) e o hard-delete do redo de `compendium:spawn-creature`
  não passam por `syncTargetsAfterTokenRemoval` — na prática irrelevante (um token que já foi soft-
  deleted há 30 dias não devia estar marcado por ninguém há tanto tempo, e o servidor reinicia com a
  memória de alvos vazia de qualquer jeito).
- **`rollTargetsForRoomViewer`** (autor) faz uma consulta a mais (`prisma.room.findUnique` +
  `loadTokenInfo`) só pro ack — aceitável, é uma chamada só por rolagem com alvo, não por viewer.

## 4. `apps/web`: como saiu vs. o plano

Uma diferença deliberada de arquitetura em relação ao rascunho do plano (§3.1), pelo resto igual:

- **`showOtherTargets`/`clearTargetsOnTurnEnd` não moram na store `useTargets`** (o plano original
  previa isso) — moram em `RoomPage.tsx` como estado local + `localStorage`, seguindo o padrão que
  **já existia** no projeto pra "Centralizar no token da vez" (`centerOnActiveTurn`, mesmo arquivo,
  mesmo formato de chave). Preferi seguir a convenção já estabelecida no código a impor uma nova.
  Efeito prático: nenhum, as duas preferências funcionam igual (persistem por aba/navegador,
  aplicadas ao `VttCanvas`/`CombatPanel` via prop).
- **`pruneTargets` (shared) não é chamado no cliente** — o plano previa `prune(existingIds)` na
  store. Não implementei porque, na prática, toda mudança que tornaria um id "órfão" (token apagado)
  já dispara um `target:updated` do SERVIDOR corrigindo `mine`/`others` (via
  `syncTargetsAfterTokenRemoval`) — um `prune` local só cobriria a janela entre a exclusão otimista
  do token no `store/tokens.ts` e a chegada desse broadcast, e nesse intervalo o pior efeito é o
  anel de alvo simplesmente não desenhar (o token já saiu de `tokens`, então `renderToken` nem roda
  pra ele) — sem erro, sem card quebrado. Ver §5.1 abaixo pra essa janela na prática.
- **Selo de "quem mais mira"**: mostra iniciais (ou contagem, com 2+) no token e um ícone de mira
  dourado no `CombatPanel`, **sem tooltip com o nome de cada um** — o plano já registrava isso como
  "opcional" e eu decidi não construir uma segunda camada de tooltip geométrico (mesmo estilo do
  `conditionTooltipAtPointer`) só pra isso; fica anotado como limitação no SPEC §8.
- **Guarda contra Alt iniciar arraste** (`docs/plano-alvos.md` §6, risco já previsto): implementado
  em três pontos de `VttCanvas.tsx` — `handleStageMouseDown` (nunca encaminha o mousedown pro token
  quando Alt está apertado), `TokenNode.onDragStart` (`e.target.stopDrag()` se `e.evt.altKey`) e
  `onDragEnd`/`onDragMove` (ignoram o gesto cancelado, sem chamar `onTokenPatch`). Cobre o caso comum
  (Alt mantido apertado do mousedown ao mouseup); **não cobre** apertar/soltar Alt NO MEIO do arraste
  (ver §5.5).

## 5. Casos de borda pedidos

### 5.1 Alvo apagado entre marcar e rolar

**Verificado por código — sem erro, o alvo cai fora em silêncio.**

Sequência: jogador marca o token T (`mine` inclui T) → T é apagado (`token:delete`) antes do
jogador rolar. `syncTargetsAfterTokenRemoval` já tira T de `mine` no servidor e reemite
`target:updated` — mas se a rolagem sair ANTES desse broadcast chegar (o cliente ainda manda T em
`targetTokenIds`), o servidor está protegido de qualquer jeito: `loadRollTargets`
(`socket/character.ts`) busca os tokens com `prisma.token.findMany({ ..., deletedAt: null, ... })` —
T (já com `deletedAt` setado) não aparece no resultado, `rowById.get(T)` é `undefined`, e o
`flatMap` pula esse id sem lançar erro (`if (!row) return [];`). Se T era o ÚNICO alvo, `targets`
fica `[]`, `createRollMessage` nem calcula `natural`/monta `roll.targets` (a condição é
`input.targets?.length`), e a rolagem sai como uma rolagem de ataque comum, sem nenhuma linha de
alvo — nunca um erro pro jogador, nunca um card quebrado. Testado indiretamente por
`chatVisibility.test.ts`/`rules.test.ts` (nenhum teste cobre a query do Prisma em si, que exigiria
banco — o comportamento vem de como `findMany` responde a um id que não bate o filtro, não de lógica
nova minha).

### 5.2 Ataque com alvo em outro mapa

**Achado real, mas só afeta a própria visão do GM — nunca vaza pra jogador.**

Jogador: impossível na prática. `target:set` de jogador exige `requirePlayerOnActiveScene` (só marca
no mapa ATIVO da sala) e `scene:activate` chama `clearPlayerTargetsOnActivate` sempre que o mapa
ativo muda — então o `mine` de um jogador nunca aponta pra um mapa que não é mais o ativo.

GM: **pode** acontecer, e o código não impede. `services/targets.ts` guarda `sceneId` por
participante, mas `loadRollTargets` (`socket/character.ts`) filtra os tokens só por
`scene: { roomId }` — QUALQUER mapa da sala, não o mapa que o alvo foi marcado nele nem o mapa da
rolagem atual (que, aliás, `character:roll` nem recebe explicitamente — o vínculo é só via
`findLinkedTokenId`, que também não confere mapa). Cenário: GM marca um alvo no Mapa 1, navega pro
Mapa 2 (`scene:enter`, que **não** limpa os alvos do GM — só `scene:activate` limpa, e só de
jogador), e rola um ataque de uma ficha cujo token vinculado está no Mapa 2. O alvo "fantasma" do
Mapa 1 entra na conta (`computeRollTarget` roda igual, comparando contra a Defesa dele) e aparece no
CARD, pro GM.

Isso não vaza pra jogador nenhum: `rollTargetsForViewer` já teria descartado essa linha pra qualquer
viewer que não seja o GM (`if (info.token.sceneId !== activeSceneId) return [];`), e o autor aqui É
o GM — que não passa por esse filtro (`viewer.role !== "gm"` é falso). Então o efeito prático é só
"o GM vê no próprio card um alvo que ele esqueceu de estar marcando num mapa diferente" — confuso,
mas nunca incorreto pra quem mais está na mesa. Não é o mesmo bug que a regra 2b do resto do chat
evita (aquela existe pra jogador não descobrir que o GM está preparando algo num mapa escondido);
aqui não há nada escondido sendo revelado, só um alvo desatualizado na tela do próprio GM. Fica
registrado como limitação (não corrigido nesta rodada) — mitigação natural: `scene:activate` já
limpa jogador; estender pro GM mudaria a decisão deliberada "o GM mantém os dele" (§2.2 do plano) e
não foi pedido.

### 5.3 Jogador marcando token que fica oculto depois

**Verificado por código — comportamento consistente com o resto do chat, não um bug.**

Jogador marca T (visível) → GM oculta T (`token:update { visible: false }` ou move sob a névoa).
Servidor não tira T de `mine` nessa hora (só deleção/troca de mapa limpam, §2.2/§4 acima) — T fica
"esquecido" na lista até o jogador marcar outra coisa, T ser apagado, ou o mapa mudar. Na tela,
isso não aparece: como um token oculto nunca chega ao cliente do jogador (`emitTokenToPlayers` manda
`token:deleted` no lugar), T sai de `tokens` no `VttCanvas`, e `renderToken` simplesmente não roda
pra ele — sem anel pendurado, sem erro.

Se o jogador rolar um ataque com T ainda em `mine` (fantasma): o servidor AINDA acha o token (não
está soft-deleted, só `visible: false`), calcula `hit`/`targetValue` normalmente e inclui a linha —
mas `rollTargetsForViewer` aplica a MESMA regra de linha do card de iniciativa em lote
(`initiativeBatchForViewer`, que o plano pediu pra espelhar): quem não é GM e não vê aquele token
perde a linha, **inclusive o autor** — diferente da regra de mensagem inteira (`tokenId`/`blockedPlayerIds`),
que sempre isenta quem rolou. Ou seja: o próprio jogador que atacou não vê se acertou o monstro que
ficou invisível durante o ataque — só o GM vê. Não é uma inconsistência introduzida por mim: é
exatamente o comportamento que já existia pra linhas de um `initiative-batch` (o plano pediu pra
usar "mesma regra de linha", §2.4), só que agora também vale pra alvo de ataque. Achei que vale
registrar mesmo assim, porque steps "autor sempre recebe" (mensagem) e "autor não é exceção" (linha)
convivem no mesmo card e não é óbvio de olhar o código de fora.

### 5.4 Gabarito movido para fora de todos os tokens

**Verificado por código — os alvos esvaziam e voltam sozinhos se o gabarito voltar a cobrir alguém.**

O efeito em `RoomPage.tsx` (dispara em `templates`/`tokens` mudando, enquanto `source.kind ===
"template"`) recalcula `targetsFromTemplate(tokens, tmpl, cellSizePx)` a cada render relevante. Sem
nenhum token dentro, `ids` vira `[]`; o guard `if (ids.length === current.length && ids.every(...))
return;` não bate (tamanho mudou), então chama `setTargetsFromTemplate(templateId, [])` — que manda
`target:set { tokenIds: [] }` (o servidor apaga a entrada da sala, `setTargets` com lista vazia) e
`mine` fica `[]`, sem erro. Importante: `source` continua `{ kind: "template", templateId }` — não
volta pra `"manual"` só por esvaziar. Consequência (não pedida, mas decorrente do desenho): se o GM
arrastar o MESMO gabarito de volta sobre algum token, o próximo render do efeito recalcula e
`mine` volta a ter alvo, sem precisar apagar/recriar o gabarito. Nenhum teste automatizado cobre
esse fluxo específico (é um efeito de React, não uma função pura testável isoladamente) — confirmado
só por leitura do código; junto com o item abaixo, é o principal candidato a testar ao vivo.

### 5.5 Risco adicional (não pedido, mas relevante): Alt solto/apertado NO MEIO do arraste

Registrado no plano (§6) como risco a testar manualmente; a implementação cobre o caso comum (Alt
apertado do mousedown ao mouseup) mas **não** o caso de apertar ou soltar Alt depois que um arraste
de verdade já começou — `TokenNode.onDragStart` só decide se inicia o gesto no MOMENTO do mousedown;
uma vez que `handleTokenDragStart` (VttCanvas) já rodou, soltar Alt no meio não interrompe o arraste
em andamento (nem deveria — nesse ponto o usuário já estava movendo o token de propósito). O caso
oposto (mousedown SEM Alt, apertar Alt DEPOIS de já estar arrastando) também não interrompe — de
novo, não parece um problema real (ninguém aperta Alt no meio de um arraste de token esperando que
ele pare). Deixado de fora de propósito: cobrir isso exigiria ler `e.evt.altKey` em `onDragMove` pra
cancelar um arraste em andamento, mudando o comportamento de um gesto que já não tem nada a ver com
marcar alvo.

## 6. Resumo

Nenhum bug encontrado que vaze informação (jogador nunca vê alvo do GM, nunca vê `targetValue` de
token que não é dele, nunca vê linha de token que não pode ver). O único achado de comportamento
(§5.2, alvo fantasma do GM entre mapas) é uma inconsistência cosmética visível só pro próprio GM,
não corrigida nesta rodada — decisão deliberada de não estender a limpeza automática de alvos ao GM
(o plano já dizia "o GM mantém os dele"). §5.3 documenta uma interação sutil (autor não é isento na
redação por LINHA, é isento na redação por MENSAGEM) que já existia pro card de iniciativa em lote e
passou a valer pra alvos por seguir a mesma regra pedida no plano — não é uma regressão, mas vale a
pena o dono do projeto saber que existe. `make typecheck && make test` verde em todo o monorepo;
recomendo a passada manual com `make dev`/`make seed-test` antes de considerar a feature fechada,
sobretudo §5.4 (só verificado por leitura) e o risco de Alt do plano §6 (comportamento real do
navegador, não simulável por teste automatizado).
