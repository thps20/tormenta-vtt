# Revisão: modo de combate (docs/plano-combate.md)

> Passada de revisão pedida ao terminar os passos 1–6 do plano: implementação vs. plano, seção por
> seção, casos de borda que o plano não previu e o que foi feito. Escrito em 08/09/2026, depois de
> `make typecheck && make test` passarem. §8 registra as decisões que vieram de volta do dono do
> projeto e o que foi ajustado por causa delas (191 + 25 + 28 = 244 testes na versão final).
> **Não inclui** o passo 7 do plano (teste manual em dois navegadores) — só automatizado até aqui.

## 1. Correção ao próprio plano: valores de iniciativa para jogador

**Divergência entre o plano aprovado e o pedido original — resolvida a favor do pedido original.**

O pedido original dizia: *"jogador vê só a ORDEM (nomes), sem valores de iniciativa, nem dos
outros jogadores"*. O plano que escrevi (§4, "Decisão 4") introduziu uma variação sem marcar como
decisão a confirmar: *"`initiative` só vem quando o combatente é dele (token que ele possui) e a
rolagem não foi às cegas"* — ou seja, o jogador veria o **próprio** valor.

Isso não foi contestado na aprovação (o acréscimo pedido foi sobre outra coisa: visibilidade de
rolagens por token oculto). Ao implementar, percebi a divergência e decidi pela leitura mais
literal do pedido original: **o jogador nunca vê nenhum valor numérico de iniciativa, nem o
próprio** — só `rolled: boolean` (já rolou ou não) e a posição na lista ordenada. `bonus` também
nunca vai para jogador. Implementado em `services/combat.ts#toCombat`: `initiative`/`bonus` só são
preenchidos quando `viewer.role === "gm"`, sem nenhuma exceção por dono.

Se a intenção era mesmo a do plano (jogador vê a própria), é uma mudança pequena e localizada
(inverter essa condição em `toCombat`) — mas prefiro te avisar em vez de escolher a leitura mais
permissiva sem avisar.

## 2. Acréscimo (visibilidade de rolagens por token oculto)

Implementado como pedido: `ChatMessage.tokenId` (nullable, `onDelete: SetNull` — apagar o token
desliga o vínculo em vez de deixar referência solta), gate em `services/chatVisibility.ts`
(`tokenGateOk` puro + `blockedPlayerIds`/`emitChatMessage` com I/O), aplicado em `combat:roll`,
`character:roll` e `character:use-item`.

Decisões que o pedido deixava em aberto:

- **Reentrega quando o token é revelado/sai da névoa**: escolhi **snapshot** (próximo
  `room:join`/reconexão), não reenvio ao vivo das mensagens já publicadas. Motivo: reenviar ao vivo
  exigiria descobrir "para quem a visibilidade de QUAL token mudou agora" e escanear o histórico de
  mensagens daquele token toda vez que um `token:update`/`fog:update` muda a visibilidade — no
  arraste comum (30 eventos/s) isso seria caro; e o gancho natural (`emitTokenToPlayers`, que já
  broadcasta por sala, não por participante individual) não sabe "quem GANHOU visibilidade agora"
  sem comparar contra o estado anterior por participante. Fica documentado no SPEC §3.5 e como
  limitação conhecida no §8.
- **`tokenId` de `character:roll`/`character:use-item`**: não existe um "token da rolagem" explícito
  nesses eventos (diferente de `combat:roll`, que já parte de um combatente com `tokenId`). Resolvi
  com `findActiveSceneTokenId(characterId, roomId)`: primeiro token da cena ativa vinculado à
  ficha. Ficha com mais de um token vinculado na mesma cena (nada no schema impede, ainda que raro
  na prática) pega o primeiro encontrado — sem critério de desempate definido. Fichas sem nenhum
  token na cena ativa (personagem "de mesa", não colocado no mapa) não ganham `tokenId`: a rolagem
  segue a regra normal de `visibility`, sem o gate extra.
- **"Só o GM recebe" é um override literal**, inclusive sobre a própria autoria: se o GM deixar o
  token do PRÓPRIO jogador invisível (`visible: false`) e esse jogador rolar (mesmo em modo
  "Própria"), `tokenVisibleTo` devolve `false` até para o dono (`!token.visible` é checado antes do
  "é dono"), então **nem o autor vê o próprio resultado** — só o GM. É uma leitura literal de
  "independente do modo de rolagem" que vale a pena confirmar: um jogador rolando por um token que o
  GM escondeu dele mesmo é uma situação incomum, mas o comportamento é esse.
