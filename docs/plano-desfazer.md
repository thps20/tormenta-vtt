# Plano: desfazer/refazer (Ctrl+Z) para ações do Mestre no mapa

> Pilha de histórico por sala, só do GM, para reverter ações no mapa: apagar token (inclusive em
> lote), mover, redimensionar (inclusive em grupo), alternar condição, alterar visibilidade e soltar
> criaturas do compêndio. Escrito em 09/09/2026, **antes** da implementação.
>
> **Aprovado em 09/09/2026 com dois acréscimos** (incorporados neste texto, não é mais um adendo à
> parte): `token:update-many` para mover vários tokens selecionados numa entrada só (§3), e os
> botões de desfazer/refazer na Toolbar deixam de ser opcionais (§9).

**Fora deste plano** (fica pra depois, registrado como backlog): desfazer chat/rolagens, qualquer
`combat:*` disparado direto pelo usuário (rolar iniciativa, avançar turno, reordenar, adiar...),
ficha de personagem (`character:*`), criar token em branco (`token:create`), os demais campos de
`token:update` (nome, cor, imagem, dono — painel do token), `token:link-character`,
`token:apply-damage`. A Névoa (§9.3 do SPEC) mantém o próprio Ctrl+Z (`removeLast`) exatamente como
está hoje — este plano não mexe nela, só decide quando ceder o atalho pra ela ou pro histórico geral
(§5).

---

## 1. Modelo: pilha por sala, em memória, closures

`apps/server/src/services/history.ts` (novo), estado em memória, mesmo padrão de
`services/presence.ts` (quem está online) e da régua (`ruler:update`): **não é persistido**, se
perde num restart do servidor. Aceitável aqui pelo mesmo motivo que já vale pra presença (SPEC §8):
é uma conveniência do GM, não dado de jogo — perder a pilha num restart é bem menos grave que perder
posição de token ou ficha.

```ts
export interface HistoryEntry {
  id: string;
  /** Pronto pro toast: "apagar Goblin 3", "mover Herói", "soltar 5 cópias de Goblin". */
  summary: string;
  at: Date;
  /** Reaplica a ação (redo). Reconfere premissas antes de escrever — ver §7. */
  apply: () => Promise<void>;
  /** Desfaz a ação (undo). Idem. */
  revert: () => Promise<void>;
}
```

Cada handler que quer ser desfazível monta a entrada **no próprio lugar** onde já tem os dados em
mãos (mesmo espírito de `guarded(socket, schema, async (data, ctx) => {...})`: a lógica de negócio
fica junto de quem já carregou as linhas do Prisma), em vez de um "tipo de entrada" genérico com
`before`/`after` universal — os formatos são bem diferentes entre apagar token, mover e spawnar
criatura, e forçar um schema único só complicaria sem ganho.

`Map<roomId, { undo: HistoryEntry[]; redo: HistoryEntry[] }>`, funções puras:

- `pushEntry(stack, entry)` — empilha em `undo`, **limpa `redo`** (uma ação nova invalida o que
  dava pra refazer) e corta o fundo da pilha acima de **50** (`~50` pedido).
- `popUndo(stack)` / `popRedo(stack)` — tiram do topo (ou `undefined` se vazia).
- Depois de um undo bem-sucedido, a entrada some de `undo` e vai pro topo de `redo` (e vice-versa) —
  isso é o handler (`socket/history.ts`) fazendo, não a pilha por si (ela só empilha/desempilha).

## 2. `token:delete` e `token:delete-many` viram soft delete

### Prisma

`Token` ganha `deletedAt DateTime?` (nullable, sem default). Migration `token_soft_delete`.

### Consequência: quem já apaga o token de verdade, agora só marca

`token:delete` (handler existente) troca `prisma.token.delete` por
`prisma.token.update({ data: { deletedAt: new Date() } })`. Como a linha continua existindo, **tudo
que não é tocado continua junto**: `hp`, `conditions`, `characterId` (ficha vinculada) e a linha do
`Combatant` (hoje ela some via `onDelete: Cascade` da FK; com soft delete a FK nem entra em jogo) —
é por isso que "restaurar com tudo" sai de graça, sem precisar guardar um snapshot manual de cada
campo.

