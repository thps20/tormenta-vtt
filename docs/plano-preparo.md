# Preparo do mapa — acervo, passos e sons — plano

> Escrito em 17/09/2026, antes de qualquer código. Status: **aguardando aprovação do dono do
> projeto**. Depois de implementado, vira resumo em `docs/SPEC.md` (§9.24 Acervo, §9.25 Preparo,
> §9.26 Sons) e uma `docs/revisao-preparo.md`.

## Decisões confirmadas com o dono do projeto (17/09/2026)

- **Duplicar um mapa copia o preparo junto**, com tudo como pendente (§2.4).
- **Imagens já usadas** em mapas e tokens entram no acervo pela migration (backfill, §1.1).
- **Implementação só depois de o dono revisar o Cast**, que ainda está sem commit na árvore e
  mexe nos mesmos arquivos (`events.ts`, snapshot, `RoomPage`, SPEC).

A prateleira do Mestre para preparar a sessão, por mapa. Três peças que se apoiam:

| Peça | O que é | Onde |
|---|---|---|
| **Acervo** | Biblioteca única da sala: arquivos novos (imagem de mapa, arte de token, áudio) + o que já existe (handouts, encontros, criaturas da sala, macros do GM) | tabela `Asset` + `LibraryFavorite`; diálogo `LibraryDialog` |
| **Preparo** | Lista ordenada de passos por mapa; cada passo tem nota e itens que **apontam** pro acervo, com ação a um clique | tabela `PrepStep`; aba "Preparo" do painel lateral (só GM) |
| **Sons** | Trilha em loop + efeitos de uma vez, sincronizados pra todos | estado em memória no servidor; `AudioEngine` + `AudioPlayer` no web |

Nada disso é regra de RPG: é dado de app (como `Handout` e `Scene.gmNotes`), então **não** entra
no `SystemDefinitionSchema` nem nos JSONs de sistema.

**Princípio que atravessa tudo:** o preparo **nunca reimplementa** uma ação. Soltar um encontro,
mostrar um handout, rodar uma macro, trocar o fundo do mapa: o cliente chama a MESMA ação de store
que o botão manual já chama (`useEncounters.spawn`, `useHandouts.show`, `useMacros.run`,
`scene:setMap`...). É o mesmo desenho das macros (§9.20): permissão, desfazer e broadcast vêm de
graça, e não existe rota nova "por dentro" do preparo.

---

## 1. Acervo da sala

### 1.1 Decisão: arquivos novos numa tabela; o resto é referência, sem cópia

Os handouts, encontros, criaturas homebrew e macros **já têm tabela, tela e eventos próprios**.
Copiar tudo pra uma tabela nova de "acervo" duplicaria dado e criaria o problema de manter duas
cópias em sincronia. Então:

- **Tabela nova `Asset`** só para o que ainda não tem casa: imagem de mapa, arte de token, áudio.
- O acervo **mostra** handouts/encontros/criaturas/macros lendo das stores que já existem
  (`useHandouts.library`, `useEncounters.items`, `useCompendium` filtrado por `roomIds`,
  `useMacros`) — os broadcasts `handout:created`, `encounter:deleted` etc. já mantêm essas listas
  atualizadas, o acervo só junta tudo numa vista (`lib/library.ts#buildLibraryItems`, função pura
  testada).
- Criar um handout **a partir do acervo** chama o `handout:create` de sempre.

```prisma
/// Arquivo do acervo (docs/plano-preparo.md): o que o GM subiu e ainda não tinha tabela própria.
/// Handouts/encontros/criaturas/macros NÃO vêm pra cá — o acervo só os referencia.
model Asset {
  id         String    @id @default(cuid())
  roomId     String
  /// "map" | "token" | "audio". Imagem: o GM escolhe no upload (sugestão pelo tamanho) e pode trocar.
  kind       String
  name       String
  url        String    // "/uploads/<hex>.<ext>", mesmo formato de Scene.mapUrl
  width      Int?      // imagens
  height     Int?
  durationMs Int?      // áudio: lido pelo navegador ao subir (metadata do <audio>), só informativo
  tags       String[]  @default([])
  deletedAt  DateTime?
  createdAt  DateTime  @default(now())

  room Room @relation(fields: [roomId], references: [id], onDelete: Cascade)
  @@index([roomId])
}

/// Estrela do acervo (docs/plano-preparo.md). Tabela à parte (não uma coluna em cada tabela
/// referenciada) pra favoritar funcionar igual em Asset, Handout, SavedEncounter, criatura e macro
/// sem migrar quatro tabelas. É do GM da sala (não por participante, diferente de CompendiumFavorite).
model LibraryFavorite {
  roomId  String
  refKind String   // "asset" | "handout" | "encounter" | "creature" | "macro"
  refId   String
  createdAt DateTime @default(now())

  room Room @relation(fields: [roomId], references: [id], onDelete: Cascade)
  @@id([roomId, refKind, refId])
}
```

