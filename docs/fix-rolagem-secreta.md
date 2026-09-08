# Fix: rolagem secreta sumia até o Revelar

## Sintoma

Ao rolar no modo **Secreta**, a mensagem não aparecia de forma nenhuma no chat
do jogador — só surgia depois que o GM clicava em **Revelar**. O esperado: o
jogador deveria ver na hora um placeholder tipo "Fulano fez uma rolagem
secreta" (sem fórmula nem valor), que o Revelar troca pelo resultado completo.

## Causa

`emitChatMessage` (`apps/server/src/services/chatVisibility.ts`) escolhia
**uma única sala** Socket.io por visibilidade e mandava a mensagem só para
ela:

```ts
case "gm":
  io.to(rooms.gm(roomId)).emit("chat:message", msg);
  return;
```

Para quem não estava nessa sala (o jogador, no caso `"gm"`), **nenhum evento
era emitido**. A mensagem só passava a existir no cliente dele quando
`chat:reveal` mandava a primeira (e única) cópia, já com `visibility: "all"`.

O bug não era "conteúdo errado", era "evento nunca chega": o código confundia
"filtrar o resultado" com "filtrar a existência da mensagem". O
`redactForAuthor` já resolvia exatamente esse problema para o *ack* do autor
(rolagem às cegas: volta sem `roll`) — só não era reaproveitado no broadcast
para os outros participantes.

## Correção

- **`redactMessage(msg)`** (novo, em `chatVisibility.ts`): tira
  `roll`/`item`/`text` de uma mensagem, incondicional. `redactForAuthor` passou
  a ser só esse `redactMessage` aplicado quando `messageVisibleTo` nega.
- **`emitChatMessage`**: para visibilidade `"gm"` ou `"self"`, manda a sala
  toda (`rooms.all`) receber a versão **redigida** (mesmo `id`) na hora da
  rolagem; em seguida manda a versão completa só pra quem tem permissão
  (`rooms.gm` ou `rooms.participant`), por cima, com o mesmo `id`. Para
  `"all"` continua um único emit, sem placeholder. `chat:reveal` já reusava
  essa função (só muda `visibility` para `"all"` e chama de novo), então
  continuou funcionando sem alteração.
- **`ChatTab.tsx`**: `msg.kind === "roll"` sem `msg.roll` agora renderiza um
  card compacto ("Fulano fez uma rolagem secreta/própria") em vez de cair no
  fallback de texto vazio. O GM tem o botão **Revelar** ali; quando ele clica,
  o upsert por `id` no client troca esse card pelo card de rolagem completo.
- **SPEC.md** (§3.4 e tabela de eventos) atualizado para descrever o
  placeholder em vez da omissão.

## Testes

`apps/server/src/services/chatVisibility.test.ts` ganhou um fake mínimo de
`TypedServer` (grava sala + mensagem de cada `emit`) e cobre `emitChatMessage`:

- **secreta**: sala toda recebe na hora sem `roll`; só a sala do GM recebe o
  resultado completo.
- **própria**: sala toda recebe sem `roll`; só a sala do autor recebe o
  resultado completo.
- **pública** (inclusive o estado pós-Revelar, já que reveal só muda
  `visibility` para `"all"` e chama a mesma função): um único emit, sala
  toda, resultado completo.

`make typecheck && make test` passam (server: 15 → 18 testes).

## Commits

- `a1478ab` — Corrige omissão de rolagem secreta: manda placeholder, não nada
  (server + testes)
- `eb34dc4` — Web: card de rolagem oculta no lugar do card cheio (UI + SPEC)