### Consequência: todo lugar que lista "os tokens da cena agora" precisa ignorar os apagados

Um token com `deletedAt` setado não é mais "um token da cena" pra ninguém — precisa sumir de listas,
snapshot, cálculo de posição livre etc., do mesmo jeito que sumia quando a linha era apagada de
verdade. Pontos que hoje buscam token(s) por cena/sala e passam a filtrar `deletedAt: null`:

- `services/snapshot.ts:19` — tokens da cena ativa no `RoomSnapshot`.
- `socket/fog.ts:28` — reenvio dos tokens após `fog:update`.
- `socket/compendium.ts:58` — células ocupadas ao calcular onde soltar criaturas novas.
- `services/combat.ts:249` (`applyConditionExpiry`) — expiração de condição por rodada não deve
  mexer num token apagado.
- `services/characters.ts:71` — token vinculado à ficha na cena ativa (usado por `character:roll`
  pra saber a quem ligar a rolagem).
- `socket/token.ts` (`requireToken`, usado por `token:update`/`token:delete`/`token:link-character`/
  `token:apply-damage`) — continua buscando por `id` (`findUnique`, usa o índice de PK), mas passa a
  rejeitar (`HandlerError("Token não encontrado")`) se `row.deletedAt` estiver setado: não dá pra
  editar um token que está na lixeira.
- `services/combat.ts` (`loadCombatRow`) — o `include: { combatants: { include: { token: true } } }`
  ganha `where: { token: { deletedAt: null } }` na relação: um combatente cujo token foi apagado some
  da lista de combate (não trava turno, não aparece na UI), mesmo a linha do `Combatant` continuando
  no banco pro undo restaurar depois.

**Decisão consciente de não mexer**: `services/chatVisibility.ts:44/62` (`loadTokenInfo`, usado pra
decidir quem vê uma rolagem/card ligado a um token) **não** ganha o filtro. Hoje, apagar um token de
verdade zera `ChatMessage.tokenId` (FK `onDelete: SetNull`), então uma rolagem antiga liberada do
gate volta a valer só a regra normal de `visibility`. Com soft delete a FK não dispara, então
`tokenId` continua apontando pro token na lixeira e o gate continua usando a última visibilidade
conhecida dele — ou seja, uma rolagem ligada a um token recém-apagado fica "congelada" na
visibilidade de antes de apagar, em vez de se abrir na hora. É uma mudança de comportamento pequena
e defensável (o token pode voltar a qualquer momento via undo, faz sentido a rolagem continuar
tratando-o como "ainda existe, só não tá na mesa"); só se resolve de vez quando a limpeza definitiva
(§8) apaga a linha física — nesse momento sim o `SetNull` da FK dispara e o gate se abre. Aviso caso
prefira outro comportamento.

### Entrada de histórico

Captura, **antes** de marcar `deletedAt`: para cada token do lote, `{ id, name }` (resumo); se algum
token é combatente de um combate ativo na cena, também o estado do `Combat` **inteiro** antes de
`prepareTokenRemovalFromCombat` rodar — `{ combatId, round, activeCombatantId, orders: {combatantId,
order}[] }` de TODOS os combatentes daquele combate (não só do removido: `prepareTokenRemovalFromCombat`
renumera a `order` dos que ficam, então restaurar exige devolver a ordem de todo mundo, não só
reaparecer o apagado).

- `revert`: `deletedAt: null` nos tokens do lote; se havia estado de combate capturado, restaura
  `round`/`activeCombatantId` do `Combat` e `order` de cada `Combatant` ao valor de antes; termina com
  `broadcastToken` (`token:updated`) de cada um + `emitCombat` se havia combate.
- `apply` (redo): mesma soft-delete + roda de novo `prepareTokenRemovalFromCombat` (recalcula do
  zero — os tokens ainda existem, só ficam marcados, então a lógica pura de remoção funciona igual)
  + os mesmos broadcasts.