- **Gap não coberto**: `token:apply-damage` continua checando só `messageVisibleTo` (visibility),
  não o gate de token, ao validar se quem chamou pode referenciar aquele `messageId`. Na prática o
  cliente só teria o id de uma mensagem que já recebeu (o filtro já vale no broadcast/snapshot), mas
  um cliente malicioso que adivinhasse o id de uma rolagem bloqueada poderia tentar aplicar dano a
  partir dela. Não é vazamento de informação (aplicar dano não devolve o conteúdo da rolagem), mas é
  uma checagem a mais que ficou faltando; anotado aqui em vez de expandir o escopo agora.

## 3. Caso de borda que o plano não previu: remover o combatente ATIVO

O plano listava em "riscos conhecidos" só reemissão e volume de mensagens — não dizia o que
acontece com `activeCombatantId`/`round` quando o combatente da vez é removido. Dois pontos:

- **`combat:remove` explícito**: sem tratamento, `activeCombatantId` ficaria apontando pra um id que
  não existe mais. Implementei `stateAfterRemoval` (puro, `rules/combat.ts`, testado em
  `combat.test.ts`): recalcula quem assume ANTES de apagar as linhas, andando a lista ordenada a
  partir da posição de quem foi removido, pulando também outros ids removidos no mesmo lote.
- **`token:delete` (o mais sério — não estava conectado a combate NENHUM no plano original).** Apagar
  um token que é combatente ativo faz o `onDelete: Cascade` do Prisma apagar a linha `Combatant`
  junto — se isso acontecesse ANTES de recalcular o cursor, `Combat.activeCombatantId` ficaria
  travado num id inexistente pra sempre (nenhum `combat:next` islands resolveria isso sozinho,
  porque `advanceTurn` não encontra a posição de um id que já sumiu da lista). Corrigido com
  `prepareTokenRemovalFromCombat`, chamado no handler `token:delete` **antes** do
  `prisma.token.delete` (services/combat.ts + socket/token.ts). Sem teste de integração automatizado
  para esse caminho específico (services/combat.ts não tem suite própria ainda — só a lógica pura em
  `rules/combat.test.ts`); vale um teste manual: apagar o token de quem está com o turno.

## 4. Caso de borda: reforço adicionado durante um turno adiado

Verificado, sem necessidade de tratamento especial: `combat:add` sempre entra com
`initiative: null` e `order` no fim (`max(order) + 1`); `sortCombatants` separa quem está **adiado**
(já rolou, mas fora da rotação) de quem **não rolou** em dois grupos distintos — o adiado nunca cai
"depois" de um reforço por causa de comparação de `order`, porque a comparação por `order` só
acontece dentro do mesmo grupo (não-rolados entre si). Nenhuma mudança de código motivada por isso;
não escrevi um teste dedicado (dá pra considerar depois se quiser mais cobertura).

## 5. Caso de borda: token do jogador da vez entra na névoa

Verificado contra `services/visibility.ts#tokenVisibleTo`: o DONO de um token sempre o vê
independente da névoa (só `visible = false` esconde até do dono). Então:

- Se é a vez do PRÓPRIO jogador e o token dele entra na névoa, ele continua vendo seu combatente,
  o banner "É o seu turno" e a própria linha na lista normalmente.
