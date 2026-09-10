# Fix: "não consigo mover o token no meu turno"

Dois relatos no mesmo teste (cenário `make seed-test`, combate ativo, na vez da Kael): o teclado
(setas/WASD) não movia ninguém — nem o Mestre — e só o arraste funcionava; e a jogadora Ana não
conseguia mover o token da Kael de jeito nenhum. Investigados juntos porque pareciam a mesma causa
("trava de movimento quebrada"); eram duas coisas bem diferentes.

## 1. Teclado não move ninguém (bug de verdade)

### Sintoma

Com um token selecionado, apertar seta/WASD não fazia nada — nem revertia, nem mostrava erro,
simplesmente não movia. Arrastar o mesmo token funcionava normalmente, para GM e para jogador.

### Causa

Arrastar um token **nunca exigiu selecioná-lo antes**: `handleTokenDragStart`
(`apps/web/src/components/VttCanvas.tsx`) move de cara qualquer token que a pessoa controla, seja
ele o único selecionado, um de vários, ou nenhum. O atalho de teclado
(`apps/web/src/lib/useTokenMoveShortcuts.ts`) sempre exigiu seleção prévia:

```ts
const { selectedIds, byId: tokensById } = useTokens.getState();
if (selectedIds.length === 0) return; // silencioso — sem toast, sem log, nada
```

Quem só arrasta os tokens para movê-los (o jeito mais natural de jogar, e o único testado no
relato) nunca deixa nada em `selectedIds` — então o teclado nunca vai fazer nada para essa pessoa.
Parecia "o teclado está quebrado"; na prática era o comportamento **desenhado** (o SPEC já dizia
"só com token selecionado", §9.11) sem nenhum aviso de que a condição não foi atendida.

Confirmado em navegador real (Edge headless via CDP, não só leitura de código): arrastei a Kael
sem clicar nela antes (`selectedIds` ficou `[]`), apertei seta, nada aconteceu — reproduzido de
forma limpa e isolada. Também testei `canMoveNow`/`canControl`/`checkMovement` com o token
efetivamente selecionado (GM e dona corretos, em combate ativo): o movimento e o desconto do
orçamento de deslocamento funcionaram certos nos dois casos — não havia bug de permissão ou de
orçamento ali.

### Correção

`useTokenMoveShortcuts.ts`: quando não há nada selecionado, mostra o toast **"Selecione um token
para mover com o teclado"** em vez de retornar em silêncio — um aviso por tecla segurada (reusa o
mesmo `warnedRef` do aviso já existente "Não é o seu turno", resetado no `keyup`). SPEC §9.11
ganhou uma frase explicando a diferença entre arraste (não exige seleção) e teclado (exige, e
agora avisa).

```ts
if (selectedIds.length === 0) {
  if (!warnedRef.current) {
    toast("Selecione um token para mover com o teclado");
    warnedRef.current = true;
  }
  return;
}
```

## 2. Ana não move o token da Kael (não era bug de código)

### Sintoma

A jogadora "Ana" (dona da ficha, segundo o cenário de teste) não conseguia mover o token da Kael
nem arrastando nem pelo teclado; só o Mestre conseguia. O Inspector do token mostrava o dono ora
como "Ana", ora vazio.

### Causa

Direto no Prisma: o `Token.ownerId` (e também o `Character.ownerId`) da Kael apontavam para uma
participante `"ana"` (minúscula, `sessionToken` aleatório, criada minutos depois do seed) — **não**
para a `"Ana"` (maiúscula) que `make seed-test` cria com `sessionToken` fixo. A sala tinha as duas:

```
Mestre   role=gm     sessionToken=mesa-de-teste-mestre-token   (do seed)
Ana      role=player sessionToken=mesa-de-teste-ana-token      (do seed)
ana      role=player sessionToken=<cuid aleatório>             (criada depois, ao vivo)
```

Isso acontece quando alguém abre o link puro (`/room/TESTE1`) **sem** aplicar antes o
`localStorage.setItem("tvtt:session:TESTE1:player", "mesa-de-teste-ana-token")` documentado em
`docs/testar-com-amigos.md` — o servidor, sem um `sessionToken` válido, cria uma jogadora nova
(`resolveParticipant`, `apps/server/src/socket/room.ts`) em vez de reconectar como a "Ana" do seed.
`canEditToken`/`canControl` (que checam `token.ownerId === participantId`) recusaram corretamente
uma não-dona — a lógica de permissão está certa; o estado do banco é que divergia do esperado.

### Correção

Nenhuma mudança de código. `make seed-test` apaga a sala de teste e recria do zero (inclusive as
duas "Ana"), então rodar de novo resolve. Se acontecer outra vez no meio de um teste (alguém
entrou sem o truque do `localStorage`), o Mestre reatribui o dono certo pelo Inspector do token
(e, se precisar, pelo campo "Dono" da ficha) sem precisar reiniciar nada.

## Testes

`make typecheck && make test` passam. Verificado ao vivo (Edge headless via CDP) depois da
correção: arrastar sem selecionar e depois apertar seta agora mostra o toast, em vez de não fazer
nada.

## Commit

- `c857902` — web: avisa quando WASD é apertado sem token selecionado (+ SPEC §9.11)
