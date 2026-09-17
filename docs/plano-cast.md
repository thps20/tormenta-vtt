# Cast — tela de exibição para a mesa física — plano

> Aguardando aprovação do dono do projeto antes de implementar. Depois de implementado, vira a base
> de um `docs/revisao-cast.md` (mesmo padrão de `plano-narracao.md`/`revisao-narracao.md`).

Uma segunda tela (TV, monitor deitado ou projetor sobre a mesa) que mostra só o mapa, do ponto de
vista de um jogador, enquanto o Mestre opera no notebook. O foco principal é o **modo mesa física**:
1 célula do grid = N cm reais, pra usar miniaturas por cima da projeção.

Resumo das peças:

| Peça | Onde |
|---|---|
| Token de exibição (gerar/revogar) | `Room.displayToken` (Prisma) + eventos `display:*` |
| Socket "de exibição" (não é participante) | `socket/display.ts` + trava em `socket/index.ts` |
| Filtro como jogador | reaproveita `tokenVisibleTo`, `pinVisibleTo`, `drawingVisibleTo`, `toCombat`... com um *viewer* sintético |
| Contas de escala física/câmera | `packages/shared/src/rules/tabletop.ts` (puro, testado) |
| Tela de exibição | `components/cast/DisplayPage.tsx` reaproveitando `VttCanvas` em modo somente leitura |
| Barra do Mestre | `components/cast/CastMenu.tsx` na `TopBar` (link, modo de câmera, miniatura, Centralizar aqui) |

Nada disso é regra de RPG: é dado de app (como `Scene.name`), então **não** entra no
`SystemDefinitionSchema` nem nos JSONs de sistema.

---

## 1. Servidor: quem é a tela de exibição

### 1.1 Decisão: a tela NÃO é um `Participant`

A tela entra por um evento próprio (`display:join`) e nunca cria linha em `Participant`. Com isso,
de graça:
- não aparece na lista de participantes nem na presença (`services/presence.ts` nunca é chamado);
- não conta como jogador no combate, na visão de grupo, nos alvos, nos sussurros (todos esses
  laços fazem `prisma.participant.findMany`, e a tela não está lá);
- não tem ficha, macro, favorito.

**Por quê:** a alternativa (criar um participante "fantasma" com uma flag) obrigaria a lembrar de
filtrar essa flag em cada lugar que lista participantes — hoje são ~10, e todo recurso novo seria
uma chance de vazar a tela como "jogador". Não existir no banco é a garantia mais forte.

### 1.2 Token de exibição

```prisma
model Room {
  // ...
  /// Token do link de Cast (docs/plano-cast.md): `/room/<código>?display=<token>`. Um por sala —
  /// gerar de novo substitui (o link antigo para de funcionar na hora); null = Cast desligado.
  /// NUNCA sai em `toRoomPublic`; só vai ao GM (snapshot do GM e ack de display:create-token).
  displayToken String? @unique
}
```

- **Um token por sala**, não uma tabela: o caso de uso é "uma tela na mesa". Se um dia precisar
  de duas telas com links diferentes, vira tabela — não vale a complexidade agora. (Duas abas com
  o **mesmo** link funcionam normalmente.)
- Gerado com `crypto.randomBytes(24).toString("base64url")` (32 caracteres, inadivinhável).
  Comparação com `timingSafeEqual` (mesma ideia de comparar senha: não vaza pelo tempo de resposta).
- Migration: `make db-migrate` com nome `add_room_display_token`.

### 1.3 Eventos novos (`packages/shared/src/events.ts` + `schemas/display.ts`)

Cliente → Servidor:

| Evento | Quem | Payload | Efeito |
|---|---|---|---|
| `display:join` | tela | `{ inviteCode, displayToken }` | valida token → ack `DisplaySnapshot` |
| `display:create-token` | GM | `{}` | gera/substitui token; derruba telas do token antigo; ack `{ displayToken }` |
| `display:revoke-token` | GM | `{}` | `displayToken = null`; derruba telas; ack `{}` |
| `display:set-camera-mode` | GM | `{ mode: "follow" \| "auto" \| "free" }` | guarda em memória, broadcast `display:cameraModeChanged` (GM + telas) |
| `display:view` | GM | `{ reason: "follow" \| "center", sceneId, x, y, viewWidth, viewHeight }` | repassa às telas (efêmero, sem banco) |
| `display:preview` | GM | `{ on: boolean }` | liga/desliga o envio de miniatura (ver §5) |
| `display:frame` | tela | `{ dataUrl }` (JPEG, ≤ 150 KB) | repassa ao GM |