### `token:delete-many` (evento novo)

O atalho Delete/Backspace (`useDeleteSelectionShortcut.ts`) e o botão de lixeira do `NpcQuickCard`
hoje apagam em lote chamando `token:delete` **um por um**, em loop no cliente (commit `1b956d6`/
`59211e9`). Pra virar **uma** entrada de histórico (o pedido explícito de "em lote"), é mais simples
um evento novo tudo-ou-nada — mesmo padrão que `token:apply-damage` já usa pra vários alvos — do que
inventar um mecanismo de agrupar N chamadas separadas de `token:delete` por uma janela de tempo ou
um `batchId` gerado no cliente (cogitei; descartei por ser mais mecanismo pra resolver o mesmo
problema que um evento dedicado resolve de graça, com "tudo ou nada" mais fácil de garantir).

```ts
"token:delete-many": (payload: { tokenIds: string[] }, ack: Ack) => void; // GM only
```

`tokenIds: z.array(IdSchema).min(1)`. Servidor confere todos antes de apagar qualquer um (mesmo
molde de `token:apply-damage`), roda o soft delete + ajuste de combate de cada um numa
`prisma.$transaction`, emite `token:deleted { tokenId }` (evento que já existe, sem mudança) pra cada
um e `combat:updated` uma vez no fim se algum era combatente. **Uma** entrada de histórico cobre o
lote inteiro. `token:delete` (evento single) continua existindo do jeito que está — usado noutros
lugares (ex.: botão "apagar" do `TokenInspector`) — e também empilha (uma entrada, um token).

## 3. Mover e redimensionar: uma entrada por gesto, não por tick do arraste

`token:update` já é o único caminho pra x/y/width/height/rotation, mas hoje mistura dois usos bem
diferentes (`apps/web/src/store/tokens.ts`):

- **Ao vivo, durante o arraste** (`moveLive`/`flushMoves`): emite `{id, x, y}` com throttle de
  ~30/s, sem esperar o ack. Isso **não pode** virar uma entrada de histórico por tick — 2 segundos de
  arraste seriam ~60 entradas, e desfazer devolveria 1 pixel de cada vez.
- **Ao soltar** (`patch()`): otimista + ack + reversão em caso de erro. É a única chamada que
  representa de fato "o usuário decidiu mover/redimensionar o token pra cá" — o candidato certo pra
  UMA entrada.

Hoje o servidor não tem como distinguir as duas (mesmo evento, mesmo formato). Solução: `TokenPatchSchema`
ganha um campo opcional `live?: boolean`, que `flushMoves` passa como `true`; `patch()` nunca o
define (fica `undefined`). O handler ignora `live` na hora de montar o `data` do `prisma.token.update`
(mesma lista de campos que já ignora `sceneId`), e só considera empilhar histórico quando
`!patch.live`.

Quando não é `live` e o autor é GM (§6), o handler compara os campos **rastreados** —
`x, y, width, height, conditions, visible` — entre o token antes (`requireToken` já carrega a linha)
e depois do update, e empilha **uma** entrada cobrindo só os que de fato mudaram nesse patch (soltar
o token move `x` e `y` juntos: uma entrada só). Campos fora dessa lista (nome, cor, imagem, dono —
editados pelo `TokenInspector`, que também passa por `patch()`) nunca entram na pilha; um patch que
só mexe neles não gera entrada nenhuma. Essa função de "quais campos mudaram, dentro da lista
rastreada" é pura (`pickTrackableTokenPatch(before, after)`, em `services/history.ts`) — dá pra testar
sem Prisma (§9).

`revert`/`apply`: `prisma.token.update({ data: before/after })` só com os campos capturados, seguido
dos mesmos broadcasts que `token:update` já faz (`broadcastToken` + `maybeReemitCombatForToken`, pra
o painel de combate acompanhar se nome/cor/visível/posição-relativa-à-névoa mudou).