**Backfill na migration** ("tudo que o Mestre subiu"): as imagens que já estão em `Scene.mapUrl`
viram `Asset{kind:"map"}` (nome = nome do mapa) e as de `Token.imageUrl` viram `Asset{kind:"token"}`
(nome = nome do token), uma linha por URL distinta por sala. É um `INSERT ... SELECT DISTINCT` na
própria migration — nenhum arquivo é tocado.

### 1.2 Campos por item e o que fica de fora

Cada item do acervo mostra: **nome, tipo, tags, favorito, data**.

| Tipo | Fonte | Tags | Data |
|---|---|---|---|
| Mapa / Token / Áudio | `Asset` | próprias | `createdAt` |
| Handout | `Handout` | próprias | `createdAt` |
| Encontro | `SavedEncounter` | próprias | `createdAt` |
| Criatura | `RoomCompendiumEntry` (só **homebrew da sala**) | próprias | — (o compêndio não expõe data; ordena por nome) |
| Macro | `Macro` do **próprio GM** | não tem (documentado) | — |

- **Criaturas do sistema não entram na lista do acervo** (são centenas e afogariam o resto). Mas um
  passo do preparo pode apontar pra qualquer criatura (sistema ou sala) pelo seletor "Adicionar
  item", que usa a busca do compêndio que já existe.
- **Sem pastas, só tags** (pedido): uma pasta obriga a decidir "onde fica" cada coisa, e um mapa de
  masmorra é ao mesmo tempo "sessão 3" e "subterrâneo". Tags permitem as duas coisas sem hierarquia,
  e a busca/filtro já resolve o "achar". Se a biblioteca crescer a ponto de tags não bastarem, pastas
  podem ser adicionadas depois como uma tag especial, sem migrar dado. (Vai no SPEC.)
- Editar nome/tags no acervo: `Asset` por `asset:update`; handout/encontro pelos `*:update` que já
  existem. Criatura/macro: botão "Editar" abre a tela deles (editor do compêndio / criador de macro).

### 1.3 Upload

- `POST /api/upload` passa a aceitar também **áudio mp3/ogg**, mesmo limite de 20 MB do mapa.
  O tipo é conferido pelos **bytes iniciais** (`ID3`/frame MPEG, `OggS`), não só pelo mimetype que o
  navegador manda (alguns mandam `audio/mp3`, outros `audio/mpeg` — e o mimetype é declarado pelo
  cliente, não é prova). Resposta de áudio: `{ url, kind: "audio" }`; de imagem continua
  `{ url, width, height }`.
- Fluxo igual ao de handout: sobe o arquivo por HTTP → manda `asset:create { kind, name, url, ... }`
  pelo socket (fronteira Zod). A URL precisa ser `/uploads/...` (o schema recusa URL externa, pra
  ninguém "cadastrar" um link qualquer como áudio).
- **Arrastar arquivo pra dentro** do diálogo do acervo (drag-and-drop HTML5 nativo — aqui é arquivo
  do sistema operacional, não o arrasto interno por pointer events) sobe vários de uma vez, com
  barra de progresso por arquivo. Imagem: sugestão automática de tipo (lado maior ≥ 1000 px → mapa;
  senão token), editável na fila antes de confirmar.

### 1.4 Eventos (`packages/shared/src/events.ts` + `schemas/library.ts`)

Todos **gmOnly**, broadcast só pra `rooms.gm` (mesmo desenho de `handout:*`):

- `asset:list {}` → `Asset[]`; `asset:create`; `asset:update { id, patch: { name?, tags?, kind? } }`
  (`kind` só entre `map`↔`token`); `asset:delete { id }` → soft delete + **entrada de desfazer**.
- `library:favorites {}` → `{ refKind, refId }[]`; `library:favorite-set { refKind, refId, favorite }`.
- Broadcasts: `asset:created/updated/deleted`, `library:favoritesChanged`.

### 1.5 Busca, filtro e arrastar pro mapa

