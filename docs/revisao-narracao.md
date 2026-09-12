# Revisão pós-implementação: notas do Mestre, pinos e sussurro

> Revisão do que foi implementado a partir de `docs/plano-narracao.md` (aprovado com dois ajustes:
> `Token.notes`/`Scene.gmNotes` nunca trafegam nos objetos serializados, só `hasNotes: boolean`,
> texto sob demanda por evento dedicado; e sussurro entre dois jogadores mostra pro GM o rótulo
> explícito "sussurro de X para Y"). Escrita em 12/09/2026, logo depois da implementação.
> `make typecheck` e `make test` passam nos três pacotes (562 testes: 370 shared + 129 server + 63
> web) depois de cada camada. **Não rodei um smoke test de navegador (CDP) desta vez** — a
> verificação foi por leitura/rastreamento de código, os testes automatizados novos, e
> `make seed-test` (confirma o fluxo de banco ponta a ponta: criou sala, mapas, handout, pino de
> handout E pino de nota sem erro). Recomendo um `make dev` manual antes de considerar "pronto pra
> jogar" — ferramenta Pino, painel de Notas e o seletor de sussurro ainda não foram clicados de
> verdade.

## 1. Implementação vs. plano

Seguiu o plano de ponta a ponta nos três eventos/schemas novos, na ordem combinada (shared → 1
migration → server: notas → pinos → sussurro → web: mesma ordem → SPEC → testes). Divergências,
todas deliberadas:

- **`Pin.kind` ficou de três valores (`"image" | "text" | "note"`), não dois com aninhamento.** O
  plano salvo em `docs/plano-narracao.md` esboçava `Pin{kind:"handout"}` carregando um `HandoutCard`
  aninhado por dentro. Na hora de implementar, isso colidia com o `kind` que o `HandoutCard` já usa
  pra dizer "image" ou "text" — dois `kind` com sentidos diferentes no mesmo objeto. Achatar pro
  discriminante único (`image`/`text`/`note`) reaproveita o `HandoutPinSchema` de antes quase sem
  mudança (só acrescenta a terceira variante) e evita a colisão de nomes. `pin:create`, que ainda
  precisa dizer "eu quero um pino de handout" antes de saber se vai virar image/text, continua com
  o discriminante de dois valores (`"handout" | "note"`) — só o resultado já fixado é que tem três.