### Arraste em grupo: `token:update-many`

`VttCanvas.handleTokenDragEnd` (arrastar um token selecionado move todos os outros selecionados que
o usuário controla, SPEC §3.2) já chama `onTokenPatch` **uma vez por token** do grupo ao soltar — hoje
isso seria uma entrada de histórico por token (mover 5 tokens = 5 entradas pra desfazer 1 por vez).
Mesmo raciocínio do `token:delete-many` (§2): em vez de agrupar N chamadas de `token:update` por
algum mecanismo de janela/`batchId`, um evento novo, tudo-ou-nada, no mesmo molde:

```ts
"token:update-many": (payload: { patches: TokenPatch[] }, ack: Ack) => void; // GM ou dono de cada token da lista
```

`patches: z.array(TokenPatchSchema).min(1).max(100)`. Só usado hoje pelo arraste em grupo (sempre
`{id, x, y}`), mas o schema aceita qualquer `TokenPatch` — não fecho a porta pra outro gesto em grupo
usar o mesmo evento depois. Servidor valida e aplica todo mundo (permissão por token, mesma regra de
`canEditToken`/`restrictPatchForRole` de sempre) numa `prisma.$transaction`, emite `token:updated` por
token (evento que já existe) e **uma** entrada de histórico cobrindo o lote inteiro — resumo "mover N
tokens" (ou "redimensionar"/"atualizar N tokens", dependendo de quais campos rastreados mudaram na
maioria dos patches; ver `services/history.ts`). Um único token arrastado (sem seleção múltipla)
continua no `token:update` de sempre — `token:update-many` só entra quando `handleTokenDragEnd` de
fato tem mais de um token pra mover.

**Alternar condição** e **alterar visibilidade** passam pelo mesmíssimo `token:update` (não são
handlers separados — o menu de condições e o toggle de visibilidade do painel já usam `patch()` hoje)
e caem automaticamente na mesma lógica acima, já que `conditions` e `visible` estão na lista
rastreada. Importante: a expiração **automática** de condição por rodada (`services/combat.ts`,
`applyConditionExpiry`, chamada por `combat:next`/`combat:end`) escreve direto no banco, **fora** do
handler `token:update` — não passa por aqui, então nunca empilha (correto: não é uma ação do GM, é
uma regra do sistema).

## 4. Spawn de criaturas: entrada única, desfazer apaga de vez

`compendium:spawn-creature` já cria N `Character` + N `Token` numa `prisma.$transaction` só e devolve
o array de tokens criados — candidato natural a **uma** entrada, sem trabalho extra de agrupamento.

- Entrada captura as linhas completas criadas (`Character.data` + campos do `Token`, incluindo os
  ids gerados).
- `revert`: apaga as cópias **de verdade** (`prisma.token.deleteMany` + `prisma.character.deleteMany`
  pelos ids capturados, numa transação) + `token:deleted`/`character:deleted` por id.
- `apply` (redo): recria as mesmas linhas com os **mesmos ids** (`create` com `id` explícito em vez
  de deixar o `@default(cuid())` gerar um novo) a partir do snapshot capturado + `token:created`/
  `character:created`.

**Por que hard delete aqui e soft delete em `token:delete`?** São ações com premissas diferentes: um
token apagado pelo GM pode já ter dano recebido, condições, rolagens ligadas a ele — minutos ou horas
de histórico de jogo — daí soft delete pra não perder nada disso enquanto o undo estiver disponível.
Uma criatura recém-spawnada não tem nada disso ainda (o "desfazer" costuma vir segundos depois do
"soltar"); apagar de vez evita esticar o conceito de "lixeira com prazo" (§8) pra outra entidade
(`Character`, que hoje não tem `deletedAt` nenhum) só por causa deste caso.

## 5. Eventos novos (`packages/shared/src/events.ts` primeiro, como manda a convenção)