Servidor → Cliente:

| Evento | Para | Payload |
|---|---|---|
| `display:view` | telas | mesmo do C→S |
| `display:cameraModeChanged` | GM + telas | `{ mode }` |
| `display:presence` | GM | `{ count }` — quantas telas conectadas (pro GM saber que está no ar) |
| `display:previewDemand` | telas | `{ on }` |
| `display:frame` | GM | `{ dataUrl }` |
| `display:revoked` | telas | `{}` — enviado logo antes de desconectar, pra tela mostrar "Link revogado" |

`display:view` usa **coordenadas em pixels do mapa** (centro `x,y` + tamanho da área visível
`viewWidth×viewHeight`), nunca em pixels de tela — as duas telas têm tamanhos diferentes, e é a
regra do projeto para coordenadas.

Modo de câmera e contagem de telas ficam **em memória** (`services/display.ts`), mesmo padrão de
`movementLimit.ts`/`presence.ts`: não sobrevivem a restart, e tudo bem (padrão volta a "seguir o
Mestre").

### 1.4 Salas de broadcast e o *viewer* sintético

Ao entrar, o socket da tela:
- recebe `socket.data = { roomId, participantId: DISPLAY_VIEWER_ID, role: "player", nickname: "",
  isDisplay: true }` — `DISPLAY_VIEWER_ID = "display"` é uma string que nunca é um cuid, então nunca
  é `ownerId` de token nem autor de nada;
- entra em `rooms.all(roomId)`, `rooms.players(roomId)` e numa sala nova `rooms.display(roomId)`.

**Por quê entrar em `players`:** os broadcasts de token/névoa/gabarito/desenho/pino para jogadores
já vão para essa sala, e o `emitTokenToPlayers` já manda a versão "jogador que não é o dono" para
quem está nela — que é exatamente o que a tela deve ver. Reaproveita o filtro inteiro sem tocar nele.

Pontos que hoje mandam uma cópia **por participante** (laço em `participant.findMany`) e precisam
de uma linha a mais para a tela:
- `services/combat.ts#emitCombat`: além do laço, `io.to(rooms.display(roomId)).emit("combat:updated",
  toCombat(row, def, displayViewer, geom))`. Sem isso a tela não saberia de quem é o turno.
- Chat, alvos, handouts e sussurros **não** ganham essa linha: a tela não mostra nada disso. (O chat
  ainda chega via `rooms.all`, já redigido como para qualquer jogador; o cliente da tela ignora.)

### 1.5 Somente leitura garantido no servidor

Duas travas, pra não depender de cada handler lembrar:
1. **Middleware por socket** em `socket/index.ts` (`socket.use`): se `socket.data.isDisplay`, só
   deixa passar eventos de uma lista explícita (`DISPLAY_ALLOWED_EVENTS`: `display:join`,
   `display:frame`, `scene:enter` — este último só lê e é o que o cliente usa quando o mapa ativo
   muda). Qualquer outro evento responde `{ ok:false, error: "Tela de exibição é somente leitura" }`.
   A lista é uma função pura `isDisplayAllowedEvent(name)`, testada.
2. `guarded(..., { gmOnly })` já recusa por `role !== "gm"`; a tela é `role: "player"`.

`room:join` também recusa um socket que já é tela (e vice-versa), pra ninguém "promover" a conexão.

`leaveCurrentRoom` (room.ts) ganha um desvio: socket de tela não chama `removeSocket` nem emite
`room:participantLeft`; só atualiza `display:presence` para o GM.

### 1.6 Snapshot da tela

`buildSnapshot(room, me)` passa a receber o *viewer* separado do participante:
`buildSnapshot(room, { viewer, me: DbParticipant | null })`. Para a tela:
- `me` = participante sintético `{ id: "display", nickname: "Tela da mesa", role: "player", connected: true }`
  (só no payload — o web inteiro assume `me` não nulo, então evita espalhar `if` pelo cliente);
- `sessionToken: ""`, `chat: []`, `targets: []`, `macros: []`, `favoriteEntryIds: []`;
- `participants` normal (a tela precisa saber quem é jogador pro enquadramento automático — é a
  mesma lista que qualquer jogador vê, sem segredo);
- `displayToken` **nunca** (só no snapshot do GM, campo novo opcional `cast: { displayToken, cameraMode, displayCount }`).

`DisplaySnapshot = RoomSnapshot & { cameraMode }`. Mesmo formato → as stores do web hidratam sem
código novo.

### 1.7 Testes do servidor (`services/display.test.ts`, funções puras, sem banco — padrão do repo)

- **Token:** `generateDisplayToken()` tem 32 chars base64url e não repete; `displayTokenMatches(room,
  token)` aceita o certo, recusa errado, recusa tamanho diferente, recusa quando `room.displayToken`
  é null.
- **Revogação/rotação:** `applyRevoke(room)` → token null → `displayTokenMatches` recusa o antigo;
  `applyRotate` → antigo recusado, novo aceito.
- **Filtro como jogador** (com `displayViewer()`):
  - `tokenVisibleTo`: token invisível → false; token sob névoa → false; token visível revelado →
    true; token **com dono** sob névoa → false (a tela nunca é dona);
  - `redactTokenForViewer`: `hasNotes` sai false;
  - `pinVisibleTo`: pino "só GM" → false; `drawingVisibleTo`: desenho "só GM" → false;
  - `toCombat`: combatente de token invisível não aparece; iniciativa de rolagem às cegas escondida;
  - `messageVisibleTo`: rolagem "gm" e "self" → false (mesmo sem chat na tela, garante que o viewer
    sintético nunca é tratado como autor);
  - `partyFor(..., "player")`: nenhum item `hidden`.
- **Somente leitura:** `isDisplayAllowedEvent` → true para `display:join`/`display:frame`/`scene:enter`;
  false para `token:update`, `chat:send`, `fog:update`, `display:create-token`, `display:view`.
- **Estado em memória:** modo padrão `follow`; `setCameraMode` muda só a sala certa.

---

## 2. Shared: contas de escala física e câmera (`rules/tabletop.ts`)

Tudo puro, testado em `rules/tabletop.test.ts`. O web só mede tela e chama isto.

```ts
/** Pixels (CSS) por centímetro projetado, por largura total da tela. */
pxPerCmFromWidth(screenWidthPx: number, projectedWidthCm: number): number
/** Mesma coisa pela régua: distância entre as duas alças arrastadas sobre a fita métrica. */
pxPerCmFromRuler(a: Point, b: Point, cm: number): number
/** Zoom do Stage para 1 célula = cellCm. cellSizePx = effectiveCellSize(grid) do mapa. */
tabletopZoom({ pxPerCm, cellCm, cellSizePx }): number        // = pxPerCm * cellCm / cellSizePx
/** Tamanho útil do viewport em "orientação do mapa": 90/270 trocam largura e altura. */
rotatedViewport({ width, height }, rotation: 0|90|180|270): { width, height }
/** Seguir o Mestre: mesmo centro; zoom que CONTÉM a área dele (ou o zoom travado, se houver). */
followCamera(view: DisplayView, viewport, lockedZoom?: number): { center, zoom }
/** Automático: enquadra retângulos de interesse com margem, respeitando zoom travado e zona morta. */
autoCamera({ focus, context, viewport, current, lockedZoom?, deadZone }): { center, zoom } | null
/** Mesa física: arredonda o pan para células inteiras (as linhas projetadas não "escorregam"). */
snapCenterToCells(center, cellSizePx): Point
```

**Testes** (o pedido): `tabletopZoom` com números redondos (tela 1920 px = 96 cm → 20 px/cm; célula
2,5 cm = 50 px de tela; mapa com cellSize 100 → zoom 0,5); mapa com grid "none" (célula virtual de
70 px); `pxPerCmFromRuler` com alças na diagonal; entradas inválidas (0, negativo, NaN) lançam;
`rotatedViewport` troca eixos em 90/270; `followCamera` com zoom travado ignora o zoom do Mestre e
mantém o centro; `autoCamera` retorna `null` quando o foco já está dentro da zona morta (não mexe);
foco maior que a tela com zoom travado prioriza o combatente da vez; `snapCenterToCells`.

**Nota sobre a medida:** usamos pixels **CSS** (o que o Konva usa), não pixels físicos do monitor.
Zoom do navegador ou escala do Windows mudam essa relação — por isso a calibração mede a projeção
real em vez de confiar em DPI, e o painel avisa "recalibre se mudar a resolução/zoom do navegador".

Schemas Zod novos (`schemas/display.ts`): `DisplayCameraModeSchema`, `DisplayJoinSchema`,
`DisplayViewSchema`, `DisplayFrameSchema` (regex `^data:image/jpeg;base64,` + tamanho máximo) e
`TabletopPrefsSchema` (usado pelo web pra validar o que lê do localStorage — localStorage também é
fronteira: pode estar corrompido ou ser de uma versão antiga).

---

## 3. Web: a tela de exibição

### 3.1 Rota

`lib/router.ts`: `Route` ganha `{ name: "display"; inviteCode; displayToken }` quando a URL tem
`?display=`. `App.tsx` renderiza `<DisplayPage>` **sem** `<Toasts>`. `store/ui.ts#push` passa a
checar uma flag `displayMode`: se ligada, só `console.warn` (pedido: erros só no console).

O token **não** é gravado no localStorage (diferente de `?session=`): o link é a credencial, e
revogar precisa funcionar mesmo que a tela recarregue.

### 3.2 `DisplayPage` — reaproveitando o `VttCanvas`

**Decisão: reaproveitar o `VttCanvas` com props novas, não criar um canvas separado.** Névoa,
gabaritos, desenhos, marcadores de condição, tokens com imagem, grid por mapa — tudo já está lá
(3 mil linhas). Um canvas paralelo divergiria na primeira mudança visual.

Props novas no `VttCanvas` (todas opcionais, padrão = comportamento atual):
- `readOnly`: `Stage listening={false}` (o Konva nem calcula clique), sem HUD inferior, sem dicas de
  ferramenta, sem teclado, sem drop de compêndio/handout, sem `saveView` no sessionStorage;
- `controlledView?: { center: Point; zoom: number }`: quando presente, o enquadramento vem de fora
  (a câmera da tela), com transição suave de ~400 ms (tween do Konva no Stage, não re-render por frame);
- `labelScale?: number`: multiplica os `fontSize` de nome, PV, iniciativa e contador de condições
  (hoje constantes 8/8,5/9 em `VttCanvas.tsx`) e o tamanho do badge de condição;
- `stageRef` exposto pelo `useImperativeHandle` que já existe, pra gerar a miniatura (§5).

`DisplayPage` monta:
- stores hidratadas por `useRoom.joinDisplay({ inviteCode, displayToken })` (mesmo `hydrate` do join
  normal) e `bindSocket` com os handlers `display:*`;
- wrapper com `cursor: none`, fundo `DEFAULT_IMMERSIVE_BG_COLOR` + vinheta do modo imersivo;
- **rotação** por CSS no wrapper (`rotate(90deg)` trocando largura/altura). Como a tela não tem
  interação com o mapa, não precisamos mexer na matemática de ponteiro do canvas — é a opção mais
  simples e sem risco;
- indicador de turno (§4.2), painel de calibração (§3.3), overlay de estado ("Conectando…",
  "Link revogado", "Nenhum mapa ativo" — texto grande e centralizado, sem botões).

Primeira abertura: uma dica discreta "F: tela cheia · C: calibrar" some sozinha em 5 s (tela cheia
exige um gesto do usuário, não dá pra entrar sozinho). Reaproveita `useFullscreen`.

### 3.3 Painel de calibração (tecla C ou canto inferior direito)

Canto: área invisível de 48 px; o painel só abre com clique ali ou tecla C. Enquanto aberto, o
cursor volta a aparecer. Esc fecha. Conteúdo:

1. **Modo mesa física** (liga/desliga). Desligado = tela comum (TV), zoom segue a câmera.
2. **Escala da projeção** — duas formas, a última usada vale:
   - *Largura projetada*: campo "a imagem inteira tem ___ cm de largura" → `pxPerCmFromWidth(screen.width, cm)`;
   - *Régua*: duas alças arrastáveis ligadas por uma linha, desenhadas por cima de tudo em
     coordenadas de tela (fora do wrapper girado). O usuário coloca a fita métrica real sobre a mesa,
     alinha as alças e digita quantos cm há entre elas → `pxPerCmFromRuler`. Mais preciso quando a
     projeção tem bordas cortadas.
3. **Tamanho da célula** em cm (padrão 2,5; passo 0,1).
4. **Quadrado de teste de 10 cm** desenhado enquanto o painel está aberto — confere com a régua sem
   precisar de mapa.
5. **Rotação**: 0 / 90 / 180 / 270.
6. **Ajuste fino** de deslocamento: setas movem 1 px, Shift+setas 10 px; botão "zerar". É somado ao
   pan em qualquer modo de câmera, e fica em pixels de tela na orientação já girada.
7. **Tamanho do texto**: 1× a 4× (passo 0,25).
8. **Indicador de turno**: canto (4 opções) ou desligado — com a mesa girada, "canto de cima" muda.

Com o modo mesa física ligado, o zoom é `tabletopZoom(...)` do mapa **ativo** — recalculado sozinho
ao trocar de mapa (cada mapa tem seu `cellSize`) — e nenhuma câmera muda o zoom.

Persistência: `localStorage` numa chave só, `tvtt:cast:tabletop` — **não** por sala: a calibração
depende do projetor e da mesa, não da campanha. Lido com `TabletopPrefsSchema.safeParse` (falhou →
padrões) e escrito dentro de `try/catch`.

---

## 4. Câmera e conforto

### 4.1 Modos (escolhidos pelo Mestre, valem para todas as telas da sala)

- **Seguir o Mestre**: o cliente do GM emite `display:view { reason: "follow" }` quando o
  enquadramento dele muda (throttle de 150 ms, `lib/throttle.ts`), **só** se o modo é `follow` e há
  tela conectada (`display:presence.count > 0` — sem tela, zero tráfego). A tela aplica
  `followCamera`: mesmo centro; fora do modo mesa física o zoom é o que faz a área do Mestre caber;
  no modo mesa física só o centro acompanha. Se o Mestre está olhando um mapa que não é o ativo, a
  tela ignora (`sceneId` diferente) e fica onde está.
- **Automático**: calculado **na própria tela** (ela já tem tokens/combate/gabaritos), com
  `autoCamera`:
  - fora de combate: foco = tokens visíveis com dono jogador;
  - em combate: foco = token do combatente da vez + gabaritos dele (o "gabarito ativo" = gabaritos
    cujo `ownerId` é o dono do combatente da vez; o GM, se for turno de NPC), contexto = tokens dos
    jogadores;
  - zona morta: só move quando o foco sai dos 70% centrais da tela.
- **Livre**: nada se move sozinho.
- **"Centralizar aqui"** (botão no GM, funciona em qualquer modo): `display:view { reason: "center" }`
  com o centro atual do Mestre. Em "automático", a tela fica 10 s sem recalcular depois disso, pra
  o comando do Mestre não ser desfeito na hora.

No **modo mesa física**, todo movimento de câmera passa por `snapCenterToCells`: o mapa anda em
células inteiras, então as linhas do grid projetado continuam caindo nos mesmos lugares da mesa.

### 4.2 Conforto de mesa

- `labelScale` do painel de calibração (§3.3, item 7) → prop do `VttCanvas`.
- Indicador "Turno de **X**" num canto: nome do combatente como o jogador vê (se o combatente da vez
  está oculto, o `toCombat` do jogador já não o expõe → o indicador some, não mostra "???"). Fonte
  grande, fundo `FLOAT_SURFACE` translúcido, sem animação chamativa; troca com um fade curto.
- Sem cursor (`cursor: none`), sem toasts (§3.1).

---

## 5. Barra do Mestre (`CastMenu` na `TopBar`, só GM)

Botão **"Cast"** (ícone `Cast` do lucide) com um ponto dourado quando há tela conectada. Abre um
popover:
- sem token: "Criar link de exibição";
- com token: **Copiar link**, **Abrir em nova janela** (`window.open(url, "tvtt-cast", "popup,width=1280,height=720")`
  — o Mestre arrasta a janela para o projetor e aperta F), **Gerar novo link** (confirma: "a tela
  atual vai desconectar"), **Revogar**;
- seletor de **modo de câmera** (Seguir / Automático / Livre);
- **Centralizar aqui**;
- **miniatura** (240 px de largura) do que a tela está mostrando, com "N telas conectadas".

Quando há tela conectada, uma miniatura compacta (~96 px) + o seletor de modo ficam também visíveis
direto na `TopBar`, sem abrir o popover (é o "conferir de relance" pedido).

**Miniatura — decisão:** a tela manda uma imagem de verdade do próprio canvas
(`stage.toDataURL({ mimeType: "image/jpeg", quality: 0.6, pixelRatio })` reduzido a ~320 px de
largura, rotação aplicada), **a cada 2 s e só enquanto algum Mestre pediu** (`display:preview {on}`
→ `display:previewDemand`). O servidor só repassa ao `rooms.gm`.
- **Por quê imagem em vez de redesenhar no notebook do Mestre:** o cliente do GM vê tudo (névoa
  translúcida, tokens ocultos); redesenhar "como jogador" lá seria refazer o filtro no cliente e
  poderia mostrar algo diferente do que a mesa vê de fato. A imagem é, por definição, o que está
  na tela. Custo: ~15 KB a cada 2 s, só com a miniatura aberta.
- **Limite:** se o mapa vier de URL externa sem CORS, o canvas fica "contaminado" e `toDataURL`
  lança. Nesse caso a tela manda `display:frame` sem imagem e o GM mostra "Miniatura indisponível
  para mapa externo". Mapas enviados pelo upload do app (mesma origem via proxy) funcionam.

---

## 6. Ordem de implementação

1. **shared**: `schemas/display.ts`, eventos em `events.ts`, `rules/tabletop.ts` + testes.
2. **server**: migration `displayToken`; `services/display.ts` (token, modo, contagem, viewer,
   allowlist) + testes; `socket/display.ts`; middleware em `socket/index.ts`; `SocketData.isDisplay`;
   desvio em `leaveCurrentRoom`; `buildSnapshot` com viewer separado; linha extra em `emitCombat`.
3. **web — GM**: `store/cast.ts` (token, modo, contagem, miniatura; ações que emitem), `CastMenu`,
   emissão de `display:view` a partir do `VttCanvas` do GM.
4. **web — tela**: rota, `store/room.ts#joinDisplay`, props `readOnly`/`controlledView`/`labelScale`
   no `VttCanvas`, `DisplayPage`, câmera (`lib/castCamera.ts` chamando o shared), indicador de turno.
5. **web — calibração**: `CalibrationPanel`, régua, quadrado de teste, rotação, persistência.
6. **Miniatura**: `display:preview`/`display:frame`.
7. `docs/SPEC.md`: nova seção **§9.23 Cast (tela de exibição)** + eventos em §5 + `Room.displayToken`
   em §4. `make typecheck && make test`. Teste manual com duas janelas (GM + `?display=`) e o
   `window.__vtt` do navegador headless (ver memória do ambiente).

Commits separados por etapa, direto na `main`.

## 7. Riscos e pontos de atenção

- **Câmera automática × miniaturas físicas.** Em mesa física, qualquer pan desloca o mapa por baixo
  das miniaturas, que ficam no lugar errado. O snap por célula ameniza (não fica "meia célula"), mas
  não resolve. Sugestão de uso a documentar no SPEC: em mesa física, preferir **Livre** e
  "Centralizar aqui" só entre cenas/encontros.
- **`VttCanvas` grande.** As props novas mexem num arquivo de 3 mil linhas; `readOnly` precisa
  desligar efeitos com efeito colateral (salvar enquadramento, atalhos, publicar retângulo do mapa
  em `useUi`). Vou listar cada efeito tocado na revisão.
- **Performance do projetor.** Projetores costumam rodar em 1080p num PC modesto; o `toDataURL` a
  cada 2 s é barato, mas se pesar, sobe para 5 s.
- **Tela desconectada.** Reconexão do Socket.io refaz `display:join` com o mesmo token (igual ao
  `lastJoinParams` do join normal). Token revogado nesse meio → tela mostra "Link revogado".

## 8. Fora do escopo (não vou fazer sem pedido)

Presentation API; mais de um link de exibição por sala; régua, alvos, pings, handouts em tela
cheia, dados 3D e chat na tela de exibição; interação por toque na tela; modo de câmera diferente
por tela.

## 9. Decisões do dono do projeto (aprovado)

1. **Modo de câmera padrão amarrado ao modo mesa física**: mesa física ligada → padrão "Livre";
   mesa física desligada (TV comum) → padrão "Seguir o Mestre". Isto entra no SPEC junto com a
   recomendação de uso do §7 (evitar câmera automática/seguir com miniaturas físicas na mesa).
2. **Handout na tela**: `handout:show "para todos"` abre o mesmo overlay em tela cheia na tela de
   exibição (imagem ou texto), com `labelScale` aplicado ao texto; `handout:show` "para X" (sussurro)
   NÃO chega à tela; `handout:close` fecha nela também. Ver §10 abaixo.
3. **Régua do Mestre na tela**: incluída — `ruler:updated` já chega à tela por estar em
   `rooms.players`; só falta o cliente da tela desenhar (reaproveita a camada de régua do
   `VttCanvas`, que já é readOnly-safe por não ter estado próprio de interação).
4. **Blackout** (acréscimo do dono do projeto): botão no `CastMenu` que escurece a tela da mesa na
   hora — sem mapa, sem tokens, só o fundo do modo imersivo + uma marca discreta (ex.: ícone
   apagado). Alternável, estado em memória por sala (mesmo padrão do modo de câmera), broadcast
   `display:blackoutChanged` para GM + telas. Atalho de teclado no GM é opcional (fica para depois,
   não bloqueia esta entrega).

## 10. Detalhamento do handout na tela (decisão 2)

- `services/handout.ts`/`socket/handout.ts` já calcula, em `handout:show`, quem recebe o card (todos
  vs. sussurro). Quando é "para todos", além do broadcast já existente, emite `display:handout` (novo
  evento, payload igual ao `HandoutShowPayload` resolvido: o `Handout` completo) para
  `rooms.display(roomId)`. `handout:close` idem, `display:handout` com `null`.
- A tela guarda o handout atual numa store pequena (`store/castHandout.ts` ou reaproveita
  `store/handouts.ts` com uma flag) e `DisplayPage` desenha um `HandoutOverlay` por cima do canvas
  (mesmo componente do jogador, com `labelScale` repassado ao tamanho de fonte do texto).
- **Troca de mapa com handout aberto**: handout não é por mapa (é evento avulso), então continua
  aberto — mesmo comportamento do overlay do jogador hoje (`RoomPage` não fecha handout ao trocar de
  cena). Registrar isso como não-regressão no `revisao-cast.md`, não como bug novo.
- **Blackout durante handout**: blackout tem prioridade visual (cobre tudo, inclusive o handout) —
  é o "apagar a mesa" pedido, e reabrir o blackout não deve expor um handout esquecido por engano.
- **Zoom/pan sincronizado** (pedido depois da entrega inicial, docs/revisao-cast.md): novo evento
  efêmero `display:handout-view { handoutId, zoom, x, y }`, emitido pelo GM com throttle de ~150ms
  e só enquanto há tela conectada. `x`/`y` são o ponto da imagem que fica no CENTRO do
  enquadramento, em fração do TAMANHO NATURAL da imagem — nunca pixels de tela (GM e tela têm
  tamanhos diferentes; mesmo raciocínio de `DisplayViewSchema.center` usar pixels do mapa em vez de
  tela). `HandoutOverlay.tsx` ganhou um modo controlado (`remoteView`, usado só por `DisplayPage`) e
  converte entre `pos`/`scale` locais (px de tela) e `x`/`y`/`zoom` (fração da imagem) nos dois
  sentidos. Só sincroniza quando o overlay aberto no GM é o mesmo "para todos" da tela (`RoomPage`
  checa `whisperTo === null`) — sussurro nunca emite. Fechar o handout, trocar de handout ou ligar
  o Blackout limpa o `handoutView` na store da tela (`store/cast.ts`); o overlay do jogador nunca
  recebe isso (mantém zoom próprio).

## 11. Status

Aprovado pelo dono do projeto em 2026-09-17. Implementação em andamento; revisão final em
`docs/revisao-cast.md`.