- Quem PERDE o combatente da lista são os OUTROS jogadores (não o dono, não o GM) — e aí a lista
  deles simplesmente não realça ninguém como "TURNO" enquanto for a vez de um combatente que eles não
  enxergam. É uma consequência do modelo de visibilidade que já existe pra tokens em geral ("nem
  nome nem existência vazam"), não um bug novo introduzido aqui — documentado, sem correção.

## 6. Simplificações deliberadas em relação ao texto do plano

- **`emitCombat` manda pra todo `participant` com `role: "player"` da sala**, não só os
  "conectados" — o plano (§6) sugeria uma função `connectedParticipants` nova em `presence.ts`.
  Mandar pra sala do Socket.io de um participante offline não faz nada (ninguém está nela), então o
  resultado é o mesmo sem precisar dessa função nova; mais simples. `presence.ts` não foi alterado.
- **Fog:update de uma cena que não é a ativa** também reemite o combate — mas `emitCombat` sempre
  olha a cena ATIVA da sala (decisão do plano: combate só existe ali), então nesse caso (raro: hoje
  só existe UI pra uma cena por sala, SPEC §8) o reenvio é redundante, não errado.
- **`combat:roll` com `scope: "one"` não exige que o combatente ainda esteja sem iniciativa** —
  diferente de `self`/`npcs`/`missing`, que só pegam quem falta. Não estava explícito no plano; decidi
  que uma ação explícita e nomeada (clicar num combatente específico) pode servir pra re-rolar, e as
  ações em lote são só a conveniência de "todo mundo que falta". Se não for a intenção, é uma
  restrição de uma linha (`if (row.initiative !== null) throw ...`).
- **`combat:reorder` exige a lista completa e sem repetição** dos ids do combate (validado por
  `Set`); um envio parcial ou com duplicata é rejeitado com erro, em vez de aplicado parcialmente.

## 7. Bugs de validação encontrados e corrigidos nesta própria revisão

Achados ao reler o código antes de fechar (não vieram de teste automatizado, porque comparar
tamanho de array com resultado de `IN` no Postgres não quebra teste unitário isolado — só apareceria
em uso real com ids duplicados):

- `combat:start`/`combat:add` comparavam `tokens.length` (uma linha por id, o `IN` do SQL não
  repete) com `tokenIds.length` bruto: um `tokenIds` com id duplicado sempre falharia com "Token não
  encontrado nesta cena", mesmo sendo um pedido válido. Corrigido: dedup com `Set` antes de
  consultar.
- `combat:reorder` conferia `combatantIds.length === known.size` e "todos conhecidos" — mas isso
  passa com uma lista que repete um id e OMITE outro (mesmo tamanho, todo mundo presente é
  conhecido, só que um combatente de verdade nunca aparece). Corrigido: compara `new
  Set(combatantIds).size` com `known.size`.

## 8. Pendências — resolvidas (decisão do dono do projeto, 08/09/2026)

1. **§1**: jogador vê o PRÓPRIO valor de iniciativa e bônus (exceto rolagem às cegas); dos outros,
   só ordem e `rolled`. Implementado: `Combatant.lastRollVisibility` (novo campo, migration
   `combatant_last_roll_visibility`) grava a `visibility` da última rolagem que gravou
   `initiative` — `"gm"` esconde o valor até do dono; digitado à mão (`combat:set-initiative`)
   reseta pra `null` (visível); copiado por `combat:resume` fica marcado `"gm"` (não é uma rolagem
   do dono do combatente que retomou, pode ser valor de outro jogador ou de um NPC secreto — ver
   nota abaixo). `toCombat` mostra o valor quando `mine && lastRollVisibility !== "gm"`.
   `InitiativeTab.tsx` atualizado pra exibir o número em vez de "✓"/"…" quando o servidor manda.
   **Nota (achado ao implementar, não pedido explicitamente, mas necessário pra não abrir um
   vazamento com a mudança acima):** sem marcar o valor copiado por `combat:resume` como às cegas,
   um jogador que "entra agora" no lugar de outro combatente passaria a ENXERGAR o valor daquele
   combatente (podendo ser de outro jogador, ou uma rolagem secreta de NPC do GM) — porque o
   servidor literalmente copia o número pra fazer a ordenação funcionar (`resumePlacement`, já no
   plano original). Escondido por padrão; se preferir que o dono veja o valor copiado quando a
   rolagem original era pública, é uma condição a mais em vez de sempre `"gm"`.
2. **§2**: o autor de uma rolagem sempre recebe a própria mensagem, mesmo com o token oculto pelo
   GM; o gate vale só para os demais jogadores. Implementado: `tokenGateOk`/`blockedPlayerIds`
   ganharam o parâmetro `authorParticipantId`, que deixa passar antes de checar o token. Testes
   novos em `chatVisibility.test.ts` (`describe("tokenGateOk")`, 6 casos).
3. **docs/backlog.md**: as duas notas pedidas foram acrescentadas (reentrega ao vivo; gate de token
   em `token:apply-damage`).

## 9. Não feito nesta passada

- Passo 7 do plano (teste manual em dois navegadores) — não executado.
- Testes de integração para `socket/combat.ts`/`services/combat.ts` (só a lógica pura de
  `rules/combat.ts` tem suite; os handlers batem no Postgres real e não há harness de teste de
  integração no projeto ainda — os testes de servidor existentes são todos unitários sobre funções
  puras de serviço).
