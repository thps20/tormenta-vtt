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

## 4. O que ficou por fazer (fora do pedido original, ou nice-to-have)

- Arrastar um pino pra reposicionar (hoje: apagar e fixar de novo, igual handout já era).
- Busca de notas não pagina (ok pra uma sala pequena; uma sala com centenas de tokens anotados
  ficaria lenta — não é o caso de uso do projeto).
- O indicador de "tem nota" no token (canto inferior-esquerdo do círculo) não tem tooltip — só a
  presença do ícone; abrir o painel de notas é a única forma de confirmar o que diz.