- `LibraryDialog` (TopBar, botão "Acervo", atalho **B** — confirmar que está livre): busca por nome
  e tags, chips de tipo, chips de tag, "só favoritos". Visual de grade reaproveitando os cards e o
  `AnchoredMenu` da `HandoutGallery`.
- **Arrastar um item pro mapa** usa o `lib/dropTargets.ts` que já existe. O truque de reaproveitar:
  o arrasto do acervo entrega ao alvo **o objeto original** (o `Handout`, o `SavedEncounter`, a
  `CompendiumEntry`) — os três registros que o `VttCanvas` já tem no id `"map"` reconhecem pela forma
  e fazem o que já fazem hoje (fixar pino, soltar encontro, soltar criatura). Só entram **registros
  novos** para o que é novo:
  - `Asset{kind:"token"}` → `token:create` no ponto (imagem = a arte, nome = nome do asset).
  - `Asset{kind:"map"}` → pergunta "Usar como fundo deste mapa?" → `scene:setMap` (mesmo evento do
    `MapConfigModal`).
  - `Asset{kind:"audio"}` → "Adicionado ao preparo" no **passo selecionado** do mapa visto (ou cria
    "Passo 1" se não houver passo).
  - Macro não é arrastável pro mapa (não tem "lugar" no mapa) — só pro preparo.
- A lógica de estado do arrasto vira um hook genérico (`useLibraryDrag`), extraído do que
  `useHandoutDrag` e a paleta já repetem (limiar de 4 px, Esc cancela, fantasma).

---

## 2. Preparo do mapa

### 2.1 Modelo

```prisma
/// Passo do preparo de um mapa (docs/plano-preparo.md). Só o GM vê — NUNCA sai no Scene serializado.
model PrepStep {
  id        String    @id @default(cuid())
  sceneId   String
  order     Int       @default(0)   // renumerado 0..n-1 a cada reorder (mesmo padrão de Scene.order)
  title     String
  notes     String    @default("")  // markdown leve (ver 2.5)
  /// PrepItem[] (ver PrepItemSchema): lista pequena, sempre reescrita inteira — mesmo raciocínio de
  /// Room.party. Json porque o formato de referência vai evoluir sem migration.
  items     Json      @default("[]")
  used      Boolean   @default(false)
  deletedAt DateTime?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  scene Scene @relation(fields: [sceneId], references: [id], onDelete: Cascade)
  @@index([sceneId])
}
```

**Por que passo é linha e item é Json:** passo precisa de soft delete e ordem independentes (apagar
um passo e desfazer), então é linha — mesmo padrão de `Pin`. Itens são poucos por passo e sempre
editados junto do passo; como Json, reordenar/mover item é reescrever uma lista, sem N updates.
O servidor faz toda alteração de item dentro de uma transação que relê a linha antes de reescrever
(nunca confia numa lista inteira vinda do cliente), então duas abas do GM não se atropelam.

```ts
// packages/shared/src/schemas/prep.ts
PrepRef = discriminatedUnion("kind", [
  { kind: "asset",     assetId },      // mapa, token ou áudio
  { kind: "handout",   handoutId },
  { kind: "encounter", encounterId },
  { kind: "creature",  entryId },      // compêndio (sistema ou sala)
  { kind: "macro",     macroId },      // macro do próprio GM
  { kind: "pin",       pinId },        // pino de nota do mapa
  { kind: "npc",       characterId },  // ficha de NPC
  { kind: "note",      text },         // lembrete solto (sem referência): o único item que não aponta pra nada
])

PrepItem = {
  id, ref: PrepRef,
  used: boolean,
  auto: boolean,        // entra no "Iniciar este passo"
  options: {            // só os que fazem sentido pro tipo; o resto é ignorado
    hidden?: boolean,           // encontro/criatura: soltar invisível
    count?: 1..20,              // criatura
    audioMode?: "loop" | "once",// áudio (padrão: loop = trilha)
    showTo?: "all",             // handout (só "todos" nesta versão)
  }
}
```

"Nota" do pedido = pino de nota do mapa (`pin`) **ou** lembrete solto (`note`); "ficha de NPC" =
`npc`. Nota do mapa (`Scene.gmNotes`) não vira item: ela já é do mapa inteiro, e o painel mostra um
atalho pra ela no topo.

### 2.2 Ação principal por tipo (um clique)

