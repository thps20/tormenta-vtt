# Três facilitadores de narração — plano

> Aguardando aprovação do dono do projeto antes de implementar. Este doc registra o plano
> combinado na conversa; depois de implementado, vira a base de um `docs/revisao-narracao.md`
> (mesmo padrão de `docs/plano-combate.md`/`docs/revisao-combate.md`).

Três funcionalidades pedidas juntas: notas do Mestre (persistidas, só GM), pinos no mapa
(GM cria, visibilidade por pino) e sussurro no chat (`/w`). Testes no shared/server para
visibilidade de nota, de pino e de sussurro. Ao final, atualizar `docs/SPEC.md`.

## Decisão tomada: unificar pino de handout com pino de nota

Hoje existe `HandoutPin` (Prisma) — pino no mapa que mostra imagem/texto de um Handout
(`visible`, soft delete, desfazer do GM). O pino de nota pedido é quase idêntico: geometria em
pixels do mapa, GM cria, `visible` (só GM / todos), soft delete, desfazer, clique abre um cartão.

**Decidido: unificar.** Renomear `HandoutPin` → `Pin` (Prisma + schema + eventos), com
`kind: "handout" | "note"` — em vez de manter dois sistemas de "marcador clicável no mapa" que só
divergiriam com o tempo (rendering, desfazer, permissão duplicados).

## 1. Notas do Mestre (persistidas, só GM)

**Modelo** (`packages/shared` + `prisma/schema.prisma`):
- `Scene.gmNotes: String?` — texto markdown leve, um bloco por mapa.
- `Token.notes: String?` — texto markdown leve, um bloco por token.

Nenhum dos dois é "regra de sistema" (não entra no `SystemDefinitionSchema`) — é dado de app,
como `Scene.name`. Ambos ficam de fora do `Scene`/`Token` que vai pro jogador (ver abaixo).

**Privacidade — ponto crítico**: `Token.notes` nunca pode chegar a um jogador, nem no dono do
token, nem em mapa ativo. Hoje o `Token` que o servidor manda pro jogador já passa por 3 pontos de
filtragem (todos já leem `viewer`): `emitTokenToPlayers` (broadcast ao vivo, `services/visibility.ts`),
`buildSnapshot` (room:join, `services/snapshot.ts`) e `scene:enter` (ack, `socket/scene.ts`). Vou
acrescentar uma função pura `redactTokenForViewer(token, viewer)` (mesmo estilo de `redactMessage`
em `chatVisibility.ts`) que zera `notes` quando `viewer.role !== "gm"`, aplicada nesses 3 pontos.
`Scene.gmNotes` é mais simples: o campo simplesmente não entra no `Scene` que o jogador recebe
(mesmo padrão de `deletedAt`, que já é "coluna só do banco, nunca serializada").

**Eventos**:
- `scene:set-notes { sceneId, notes }` (GM) → `scene:updated` (só GM recebe `gmNotes`).
- `token:update` já existe — `notes` entra como mais um campo do patch, restrito a GM (igual
  nome/cor/imagem: jogador não edita, servidor ignora se vier no patch dele).
- `notes:search { query }` (GM) → ack `{ items: [{ kind: "scene"|"token", sceneId, tokenId?, name, snippet }] }`:
  busca `contains` (case-insensitive) em `Scene.gmNotes` e `Token.notes` de toda a sala. Sem
  paginação (escala de uma mesa é pequena).

**Cliente**:
- Botão "Notas" na `TopBar` (só GM, só quando há mapa sendo visto) e um item "Notas do mapa" no
  menu ⋯ de cada card do `MapsPanel` (abre o mesmo painel, para aquele mapa específico, sem
  precisar estar vendo ele).
- Painel: textarea (autosave on-blur/debounce) + campo de busca no topo que lista resultados da
  sala inteira; clicar num resultado de mapa faz `scene:enter`/ativa a navegação, clicar num de
  token seleciona o token (abre `TokenInspector`).
- `TokenInspector`: novo campo "Notas" (textarea, GM only), abaixo de PV.
- `NpcQuickCard`: mesma textarea numa seção nova "Notas", entre Condições e o resto (já é
  GM-only, não precisa esconder nada extra ali).
- Indicador no canvas: um ponto/ícone discreto no canto do token quando `notes` não é vazio — só
  desenhado quando `me.role === "gm"` (o dado nem chega no cliente do jogador, mas deixo explícito
  por clareza).