| Evento | Payload | Quem | Efeito |
|---|---|---|---|
| `token:delete-many` | `{ tokenIds: string[] }` (min 1) | GM | soft delete em lote; `token:deleted` por id + `combat:updated` se afetou combate; uma entrada de histórico |
| `token:update-many` | `{ patches: TokenPatch[] }` (min 1) | GM ou dono de cada token | `token:updated` por id; uma entrada de histórico (§3, arraste em grupo) |
| `history:undo` | `{}` | GM | desfaz o topo da pilha da sala; ack `{ summary } \| null` (`null` = pilha vazia) |
| `history:redo` | `{}` | GM | refaz o topo da pilha de redo; mesmo ack |

Servidor → cliente, novo:

| Evento | Payload |
|---|---|
| `history:updated` | `{ canUndo, canRedo, undoSummary?: string, redoSummary?: string }` — só pra `rooms.gm(roomId)` (jogador não tem UI nenhuma disso, §6) |

Nenhum evento existente muda de formato, exceto `TokenPatchSchema` ganhando `live?: boolean`
(`packages/shared/src/schemas/token.ts`) — opcional, não quebra quem já manda `token:update` sem ele.

## 6. Jogador não tem desfazer — fica de fora da pilha do GM

Só ações com `ctx.role === "gm"` empilham, **independente de quem é dono do token** que mudou (o GM
mexendo no token de um jogador conta; o jogador mexendo no próprio token não). Recomendo isto, sem
meio-termo:

- O próprio pedido já enquadra a feature como "ações do Mestre no mapa", e o Ctrl+Z que já existe
  (Névoa) já é GM-only — desfazer geral segue a mesma régua.
- **Motivo prático, o mais forte dos três**: jogador arrastando o próprio token é provavelmente o
  gesto mais comum do app inteiro. Se cada `token:update` de jogador virasse uma entrada, a pilha de
  ~50 entradas de uma sala ativa seria inteirinha movimentos de jogador em segundos — empurrando pra
  fora exatamente as ações do GM que valem a pena desfazer (apagar em lote, spawn errado). O cap de
  50 perderia o sentido.
- O "oops" que a feature cobre é do GM operando em massa ou administrativamente (apagar, spawnar);
  jogador ajustando a própria posição já se autocorrige arrastando de novo — não precisa de Ctrl+Z.

Se no futuro fizer sentido um histórico *por jogador* (pilha separada, só das próprias ações, sem
disputar espaço com a do GM), é outra feature — registro aqui como ideia, não implemento agora.

## 7. Entrada fica inválida por uma ação que conflitou

Antes de escrever, `revert`/`apply` reconferem as premissas (linha ainda existe com o `id` esperado,
combate referenciado ainda é o mesmo). Se algo não bate, a entrada é **descartada** (não vai pro lado
oposto da pilha — não faz sentido redo/undo de algo que não pôde ser desfeito), o ack volta
`{ ok: false, error: "Não foi possível desfazer: <motivo>" }` (vira toast no cliente) e a pilha segue
com a próxima entrada abaixo — um segundo Ctrl+Z tenta ela. Hoje o único jeito de uma entrada de
`token:delete`/`token:delete-many` invalidar é a limpeza definitiva (§8) apagar a linha de vez depois
do prazo; nenhum evento do MVP atual apaga cena inteira (`scene:delete` não existe) ou sala, então o
exemplo do pedido ("cena apagada") não acontece hoje — mas o mecanismo já cobre o caso quando/se
existir.

## 8. Limpeza definitiva

Constante `TOKEN_TRASH_RETENTION_DAYS = 30` (ajustável). `apps/server/src/services/cleanup.ts`
(novo): `setInterval` de 6h, chamado uma vez no boot (`index.ts`), roda
`prisma.token.deleteMany({ where: { deletedAt: { lt: cutoff } } })` — sem lib nova, sem cron do SO,
mesmo espírito de simplicidade do resto do server. Não existe "encerrar sala" no MVP hoje (uma sala
nunca fecha explicitamente), então fica só o gatilho por tempo; se um dia existir, é só somar o
segundo gatilho aqui. Uma linha apagada de vez enquanto ainda referenciada por uma entrada de
histórico esquecida na pilha (sala inativa há 30+ dias, GM nunca mais deu Ctrl+Z) cai direto no caso
do §7 — a entrada simplesmente falha e é descartada da próxima vez que alguém tentar usá-la.