| Tipo | Ação | Chama (já existe) |
|---|---|---|
| Asset mapa | **Usar como fundo** (confirma) | `scene:setMap` |
| Asset token | **Soltar** no centro da tela | `token:create` |
| Asset áudio | **Tocar** (loop ou uma vez) | `audio:play` (novo, §3) |
| Handout | **Mostrar para todos** (secundária: fixar) | `useHandouts.show` / `pin:create` |
| Encontro | **Soltar** (visível ou invisível) no centro da tela | `useEncounters.spawn` |
| Criatura | **Soltar** N cópias | `compendium:spawn-creature` |
| Macro | **Rolar** | `useMacros.run` |
| Pino | **Abrir** (centraliza + abre o cartão) | local |
| NPC | **Abrir** a ficha | local |
| Nota solta | — (só texto) | — |

Soltar **invisível um encontro inteiro** hoje não existe (cada linha do encontro tem o seu
`visibleOnSpawn`). Ampliação pequena: `encounter:spawn` ganha `forceHidden?: boolean`, que só
**esconde** (nunca revela o que foi salvo invisível).

"Centro da tela" = mesmo ponto de soltar uma criatura sem arrastar (`getViewportCenter`). Guardar um
ponto fixo no mapa por item fica **fora** desta versão.

### 2.3 Estado usado/pendente, iniciar e reiniciar

- **Item usado** automaticamente quando a ação dá certo (depois do ack): o cliente chama
  `prep:item-set-used`. Também dá pra marcar/desmarcar à mão. Ação que falhou não marca.
- **Passo usado**: marcado ao terminar "Iniciar este passo", ou à mão. O card mostra também o
  progresso derivado ("3/5 itens usados").
- **Iniciar este passo**: diálogo de confirmação listando, em ordem, os itens com `auto: true`
  ("▶ Tocar *Taverna* (loop) · 👁 Mostrar *Carta do duque* · ⚔ Soltar *Emboscada* invisível").
  Confirmar executa **em sequência** (espera cada ack). Se um falhar, **continua** os outros e mostra
  um resumo no fim ("2 de 3 deram certo: *Emboscada* — encontro apagado"). Referência quebrada é
  pulada e listada. A execução é do cliente (mesmo princípio das macros).
- **Reiniciar preparo**: zera `used` de todos os passos e itens do mapa (`prep:reset`), com
  confirmação, e **entra no desfazer** (é barato guardar os flags de antes e evita um clique errado
  perder o andamento da sessão).

### 2.4 Editar, reordenar, duplicar, copiar

Eventos (todos **gmOnly**, broadcast `prep:stepUpserted`/`prep:stepRemoved`/`prep:reordered` só pra
`rooms.gm`):

- `prep:list { sceneId }` → `PrepStep[]` — carregado sob demanda quando a aba abre (como as notas).
- `prep:step-create { sceneId, title, afterStepId? }`; `prep:step-update { stepId, patch: { title?, notes?, used? } }`.
- `prep:step-delete { stepId }` → soft delete + **desfazer**.
- `prep:step-reorder { sceneId, stepIds }` (permutação exata, mesmo padrão de `scene:reorder`).
- `prep:step-copy { stepId, targetSceneId }` → mesmo mapa = **duplicar** (entra logo depois do
  original, título "(cópia)"); outro mapa = **copiar** pro fim da lista de lá. A cópia sempre volta
  a "pendente". Referências são copiadas como referências (nada duplicado no acervo). Pino é de um
  mapa só: copiado pra outro mapa, aparece como quebrado — avisado no ack.
- `prep:item-add { stepId, ref, index? }`; `prep:item-update { stepId, itemId, patch: { auto?, options?, used? } }`;
  `prep:item-remove { stepId, itemId }` → **desfazer** (restaura na mesma posição);
  `prep:item-move { stepId, itemId, toStepId, index }` (reordenar dentro do passo ou mover entre passos).
- `prep:reset { sceneId }` → **desfazer**.

Reordenar arrastando: mesmo padrão de pointer events + "linha fantasma" de `MapsPanel`/`MacroBar`
(já usado duas vezes no projeto), não uma lib nova.

**Duplicar um mapa** (`scene:duplicate`) passa a copiar o preparo junto, tudo como pendente.
**Apagar um mapa** não mexe nos passos (ficam presos ao mapa apagado e voltam com o desfazer; a
limpeza de 30 dias leva junto por cascade).

### 2.5 Nota em markdown leve