**Testes**: `redactTokenForViewer` (puro), busca de notas (`notes:search` — uma função pura
`searchNotes` separada da query Prisma, testável sem banco quando possível).

## 2. Pinos no mapa (unificado: `Pin`, `kind: "handout" | "note"`)

**Modelo** (rename + extensão):
```prisma
model Pin {
  id        String    @id @default(cuid())
  sceneId   String
  kind      String    // "handout" | "note"
  x         Float
  y         Float
  visible   Boolean   @default(true)
  // kind: "handout" — igual ao HandoutPin de hoje
  handoutId String?
  name      String?
  imageUrl  String?
  width     Int?
  height    Int?
  text      String?
  // kind: "note" — novo
  title     String?
  noteText  String?
  icon      String?   // chave da lista do sistema (ou padrão embutido)
  color     String?
  deletedAt DateTime?
  createdAt DateTime  @default(now())
}
```
Migration: `ALTER TABLE "HandoutPin" RENAME TO "Pin"`, adiciona `kind` (backfill `'handout'` pros
existentes) + as colunas novas. `handoutId`/`name`/`imageUrl` viram opcionais (já eram
obrigatórios só pra `kind: "handout"`).

`packages/shared/src/schemas/pin.ts` (renomeia a parte de pino de `handout.ts`): `PinSchema`
discriminado por `kind`, reaproveitando os schemas de conteúdo que já existem
(`HandoutCardBaseSchema` etc.) e um novo bloco pra nota.

**Ícone/cor da lista do sistema**: mesmo padrão de `conditions[]` (SVG embutido, `color` hex) —
`SystemDefinition.pinIcons?: { key, label, icon, color }[]`, **opcional**. Sem ele no JSON, o
cliente usa uma paleta padrão embutida no código (mesmo espírito de `TOKEN_COLORS` no
`TokenInspector.tsx`: "só visual, não é regra de sistema" — ícone de pino não é uma regra de T20,
é mobília de app, então um default hardcoded no `web` é aceitável pela Regra nº 1; o campo do JSON
existe só pra uma mesa querer trocar por ícones com a cara do próprio sistema).

**Eventos** (substituem `handout:pin`/`unpin`):
- `pin:create` — `{ sceneId, x, y, visible } & ({ kind: "handout", handoutId } | { kind: "note", title, text, icon?, color? })`
  (GM) → `pin:created`.
- `pin:update` — `{ sceneId, pinId, patch: { title?, text?, icon?, color?, visible? } }` (GM, **só
  `kind: "note"`**) → `pin:updated`. Handout continua "apagar e fixar de novo" (cópia
  denormalizada, como hoje).
- `pin:remove` — `{ sceneId, pinId }` (GM) → `pin:removed`.

Todos entram no desfazer do GM (§9.6 do SPEC), mesmo mecanismo de hoje (`revert`/`apply`
alternando `deletedAt`, mais um `revert`/`apply` de campo pra `pin:update` de nota).

**Servidor**: renomeia `apps/server/src/services/handouts.ts` → parte pino vai pra
`services/pins.ts` (mantém `buildHandoutCard` como está, cria `buildNotePin`); `socket/handout.ts`
perde os handlers de pino, `socket/pins.ts` novo com os 3 acima. Broadcast: mesma regra de
sempre (GM sempre; jogador só se `visible` e mapa ATIVO).

**Cliente**:
- Ferramenta **"Pino" (atalho P)** na barra vertical (`store/tools.ts`: acrescenta `"pin"` a
  `ToolMode`; `useToolShortcuts.ts`: `p: "pin"`, não é GM-only — mas ao clicar no mapa só o GM de
  fato cria). Clique no mapa abre um popover pequeno: título + textarea + seletor de ícone/cor (da
  lista do sistema ou padrão) + toggle visibilidade → `pin:create`.
- Handout continua criável por arrastar o card da biblioteca pro mapa (`HandoutsPanel`), que agora
  emite `pin:create { kind: "handout", ... }`.
- `HandoutPinLayer` vira `PinLayer` (desenha os dois `kind`, ícone diferente por tipo); clique abre
  o cartão certo (`HandoutOverlay` pra handout, um `NotePinCard` novo, leve, pra nota — nome,
  ícone/cor, texto renderizado como markdown leve); botão direito apaga (GM); duplo clique ou um
  botão no cartão abre edição inline pra nota.
- `store/handouts.ts` → uma fatia `store/pins.ts` cobrindo os dois `kind`.