## 9. Web

- `store/tokens.ts`: `flushMoves` passa `live: true` no `token:update` do arraste ao vivo; `patch()`
  não muda.
- `lib/useDeleteSelectionShortcut.ts` e o botão de lixeira do `NpcQuickCard`: trocam o loop de
  `tokens.delete(id)` por uma chamada só a uma nova ação `tokens.deleteMany(ids)` (emite
  `token:delete-many`).
- `VttCanvas.handleTokenDragEnd`: quando o grupo arrastado (`groupDragRef`) tem mais de um token,
  monta os patches de todos e chama uma nova prop `onTokenPatchMany(patches)` (⇒ `tokens.updateMany`,
  emite `token:update-many`) em vez de várias chamadas de `onTokenPatch`; um token só continua no
  `onTokenPatch` de sempre.
- `store/history.ts` (novo, domínio próprio — convenção do projeto de uma store Zustand por
  domínio): `canUndo`, `canRedo`, `undoSummary?`, `redoSummary?`, ações `undo()`/`redo()`
  (`emitAck` + toast em caso de erro). Atualizado pelo broadcast `history:updated` em
  `store/bindSocket.ts`.
- Atalho: em `lib/useToolShortcuts.ts` (ou um hook novo ao lado, `useHistoryShortcut.ts`, GM only —
  mesmo guard de `useDeleteSelectionShortcut`) — Ctrl+Z/Cmd+Z: se a ferramenta ativa é Névoa, chama o
  undo dela (nada muda aí); fora da Névoa, chama `history.undo()`. Ctrl+Shift+Z / Ctrl+Y:
  `history.redo()` (só fora da Névoa — ela não tem redo hoje, SPEC §9.3, e este plano não muda isso).
- Toast: reaproveita `store/ui.ts#toast` — "Desfeito: <summary>" / "Refeito: <summary>" no sucesso;
  a mensagem de erro do ack no fracasso (mesmo padrão que todo outro `emitAck` do projeto já usa).
- **Toolbar** (`components/Toolbar.tsx`): dois botões novos (ícones `Undo2`/`Redo2` do `lucide-react`,
  já usado ali), abaixo dos `GM_TOOLS`, num grupo próprio (não são "modo" da ferramenta, são ações
  disparadas na hora — não usam o mesmo `ToolButton`/`aria-pressed`). `disabled={!canUndo}` /
  `disabled={!canRedo}`; tooltip mostra o `summary` da entrada no topo da pilha correspondente
  (reaproveita o mesmo estilo de tooltip on-hover dos outros botões da barra) em vez do rótulo fixo da
  ferramenta. Só aparecem pro GM (`isGm`, mesma prop que já filtra `GM_TOOLS`).

## 10. Testes

- `apps/server/src/services/history.test.ts` (novo, sem Prisma — mesmo estilo de `chatCommands.test.ts`):
  - `pushEntry` respeita o cap de 50 (descarta a mais antiga) e limpa a pilha de redo.
  - `popUndo`/`popRedo` de pilha vazia devolvem `undefined`; undo bem-sucedido move a entrada pra
    `redo` e vice-versa.
  - `pickTrackableTokenPatch(before, after)`: só `x/y/width/height/conditions/visible` entram; um
    patch que só muda `name`/`color`/`imageUrl`/`ownerId` devolve "nada rastreável" (sem entrada);
    `x` e `y` juntos viram uma entrada só, não duas.
- Sem teste de integração pra `revert`/`apply` em si — eles tocam Prisma direto, e nenhum
  `socket/*.ts` do projeto hoje tem teste de integração (só os serviços puros têm `.test.ts`); a
  garantia aqui vem do checklist manual abaixo antes de considerar pronto, mesmo padrão de esforço
  do resto do server.