Hoje "markdown leve" no projeto significa texto puro (`pre-wrap`). Pro preparo, que é lido **durante
a sessão**, vale um renderizador mínimo: `**negrito**`, `*itálico*`, `# título`, listas `-`/`1.`,
`> citação`. Função pura em `packages/shared` (`rules/lightMarkdown.ts`, testada) que devolve uma
árvore simples, e o React monta os elementos — **sem** `dangerouslySetInnerHTML`, então não existe
risco de HTML injetado. Edição: textarea que salva ao sair do campo (igual `NotesPanel`); leitura:
renderizado. (Aplicar o mesmo às notas do Mestre existentes fica pra depois, se quiser.)

### 2.6 Referência quebrada

Nada some em silêncio: o painel resolve cada `PrepRef` contra as stores carregadas
(`lib/prep.ts#resolvePrepRef`, pura e testada). Se não achar, o item fica com borda vermelha,
ícone de corrente partida, o **último nome conhecido** e o texto "Apagado do acervo", ação
desabilitada e botão "Remover do passo". Pra ter o nome mesmo depois de apagado, `PrepItem` guarda
`label` (cópia do nome no momento de adicionar — só pra exibir, nunca usado pra executar).
Desfazer o apagar no acervo "conserta" a referência sozinho (o id volta a existir).

### 2.7 UI

- **Aba "Preparo"** no `SidePanel`, **só para o GM** (jogador nem vê a aba). Mostra o preparo do
  **mapa que o GM está vendo**; trocar de mapa troca a lista.
- Topo: nome do mapa, atalho "Notas do mapa", progresso, "Reiniciar preparo", "+ Passo".
- Card de passo (recolhível): título editável, nota, itens, "Iniciar este passo", menu ⋯ (duplicar,
  copiar para outro mapa ▸ lista de mapas, marcar usado/pendente, apagar).
- Item: ícone do tipo, nome, marcador automático (⚡ liga/desliga), estado (bolinha vazia / check),
  botão da ação principal, menu ⋯ (opções do tipo, marcar usado, remover).
- "+ Item": seletor com busca sobre o acervo **inteiro** + criaturas do sistema + pinos do mapa +
  NPCs + "Lembrete". Também dá pra **arrastar do acervo** direto pra um passo (alvo de soltura
  novo `prep-step:<id>` no mesmo `dropTargets`).

---

## 3. Sons

### 3.1 Estado (servidor, em memória)

Mesmo padrão do blackout do Cast (`services/display.ts`) e dos gabaritos: estado de sessão por
sala, em memória — se perde num restart, o que é aceitável pra música ambiente.

```ts
AudioState = {
  track: null | {
    assetId, url,           // url sem nome: jogador nunca recebe o nome do arquivo
    loop: boolean,
    playing: boolean,
    positionMs: number,     // posição no instante `at`
    at: number,             // relógio do servidor (Date.now()) em que positionMs valia
  }
}
```

- **Posição atual sem timer no servidor**: tocando, a posição "agora" é
  `positionMs + (agoraServidor − at)` (em loop, módulo a duração, que o navegador conhece). Pausar
  grava a posição calculada e `playing:false`. Função pura `trackPositionMs` no shared, testada.
- **Relógio**: o snapshot e todo `audio:state` levam `serverNow`; o cliente guarda a diferença pro
  próprio relógio (`skew`). Não precisa ser perfeito — ~100 ms de erro numa trilha ambiente não se
  nota; a correção só "pula" se o áudio local desviar mais de 1 s.
- **Uma trilha por vez** (repetir) + **efeitos** (tocar uma vez) por cima, sem cortar a trilha.
  Efeito é fogo-e-esquece (`audio:effect { url }`), não entra no estado nem no snapshot: quem entra
  depois não ouve efeito que já passou. Não é mixagem — só não parar a música por causa de um grito.

### 3.2 Eventos

- GM (**gmOnly**): `audio:play { assetId, loop }` (troca a trilha e começa do 0), `audio:pause`,
  `audio:resume`, `audio:stop`, `audio:seek { positionMs }` (fica disponível pro player, não é
  obrigatório na UI), `audio:effect { assetId }`.
- Broadcast pra **todos** (`rooms.all`, inclui as telas do Cast): `audio:state { state, serverNow }`
  e `audio:effect { url }`. O servidor resolve `assetId → url` (confere sala/`deletedAt`) — o
  cliente nunca manda URL.
- `RoomSnapshot.audio` (todos) e `DisplaySnapshot.audio` (tela do Cast): entra no meio da trilha.

### 3.3 Cliente