**Testes**: `packages/shared` — validação do `PinSchema` discriminado; servidor — permissão
(`gmOnly`), soft delete + desfazer, gate de visibilidade por mapa ativo (reaproveita os testes que
já existem pra `HandoutPin`, adaptados).

## 3. Sussurro no chat (`/w <nickname> <mensagem>`)

O campo `ChatMessage.whisperTo` **já existe** (usado hoje só por `handout:show`) e o gate
(`whisperGateOk`/`blockedPlayerIdsForWhisper` em `chatVisibility.ts`) já faz exatamente "só o GM e
o alvo recebem — nem card nem placeholder pros demais". Vou reaproveitar tal e qual: **o GM sempre
vê um sussurro** (mesma regra 3 de hoje), mesmo entre dois jogadores — é a postura padrão de VTTs
(Foundry inclusive) e evita ensinar uma segunda semântica de "sussurro" só pro chat. Assunção
registrada aqui — se o dono do projeto quiser sussurro cego pro próprio GM depois, revisitar.

**Schema**: `ChatSendSchema` ganha `whisperTo?: IdSchema.nullable()` opcional (além do
`text`/`visibility` que já tem).

**Comando `/w`** (`services/chatCommands.ts`): novo padrão `/^\/w\s+(\S+)\s+(.+)$/i` →
`{ kind: "whisper", targetNickname, text }`. No handler (`socket/chat.ts`), resolve nickname →
`participantId` (case-insensitive, dentre os participantes da sala; nickname não encontrado ou
duplicado → erro no ack pedindo pra usar o seletor). Cria `ChatMessage{kind:"text", visibility:"all", whisperTo}`
e publica com `emitChatMessage` (já pronto pro gate). Limitação assumida: nickname de uma palavra
só (sem espaço) — igual ao padrão de comando que já existe pra `/r`.

**Seletor "para"** (ao lado do `RollModeButton`, mesmo componente-base — portal, clique abre lista
de participantes): escolhe um alvo pontual pra a PRÓXIMA mensagem (texto ou rolagem — `/r`, faixa
de dados, botões da ficha); depois de enviar volta pra "todos" sozinho (não fica "grudado" como o
modo de rolagem, pra não sussurrar sem querer na mensagem seguinte). Quando há um alvo escolhido, o
campo do chat ganha destaque visual (mesmo tratamento de "fora de Pública" que já existe, cor
diferente) com "sussurrando para X".
`useChat().send` ganha um segundo parâmetro opcional `whisperTo`; quando setado, força
`visibility: "all"` no payload (o `whisperTo` já restringe quem recebe — mesma regra do
`handout:show`).

**Autocomplete Tab**: no `ChatTab`, ao digitar `/w <início-do-nick>` e apertar Tab, completa com o
primeiro nickname da sala que bate (case-insensitive) — mesmo espírito de completar comando, sem
componente novo, só um `onKeyDown` no input existente.

**Renderização**: mensagem com `whisperTo` ganha uma borda/fundo diferenciado (roxo, por exemplo) e
um rótulo "sussurro para X" (quem recebeu) ou "sussurro de X" (quando você é o alvo, mostra o
autor) — cálculo simples no `ChatTab` a partir de `msg.whisperTo`/`msg.participantId`/participantes.

**Testes**: `parseChatCommand` (novo caso `/w`), resolução de nickname (ambíguo/inexistente), e o
gate de visibilidade — já tem teste pra `whisperTo` via handout; adiciona um caso cobrindo o mesmo
gate vindo de `chat:send` (mensagem de texto comum, não só handout).

## Ordem de implementação

1. **Shared primeiro** (Regra nº 1 / convenção do projeto): schemas de `Pin`,
   `Scene.gmNotes`/`Token.notes`, `ChatSendSchema.whisperTo`, `SystemDefinition.pinIcons?`.
2. **Prisma**: migration única (rename `HandoutPin`→`Pin` + colunas de nota/notas) com
   `make db-migrate`.
3. **Servidor**: notas (scene + token + busca) → pinos (rename + kind note) → sussurro (mais
   simples, reaproveita infra existente).
4. **Web**: mesma ordem — painel de notas → ferramenta Pino + PinLayer/NotePinCard → seletor de
   sussurro + render no chat.
5. `docs/SPEC.md`: novo §9.16 (Notas do Mestre), reescreve §9.10 como "Handouts e pinos" cobrindo
   os dois `kind`, novo trecho em §3.4 pro sussurro.
6. `make typecheck && make test` no final de cada camada, não só no fim de tudo.