- `packages/shared/src/test/systems.test.ts` continua passando sem mudança nenhuma (nenhum JSON de
  sistema muda neste plano).

**Checklist manual** (guiado, não automatizado — pra rodar antes de dar por concluído):
apagar 1 token → Ctrl+Z restaura com PV/condições/ficha vinculada intactos · apagar 3 selecionados →
1 Ctrl+Z restaura os 3 · apagar um combatente no meio de uma rodada → Ctrl+Z devolve ele ao combate na
mesma posição e não bagunça `round`/turno dos outros · mover token → Ctrl+Z volta 1 casa, mesmo após
2s de arraste (não 60 casas) · redimensionar → idem · alternar condição / visibilidade → idem ·
mover 5 tokens selecionados juntos → 1 Ctrl+Z devolve os 5 · spawnar 5 criaturas → Ctrl+Z some com as
5 fichas e tokens juntos · pilha vazia → Ctrl+Z não quebra nada, botões da Toolbar desabilitados ·
Ctrl+Z com a ferramenta Névoa ativa continua desfazendo névoa, não o histórico geral · jogador não
vê/aciona nada disso.

## 11. Decisões tomadas (avisar se for pra mudar)

- Pilha só do GM — §6, com a justificativa de espaço na pilha como motivo principal.
- Pilha em memória por sala, perdida num restart (mesmo padrão de presença/régua) — não persisto em
  tabela nova.
- `token:delete`/`token:delete-many` = soft delete (`Token.deletedAt`); nada mais é tocado, é por
  isso que a restauração vem "de graça" com PV/condições/ficha/combatente.
- `compendium:spawn-creature` desfaz com **hard delete** das cópias — assimetria proposital, §4.
- Uma entrada por chamada de socket; não agrupo várias chamadas diferentes numa "sessão" por
  tempo/janela. Apagar em lote (`token:delete-many`) e mover em grupo (`token:update-many`, acréscimo
  aprovado) viram atômicos porque cada um ganhou um evento dedicado, tudo-ou-nada — não por um
  mecanismo genérico de agrupamento; redimensionar em grupo não existe na UI hoje (Transformer só
  liga num token selecionado por vez), então não precisa de equivalente.
- Toolbar ganha os botões de desfazer/refazer (acréscimo aprovado) — não fica só no atalho de teclado.
- Retenção de 30 dias pra limpeza definitiva; sem gatilho de "encerrar sala" (não existe no MVP hoje).
- Cap de 50 na pilha de undo (como pedido); redo sem cap próprio.

## 12. Commits sugeridos (ordem)

1. server: Prisma `Token.deletedAt` (migration `token_soft_delete`) + todas as consultas que passam a
   filtrar `deletedAt: null` (§2) + `token:delete` vira soft delete + `requireToken` rejeita token
   apagado
2. shared: `history:undo`/`history:redo`/`token:delete-many`/`token:update-many` em `events.ts` +
   schemas em `payloads.ts` + `TokenPatchSchema.live`
3. server: `services/history.ts` (pilha pura + `pickTrackableTokenPatch`) + testes
4. server: `token:delete-many`, `token:update-many`, push em `token:update`/`token:delete` (com o
   caso de combate, §2) + `socket/history.ts` (undo/redo)
5. server: push em `compendium:spawn-creature` (hard-delete/recriar, §4)
6. server: `services/cleanup.ts` (purge 30 dias) + chamada no boot (`index.ts`)
7. web: `store/tokens.ts` (`live`, `deleteMany`, `updateMany`), `VttCanvas` (`onTokenPatchMany` no
   arraste em grupo), `store/history.ts`, atalho Ctrl+Z/Ctrl+Shift+Z, toasts, botões na Toolbar
8. `docs/SPEC.md`: §3.2 (atalho Ctrl+Z fora da Névoa), §3.3 (apagar token/soft delete), §9.5 (undo do
   spawn), tabela de eventos §5, nota em §4/§8 sobre a pilha em memória