- `store/audio.ts` (estado sincronizado) + `lib/audioEngine.ts` (dois `HTMLAudioElement`: trilha e
  efeitos; fora do React, como o `DiceOverlay3D` faz com o dado 3D).
- **Volume e silenciar por usuário** em `localStorage` (`tvtt:audio`, validado com Zod como
  `tabletopPrefs`), não por sala. Um botão de alto-falante na TopBar pra todo mundo (volume +
  silenciar tudo). O volume do GM no player é **o volume dele**, igual ao de qualquer um — não
  existe volume "pra mesa" (seria mixagem).
- **Autoplay bloqueado**: `audio.play()` rejeita com `NotAllowedError` → a store marca `blocked` e
  aparece um aviso discreto "🔇 Clique para ativar o som"; o primeiro clique/tecla em qualquer lugar
  da página tenta de novo (e recalcula a posição, então entra no ponto certo). Nada mais quebra: o
  resto da sala continua funcionando normal sem som.
- **Player do GM** (TopBar, só GM): nome da trilha, ▶/⏸, ⏹, alternar repetir, volume. Tocar algo é
  pelo acervo ou pelo preparo; o player só controla o que está tocando.
- Tela do Cast toca também (recebe `rooms.all`) — dá pra silenciar lá como em qualquer navegador.

### 3.4 Permissões e vazamento

Jogador recebe só `url` + `playing/loop/posição`. Nunca `assetId`, nunca nome. A URL é o nome
aleatório de upload (`<hex>.mp3`), igual à imagem de mapa que o jogador já recebe hoje.

---

## 4. Permissões e desfazer (resumo)

- **Todo** `asset:*`, `library:*`, `prep:*` e os comandos `audio:*` são `gmOnly` no servidor (não só
  escondidos na UI). Broadcasts de acervo/preparo vão só pra `rooms.gm`. Nada disso entra no
  snapshot de jogador nem no `Scene` serializado. A tela do Cast (`isDisplayAllowedEvent`) não ganha
  nenhum evento novo permitido.
- Teste de servidor dedicado: um socket de jogador chamando cada evento novo recebe "Apenas o GM" e
  nenhum broadcast `asset:*`/`prep:*` chega na sala de jogadores.
- **Desfazer** (`pushEntry`, mesmo padrão de `buildHandoutDeleteHistoryEntry`): apagar asset, apagar
  passo, remover item, reiniciar preparo. Resumos: "apagar do acervo *Taverna.mp3*", "apagar passo
  *Chegada ao porto*", "remover *Emboscada* do passo", "reiniciar preparo de *Porto*".
- Limpeza de 30 dias (`services/cleanup.ts`): ganha `Asset` e `PrepStep` apagados (arquivo em disco
  continua sem limpeza, mesma limitação de hoje, §8).

---

## 5. Etapas (um commit por etapa, `make typecheck && make test` em cada)

1. **shared**: schemas (`library.ts`, `prep.ts`, `audio.ts`), eventos, funções puras
   (`buildLibraryItems`, `resolvePrepRef`, `trackPositionMs`, `lightMarkdown`, ordenação de
   passos/itens) + testes.
2. **server — acervo**: migration (`Asset`, `LibraryFavorite`, backfill), upload de áudio,
   `asset:*`/`library:*`, desfazer, limpeza + testes.
3. **server — preparo e sons**: migration (`PrepStep`), `prep:*`, `scene:duplicate` copiando
   preparo, `encounter:spawn.forceHidden`, `audio:*` + snapshot + testes (inclusive o de permissões).
4. **web — acervo**: store, `LibraryDialog` (busca/filtros/favoritos/upload arrastando),
   arrastar pro mapa.
5. **web — preparo**: aba "Preparo", itens e ações, iniciar/reiniciar, reordenar, duplicar/copiar,
   referências quebradas.
6. **web — sons**: engine, player do GM, volume/silenciar, aviso de autoplay, tela do Cast.
7. **SPEC** (§9.24–9.26, §4, §5, §8) + `docs/revisao-preparo.md` com teste no navegador (GM +
   jogador em duas janelas: jogador não recebe nomes/lista, entra no meio da trilha, aviso de
   autoplay).

## 6. Fora desta versão (registrar no SPEC §8)

Pastas; playlists, fade, mixagem, volume por trilha; ponto fixo de soltura por item; mostrar
handout "para X" pelo preparo; limpeza de arquivo órfão em disco; criaturas do sistema listadas no
acervo; markdown nas notas do Mestre antigas; estado de áudio sobreviver a restart do servidor.