- **`Scene.hasNotes` NÃO é redigido por papel; `Token.hasNotes` é.** O pedido original ("indicador
  discreto no token, só o GM vê") é explícito pra token. Pra mapa, hoje TODO broadcast de `Scene`
  (`scene:updated`/`scene:created`, ~10 pontos em `socket/scene.ts`) manda o mesmo objeto pra GM e
  jogadores de uma vez só — não existe hoje um mecanismo de "duas cópias por papel" pra `Scene` como
  já existe pra `Token` (`broadcastToken`/`emitTokenToPlayers`). Retrofitar isso em ~10 pontos só
  pra esconder um booleano ("este mapa tem nota") é uma automação bem maior que o valor: um jogador
  saber que existe uma nota, sem ver o conteúdo, vaza muito menos que saber que um NPC específico
  tem nota (efeito de metagame real — "por que só esse token tem o ícone?"). `Token.hasNotes` já
  tinha os 3 pontos de filtragem prontos (`emitTokenToPlayers`, `buildSnapshot`, `scene:enter`) e
  ganhou `redactTokenForViewer` nos três. Registrado aqui como decisão consciente, não esquecida.
- **Migration virou DROP + CREATE, não `ALTER TABLE ... RENAME`.** Ver §2 abaixo — a única
  divergência com consequência real de dados.
- **`NotePinCard` é um cartão flutuante, não tela cheia como `HandoutOverlay`.** O pedido original
  já dizia "pino visível para jogadores abre um cartão ao clicar" (diferente de handout, que "mostra
  em tela cheia") — o desenho final só formaliza essa distinção que já estava na história.
- **`token:set-notes`/`scene:set-notes` não entram na pilha de desfazer do GM.** Não estava no plano
  original de forma explícita, mas segue a mesma régua já usada pra `handout:create`/`update`
  ("trivial de desfazer à mão: escreve de novo") — Ctrl+Z de uma nota reescreveria o texto errado
  sem contexto nenhum pro GM entender o que está sendo desfeito.

## 2. Bordas revisadas (pedidas explicitamente)

### 2.1 Nota de token apagado e desfazer

Verificado por leitura de código, sem bug encontrado — comportamento correto:

- `Token.notes` é uma coluna comum, só mais um campo da linha. `token:delete`/`token:delete-many`
  (`apps/server/src/socket/token.ts`) só gravam `deletedAt: new Date()` — nunca tocam `notes`. Um
  token apagado (soft delete) **mantém a nota intacta no banco**, exatamente como PV/condições/
  `characterId` já fazem (mesmo padrão, docs/plano-desfazer.md §2).
- `token:get-notes`/`token:set-notes` (`apps/server/src/socket/notes.ts#requireTokenForNotes`)
  tratam um token soft-deleted como "não encontrado" — mesma regra de QUALQUER handler normal
  (`requireToken` em `token.ts` faz o mesmo). Um GM não consegue ler/editar a nota de um token que
  ele acabou de apagar, sem antes desfazer.
- Ao desfazer (`Ctrl+Z` → `buildDeleteHistoryEntry#revert`, `token.ts`): grava `deletedAt: null` e
  reemite via `broadcastToken(io, roomId, toToken(row), ...)` — `toToken` recalcula `hasNotes` a
  partir do MESMO `row.notes` que nunca foi tocado. A nota volta exatamente como estava, o
  indicador no token reaparece, e `token:get-notes` volta a funcionar. Nenhuma ação extra necessária
  — o soft delete já cobre isso de graça, mesmo raciocínio de PV/condições.
- Coberto por teste indireto: `history.test.ts` (padrão de revert/apply) já existia; não recriei um
  teste específico de "notes sobrevive ao delete/undo" porque exigiria banco (o padrão de teste do
  projeto pra fluxos assim é leitura de código + os pure functions relevantes, não integração —
  `history.test.ts`/`token.ts` não têm teste de integração hoje, só de `pickTrackableTokenPatch`
  etc.). Se quiser blindar isso com teste de verdade, precisaria de infraestrutura de teste com
  banco que o projeto não tem hoje (nenhum teste existente sobe uma sala real).

### 2.2 Pino de handout existente após o rename

**Achado real, com consequência prática**: a migration `20260912152552_notas_pinos_sussurro`
(`apps/server/prisma/migrations/.../migration.sql`) fez `DROP TABLE "HandoutPin"` seguido de
`CREATE TABLE "Pin"` — **não** um `ALTER TABLE ... RENAME TO`. O Prisma tentou detectar uma
renomeação, mas a heurística dele não junta "rename de tabela" com "campo obrigatório virando
opcional + colunas novas" na mesma migration — o resultado é indistinguível de "apagar uma tabela e
criar outra do zero" pro `prisma migrate dev`.

**Efeito**: qualquer `HandoutPin` que já existisse no banco ANTES desta migration foi apagado de
verdade (não veio junto pra `Pin`). Neste ambiente de desenvolvimento isso é inofensivo — o banco só
tinha o que `make seed-test` cria, e rodei `make seed-test` de novo depois da migration (confirma
que a sala volta a ter um pino de handout, criado do zero). Mas é importante deixar registrado:
**isto seria um problema real numa sala com jogadores de verdade que já tivessem pinos de handout
fixados** — a migration, como está gravada no histórico do Prisma, apaga esses pinos sem avisar.
Como o projeto não tem hoje nenhuma sala "de produção" com dado real (é uma ferramenta pra jogar com
amigos, não um serviço hospedado com usuários que já têm dado importante), decidi não reescrever a
SQL da migration à mão pra virar um `RENAME` — seria mexer numa migration já aplicada neste
ambiente, o que o Prisma não gosta (muda o hash do arquivo depois de já ter rodado). Se algum dia
existir uma sala com pinos de handout que IMPORTA preservar, a correção é: antes de rodar
`prisma migrate deploy` nesse ambiente, editar `migration.sql` pra `ALTER TABLE "HandoutPin" RENAME
TO "Pin"` seguido só dos `ALTER TABLE "Pin" ADD COLUMN`/`ALTER COLUMN` necessários, em vez do
DROP/CREATE gerado.

### 2.3 Sussurro para nickname com espaço ou duplicado

Coberto por teste (`apps/server/src/services/chatCommands.test.ts`, describe
`resolveWhisperTarget`):

- **Nickname com espaço**: `WHISPER_RE = /^\/w\s+(\S+)\s+(.+)$/i` só captura uma palavra (`\S+`)
  como nickname — "/w Mestre Sombrio fugiu!" vira `{ targetNickname: "Mestre", text: "Sombrio
  fugiu!" }`. Se ninguém se chama só "Mestre", `resolveWhisperTarget` devolve erro ("Ninguém com o
  nickname..."), e a mensagem NÃO é enviada (nem como texto normal, nem como sussurro — o handler
  lança `HandlerError` antes de criar o `ChatMessage`). **Limitação real, documentada no código e no
  SPEC (§3.4)**: `/w` não consegue endereçar um nickname com espaço. Mitigação: o seletor "para" (UI,
  lista os participantes por id, não por texto) sempre funciona, independente do nickname ter
  espaço ou não.
- **Nickname duplicado**: nada no `room:join` impede dois participantes com o mesmo nickname (nem
  deveria — não é um identificador único no sistema, `Participant.id` que é). `resolveWhisperTarget`
  filtra por `nickname.toLowerCase() === alvo.toLowerCase()`; com 2+ matches, devolve erro pedindo
  pra usar o seletor "para" em vez do comando de texto — nunca escolhe um dos dois "no achismo".
  Testado com dois participantes "Ana"/"ana" (case diferente, pra também confirmar que a comparação
  é case-insensitive nos dois sentidos).
- A UI (autocomplete Tab em `ChatTab.tsx#handleInputKeyDown`) completa com o PRIMEIRO nickname que
  bate por prefixo — não resolve a ambiguidade sozinho, só ajuda a digitar; a ambiguidade de
  verdade só existe na hora de ENVIAR (`resolveWhisperTarget`, servidor), que é quem decide.

### 2.4 Busca de notas em mapa apagado

Verificado por leitura de código (`apps/server/src/socket/notes.ts#registerNotesHandlers`,
handler `notes:search`), sem bug encontrado:

```ts
prisma.scene.findMany({ where: { roomId, deletedAt: null, gmNotes: { contains: q, ... } } })
prisma.token.findMany({ where: { deletedAt: null, notes: { contains: q, ... }, scene: { roomId, deletedAt: null } } })
```

- Nota de MAPA apagado: o próprio `scene.findMany` já filtra `deletedAt: null` — um mapa
  soft-deletado nunca aparece na busca, mesmo que a nota continue no banco (mesma regra de "todo
  lugar que lista mapas da sala agora filtra `deletedAt: null`", SPEC §4).
- Nota de TOKEN cujo mapa foi apagado: dois filtros redundantes de propósito (defesa em
  profundidade, mesmo estilo do resto do projeto — "regra 2b, mesmo mecanismo da 2" em
  `chatVisibility.ts`) — `token.deletedAt: null` (apagar um mapa soft-deleta os tokens de NPC/
  monstro dele junto, SPEC §9.7, então normalmente já bastaria isto) E `scene: { deletedAt: null }`
  (redundante na maioria dos casos, mas cobre qualquer futuro cenário onde um token sobreviva
  "solto" com o mapa dele apagado — nunca deveria acontecer hoje, mas o filtro não custa nada e
  documenta a invariante).
- Teste automatizado cobre a função pura de recorte (`buildNoteSnippet`,
  `apps/server/src/socket/notes.test.ts`) — a query em si (com os filtros acima) não tem teste de
  integração pelo mesmo motivo do §2.1 (sem infraestrutura de teste com banco no projeto hoje).

## 3. Testes automatizados novos

- **shared**: `schemas/pin.test.ts` (8 casos — `PinSchema` nas três variantes, `PinCreateSchema`,
  `PinUpdateSchema`).
- **server**: `services/pins.test.ts` (`pinVisibleTo`, GM/jogador × visible × mapa ativo, nos dois
  `kind`), `services/visibility.test.ts` (+3 casos: `redactTokenForViewer`), `services/
  chatCommands.test.ts` (+7 casos: `/w`, incluindo os dois de §2.3), `socket/notes.test.ts`
  (`buildNoteSnippet`, 4 casos).
- Nenhum teste web novo — o projeto não tem teste de componente/store hoje (só `lib/*.test.ts`
  puros); a camada web foi validada só por `tsc --noEmit`.

## 3.1 Correção pós-revisão: `toPin` derrubava a sala inteira (ZodError "title Required")

Bug real, reportado pelo dono do projeto ao abrir a sala depois do commit inicial: `toPin`
(`apps/server/src/services/pins.ts`) passava `name: row.name` pra QUALQUER `kind`, mas
`PinSchema` (packages/shared/src/schemas/pin.ts) chama o campo de `title` — não `name` — no ramo
`"note"`. Todo pino de nota (kind `note`) tinha `Zod.parse` explodindo com "title Required" — e
como `buildSnapshot`/`scene:enter` mapeavam a lista inteira de pinos com `.map(toPin)` sem proteção
nenhuma, um `throw` de UM pino derrubava o `room:join` inteiro (a sala não abria pra ninguém).

**Não era o backfill da migration** (a hipótese inicial do relato) — `SELECT kind, count(*) FROM
"Pin" GROUP BY 1` mostrou as linhas com `kind` correto (`image`/`note`), `handoutId`/`name`/
`imageUrl` batendo com o que cada `kind` precisa. O `kind='note'` já tinha `name` preenchido (é ele
quem guarda o título) — só a função de serialização não sabia que precisava renomear o campo na
saída.

**Correção**:
- `toPin` agora ramifica por `row.kind`: `kind === "note"` manda `title: row.name` (nunca `name`);
  qualquer outro `kind` manda `name: row.name` (nunca `title`) — os dois nunca mais se confundem.
- `toPinSafe(row): Pin | null` (nova função): mesma conversão, mas captura qualquer erro do Zod,
  registra um aviso (`console.warn`, com o id/kind do pino) e devolve `null` em vez de propagar a
  exceção — usada em `buildSnapshot` e `scene:enter` (as duas listagens de "pinos JÁ EXISTENTES" de
  um mapa), com `.filter((p): p is Pin => p !== null)` logo depois. Um pino com dado inconsistente
  (o motivo em si não importa: bug de mapeamento, edição manual no banco, uma migration futura
  incompleta) some da lista com um log, nunca derruba a sala inteira de novo.
- `pin:create`/`pin:update` continuam usando `toPin` (a versão que lança): ali a linha acabou de
  ser escrita por este mesmo processo — um erro de validação ali É um bug de verdade e deve
  aparecer no ack como tal, não ser engolido em silêncio.
- Verificado contra o banco de dev real (`SELECT` acima + um script descartável rodando `toPin`
  em cada linha existente): as 4 linhas atuais (1 handout, 3 nota) agora serializam sem erro.
- `PinSchema` em si nunca teve o bug — os dois ramos (`image`/`text` vs `note`) já exigiam só o
  que cada um tem de verdade (conferido de novo nesta revisão); o problema inteiro estava no
  MAPEAMENTO linha→schema em `toPin`, não no schema.
- Testes novos (`services/pins.test.ts`): `toPin` com pino de handout sem `title` nenhum (serializa
  normal), pino de nota (confirma que vira `title`, não `name`), pino de nota com `name` nulo
  (lança — é o caso que `toPinSafe` deveria engolir); `toPinSafe` com pino válido (mesmo resultado
  de `toPin`), pino de nota inconsistente (`null`, sem lançar) e `kind` desconhecido (`null`, sem
  lançar). `PinCreateSchema` continua rejeitando nota sem título NA CRIAÇÃO (já coberto em
  `packages/shared/src/schemas/pin.test.ts`, mantido) — a distinção pedida ("rejeitado na criação,
  não no snapshot") é exatamente a diferença entre `toPin` (criação, estrito) e `toPinSafe`
  (snapshot, tolerante). `make typecheck`/`make test` verdes (569 testes: 370 + 136 + 63).

## 3.2 Três ajustes pedidos depois da primeira revisão

### 3.2.1 Pino/handout no mapa passa a se comportar como token

Antes: clique simples abria o overlay/cartão direto (sem seleção), botão direito apagava sem
confirmação, sem arrastar (reposicionar era apagar e fixar de novo). Mudou pra imitar exatamente a
interação de token/gabarito:

- **Clique simples**: seleciona (halo tracejado dourado — `PinLayer`, mesmo visual de token/
  gabarito). Não abre mais nada.
- **Duplo clique**: abre (mesmo mecanismo geométrico de `registerTokenClick`, agora
  `registerPinClick` — dois `mousedown` no mesmo pino dentro de 300 ms).
- **Arrastar** (só GM): move. Diferente de token/gabarito, **sem eco `live` pros outros** — um pino
  não muda de posição durante uma cena jogada com a frequência de um token, então não parecia valer
  a complexidade de replicar o sistema de `live`/throttle; o arrasto é só visual NESTE cliente
  (`pinDragLive`, estado local do `VttCanvas`) até soltar, que manda UM `pin:update { patch: {x,y} }`
  final. `x`/`y` agora valem pra **qualquer** `kind` (antes só existiam campos de nota no patch) —
  mover não mexe em conteúdo, então não faz sentido restringir a handout.
- **Delete/Backspace** (só GM): apaga o pino selecionado — trocou o botão direito (que apagava sem
  seleção, sem histórico visível na UI) pelo mesmo atalho de token/gabarito
  (`lib/useDeleteSelectionShortcut.ts`); token, gabarito e pino nunca ficam selecionados juntos (a
  cada seleção nova, `VttCanvas` limpa as outras duas — mesmo padrão que token/gabarito já tinham
  entre si).
- Histórico: `pin:update` agora tem uma diff genérica por CAMPO (`pickTrackablePinPatch`,
  `socket/pins.ts`) comparando a linha do banco antes/depois — o mesmo mecanismo cobre mover (só
  x/y mudam) e editar nota (nome/texto/ícone/cor mudam), com o resumo do Ctrl+Z dizendo "mover
  pino" ou "editar pino" dependendo de quais campos entraram no diff. Substituiu o
  `buildPinUpdateHistoryEntry`/`writeNotePin` antigos, que só sabiam lidar com nota inteira.
- Sem teste novo pedido para este ajuste (a diferença é majoritariamente de interação no canvas,
  sem lógica pura nova que valesse a pena isolar) — verificado por leitura de código; recomendo um
  `make dev` manual antes de dar como fechado (arrastar/selecionar/Delete no canvas de verdade).

### 3.2.2 `/w` com nickname de mais de uma palavra

Antes: `WHISPER_RE` só capturava a primeira palavra como nickname — "Mestre Sombrio" virava
nickname "Mestre" + mensagem "Sombrio ...". Agora `parseChatCommand` recebe a lista de
participantes da sala e resolve de duas formas:

- **Entre aspas** (`/w "Ana Maria" oi`): tudo entre `"..."` é o nickname, literal.
- **Sem aspas, guloso**: tenta o prefixo mais LONGO do texto primeiro (todas as palavras menos a
  última), encurtando até achar um que seja nickname de alguém; para na primeira correspondência
  (ambígua ou não) — não continua tentando prefixos mais curtos depois de achar uma correspondência
  ambígua, só depois de um "não existe esse nickname" (`resolveWhisperTarget` ganhou um campo
  `reason: "not-found" | "ambiguous"` pra `parseChatCommand` saber qual dos dois casos é).
- **Nickname inexistente OU ambíguo**: `parseChatCommand` devolve `{ kind: "whisper-error" }` — o
  handler (`socket/chat.ts`) lança `HandlerError` na hora, a mensagem NUNCA é criada (nem como
  sussurro, nem como texto normal). Isto é uma mudança de comportamento deliberada: antes, um `/w`
  que não casasse a regex virava mensagem de texto pública (o autor podia achar que sussurrou e na
  verdade todo mundo leu); agora só acontece pra "/w <uma palavra só, sem mensagem depois>" (que
  nem parece uma tentativa completa de sussurro) — qualquer coisa com cara de `/w <nickname>
  <mensagem>` que falhe na resolução vira erro, nunca vazamento.
- `chat.ts` só busca a lista de participantes quando o texto começa com `/w` (`/^\/w\b/i`), pra não
  gastar uma consulta à toa em toda mensagem/rolagem normal.
- **Autocomplete Tab** (`ChatTab.tsx`) completa nickname com espaço já entre aspas
  (`/w "Ana Maria" `), detectando os dois casos em andamento (aspas já abertas, ou ainda sem aspas).
- Testes (`chatCommands.test.ts`): nickname simples, com espaço sem aspas (prefixo mais longo
  vencendo, e caindo pro mais curto quando o mais longo não existe), entre aspas (simples e com
  espaço), inexistente (com e sem aspas) e ambíguo (com e sem aspas) — 12 casos novos, mais os 2 de
  `resolveWhisperTarget` ganhando o campo `reason`.

### 3.2.3 Bug: autor do sussurro não via a própria mensagem

Achado real: `blockedPlayerIdsForWhisper` (broadcast) e `whisperGateOk` (snapshot/histórico) só
liberavam GM e o ALVO do sussurro — nunca checavam se o viewer era o AUTOR. Enquanto só
`handout:show` (sempre publicado pelo GM) usava `whisperTo`, isso nunca aparecia: "GM nunca é
bloqueado por regra nenhuma" cobria o único autor que existia. Quando o sussurro comum passou a
valer pra qualquer participante (docs/plano-narracao.md), um JOGADOR sussurrando pra outro sumia da
própria mensagem — o efeito prático seria "mandei e não apareceu no meu chat", parecendo que o
sussurro nem saiu.

Corrigido: `whisperGateOk` e `blockedPlayerIdsForWhisper` agora também liberam
`viewer.participantId === msg.participantId` (o autor), nos dois pontos (`emitChatMessage` e
`emitRollWithTargetsMessage`). Um teste antigo (`whisperGateOk`, "quem não é o alvo nem o GM fica
de fora", usando o AUTOR como viewer) esperava `false` — era o próprio bug codificado como
comportamento esperado; virou `true`, com um comentário explicando a inversão. Adicionado um quarto
viewer (`thirdParty`, nem autor nem alvo nem GM) pra cobrir de verdade "alguém de fora fica de
fora", que o teste antigo não testava (usava sempre o mesmo `other` como alvo E como "terceiro").
Cobertura agora: autor (sempre vê), destinatário (sempre vê), GM (sempre vê), terceiro jogador
(nunca vê) — os quatro pedidos.

## 4. O que ficou por fazer (fora do pedido original, ou nice-to-have)

- Busca de notas não pagina (ok pra uma sala pequena; uma sala com centenas de tokens anotados
  ficaria lenta — não é o caso de uso do projeto).
- O indicador de "tem nota" no token (canto inferior-esquerdo do círculo) não tem tooltip — só a
  presença do ícone; abrir o painel de notas é a única forma de confirmar o que diz.
- Arrastar um pino não emite eco `live` pros outros verem em tempo real (§3.2.1) — só o commit
  final broadcast. Se algum dia isso incomodar numa mesa (dois GMs mexendo no mapa ao mesmo tempo),
  dá pra copiar o mecanismo de `template:upsert { live: true }`.
