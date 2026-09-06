# Tormenta VTT — Especificação do MVP

> Documento vivo. Descreve **o que** o MVP faz, o modelo de dados e o contrato de eventos.
> A fonte da verdade dos tipos é `packages/shared/src` (Zod). Se este doc e o código divergirem, o código vence e este doc deve ser atualizado.

## 1. Visão

VTT (Virtual Tabletop) web para jogar RPG de mesa online com amigos. Primeiro sistema: **Tormenta20**.
Arquitetura **agnóstica de sistema**: tudo que é regra (atributos, perícias, fórmulas) vive em `packages/shared/systems/<id>.json`, validado pelo `SystemDefinitionSchema`. O código nunca conhece "FOR" ou "Percepção".

**Fora do MVP** (explicitamente): login/contas, ficha de personagem completa, fog of war, medição de distância, áudio/vídeo, múltiplos mapas simultâneos, compêndio de magias/itens, automação de regras.

## 2. Papéis

| Papel | Como vira | Pode |
|---|---|---|
| **GM** | Cria a sala (recebe `gmSecret` na URL) | Tudo: mapa, grid, criar/mover/apagar qualquer token, controlar iniciativa, ver tokens invisíveis |
| **Jogador** | Entra pelo link de convite com um nickname | Mover/redimensionar tokens que possui (`ownerId`), chat, rolar dados, ver iniciativa |

Sem login: um `sessionToken` (cuid) é gravado no `localStorage` (chave por `inviteCode`) para reconectar como o mesmo participante. Ele é devolvido no `RoomSnapshot` e enviado de volta em `room:join` nas próximas conexões.

## 3. Funcionalidades do MVP

### 3.1 Sala e convite
- `POST /api/rooms { name, nickname }` → cria sala, cria participante GM, devolve `{ room, gmSecret, sessionToken }`.
- URL do GM: `/room/<inviteCode>?gm=<gmSecret>` — URL do jogador: `/room/<inviteCode>`.
- Ao abrir a URL, o cliente pede nickname (se não houver `sessionToken` salvo) e emite `room:join`.
- Servidor responde com `RoomSnapshot` (estado completo, inclui `sessionToken`) e faz broadcast de `room:participantJoined`.
- Ao desconectar, o servidor faz broadcast de `room:participantLeft { id }`; o participante **continua** na lista com `connected = false` (jogadores online = `connected = true`).
- O Lobby (`/`) tem só dois cards: criar sala e entrar com código. Não há lista de salas recentes no MVP.
- Ao criar a sala, o servidor cria automaticamente uma cena "Cena 1" vazia e a define como ativa.

### 3.2 Mapa e grid (GM)
- `POST /api/upload` (multipart, PNG/JPG/WebP, máx. 20 MB) → salva em `apps/server/uploads/` e devolve `{ url, width, height }`.
- GM emite `scene:setMap` com a URL e dimensões. Servidor persiste e faz broadcast de `scene:updated`.
- Painel de grid: tipo (`square`/`none`), `cellSize` (px), `offsetX/Y`, cor, snap. Emite `scene:updateGrid`.
- O canvas (react-konva) desenha: imagem do mapa → linhas do grid → tokens. Pan arrastando o fundo do mapa (botão esquerdo); zoom com scroll e botões +/−/ajustar.
- Sem mapa (`mapUrl = null`) o canvas desenha um retângulo escuro de `mapWidth × mapHeight` (padrão 1600×1100) só para o grid e os tokens terem onde ficar.
- Renomear cena está fora do MVP (o nome é definido em `scene:create`).

### 3.3 Tokens
- Criar: GM clica "Novo token" → aparece no centro da viewport com `width = height = cellSize`. Opcional: imagem via `/api/upload`.
- Arrastar: durante o drag o cliente emite `token:update {id, x, y}` com throttle (~30/s). Ao soltar, se `grid.snap`, alinha à célula mais próxima e emite a posição final.
- Redimensionar: handles nos cantos (Konva Transformer). Emite `token:update {id, width, height}`.
- Permissão: servidor rejeita `token:update`/`token:delete` de jogador que não é `ownerId` do token (ack `{ ok: false }`).
- Todo `token:*` aceito é persistido e reenviado a todos na sala (inclusive quem enviou, para manter uma única fonte de verdade).
- Tokens com `visible = false` não são enviados a jogadores. Se o GM oculta um token visível, jogadores recebem `token:deleted`; se torna visível de novo, recebem `token:updated` (o cliente trata `token:updated` como upsert).
- Jogador (dono) só pode alterar `x, y, width, height, rotation`; o servidor ignora os demais campos do patch. Nome, cor, dono, visibilidade e imagem são só do GM (painel do token).

### 3.4 Chat e dados
- Input único. Texto normal vira `ChatMessage{kind:"text"}`.
- Comandos:
  - `/r <fórmula> [# rótulo]` — rola, ex.: `/r 2d6+3`, `/r 1d20+5 # Ataque`.
  - `/gr <fórmula>` — rolagem secreta (só GM e autor veem).
- **Gramática da fórmula** (parser genérico em `packages/shared/src/dice`):
  ```
  expr    := term (("+"|"-") term)*
  term    := factor (("*"|"/") factor)*
  factor  := ("+"|"-") factor | atom
  atom    := integer | dice | func "(" expr ("," expr)* ")" | "(" expr ")"
  dice    := [count]"d"sides [modifier]
  modifier:= "kh"n | "kl"n        ; keep highest / keep lowest (ex.: 2d20kh1 = vantagem)
  func    := "floor" | "ceil" | "abs" | "min" | "max"
  ```
  - Dados só entram em soma/subtração; `*`, `/` e funções aceitam apenas constantes (`2*1d6` é inválido). Assim o resultado é sempre "grupos de dados + modificador fixo".
  - `/` é divisão inteira arredondada para baixo (`7/2 = 3`).
  - Limites: `count ≤ 100`, `sides ≤ 1000`, fórmula ≤ 200 chars.
  - `evaluateConstant()` avalia a mesma gramática sem dados (usada para stats derivados da ficha).
  - Rolagem acontece **no servidor** (jogadores não podem forjar resultados).
- Resultado exibido como: `Thiago rolou 1d20+5: [14] + 5 = 19`. Dados naturais máximo/mínimo destacados (crítico/falha), regra visual apenas.
- Placeholders de sistema (`{attr.for}`, `{skill.percepcao}`) são resolvidos **antes** do parser a partir da ficha; no MVP, como não há ficha, só a fórmula crua é suportada. O JSON do sistema já define as fórmulas para a fase seguinte.

### 3.5 Iniciativa
- Painel lateral com lista ordenada por `value` desc, depois `tiebreak` desc.
- GM: adicionar entrada (a partir de um token ou manual), editar valor, ocultar/mostrar, remover, `next`/`prev`, `reset` (limpa e volta `round = 0`).
- `next` com `currentIndex = null` inicia o combate (índice 0, `round = 1`). `next` no último da lista incrementa `round` e volta ao índice 0. `prev` no primeiro volta ao último e decrementa `round` (mínimo 1).
- Ao alterar a lista (add/update/remove), o cursor continua apontando para a mesma entrada; se ela for removida, quem vinha depois passa a agir.
- Para jogadores, `currentIndex` é recalculado sobre a lista filtrada; se quem age está oculto, `currentIndex = null`.
- Jogadores veem a lista (entradas `visible = true`) e o destaque de quem está agindo. Token do turno atual ganha um contorno no mapa.
- A fórmula de iniciativa vem do JSON do sistema (`rolls.initiative`), mas no MVP o valor é digitado ou rolado com `/r`.

## 4. Modelo de dados

Espelhado em `apps/server/prisma/schema.prisma` (persistência) e `packages/shared/src/schemas` (validação/transporte).

```
Room 1───* Participant
Room 1───* Scene 1───* Token *───? Participant (owner)
Room 1───* ChatMessage
Room 1───* InitiativeEntry ?──1 Token
```

| Entidade | Campos principais | Notas |
|---|---|---|
| **Room** | `id, name, inviteCode, gmSecret, systemId, activeSceneId` | `gmSecret` nunca vai ao cliente (ver `RoomPublicSchema`) |
| **Participant** | `id, roomId, nickname, role, sessionToken` | `connected` é estado em memória, não persistido |
| **Scene** | `id, roomId, name, mapUrl, mapWidth, mapHeight, grid(JSON)` | `grid` é JSON para evoluir sem migration |
| **Token** | `id, sceneId, name, imageUrl, x, y, width, height, rotation, zIndex, visible, ownerId, color` | Coordenadas em **pixels do mapa**, não em células |
| **ChatMessage** | `id, roomId, participantId, nickname, kind, text?, roll?(JSON)` | `roll` segue `DiceRollSchema` |
| **InitiativeEntry** | `id, roomId, tokenId?, name, value, tiebreak, visible` | `currentIndex` e `round` ficam em memória por sala (perdem-se ao reiniciar o servidor; aceitável no MVP) |
| **SystemDefinition** | `id, name, attributes[], skills[], resources[], rolls{}, trainedBonus[]` | Arquivo JSON, **não** está no banco |

Decisão: coordenadas em pixels (não células) para o token poder ficar "fora do grid" e para suportar `grid.type = none`. A conversão célula↔pixel é uma função pura usando `cellSize` e `offset`.

## 5. Eventos Socket.io

Definidos com tipos em `packages/shared/src/events.ts`; os payloads têm schemas Zod em `packages/shared/src/schemas/payloads.ts` (os tipos dos eventos derivam deles). Todo evento cliente→servidor recebe um **ack**:
`{ ok: true, data }` ou `{ ok: false, error }`. Payloads são validados com Zod no servidor; inválido → `ok: false`.

Salas do Socket.io: cada socket entra em `room:<roomId>`. Broadcasts vão para essa sala. O GM entra também em `room:<roomId>:gm` para receber dados que jogadores não veem.

### Cliente → Servidor

| Evento | Payload | Quem | Efeito / broadcast |
|---|---|---|---|
| `room:join` | `{ inviteCode, nickname?, gmSecret?, sessionToken? }` | todos | ack `RoomSnapshot`; `room:participantJoined`. `sessionToken` válido → reconecta o mesmo participante; senão exige `nickname` e cria um novo |
| `scene:create` | `{ name }` | GM | `scene:created` |
| `scene:activate` | `{ sceneId }` | GM | `room:activeSceneChanged` (clientes reemitem `room:join` para receber os tokens da nova cena) |
| `scene:setMap` | `{ sceneId, mapUrl, mapWidth, mapHeight }` (`null` remove o mapa) | GM | `scene:updated` |
| `scene:updateGrid` | `{ sceneId, grid: Partial<GridConfig> }` | GM | `scene:updated` |
| `token:create` | `TokenCreate` | GM | `token:created` |
| `token:update` | `TokenPatch` (`id` + campos) | GM ou owner | `token:updated` |
| `token:delete` | `{ tokenId }` | GM ou owner | `token:deleted` |
| `chat:send` | `{ text }` | todos | `chat:message` (rolagem secreta só p/ GM + autor) |
| `initiative:add` | `InitiativeEntry` sem `id` | GM | `initiative:updated` |
| `initiative:update` | `{ id, ...campos }` | GM | `initiative:updated` |
| `initiative:remove` | `{ entryId }` | GM | `initiative:updated` |
| `initiative:next` / `prev` / `reset` | `{}` | GM | `initiative:updated` |

### Servidor → Cliente

| Evento | Payload |
|---|---|
| `room:participantJoined` / `room:participantLeft` | `Participant` (novo ou reconectado; cliente faz upsert) / `{ id }` (marca `connected = false`) |
| `room:activeSceneChanged` | `{ sceneId }` |
| `scene:created` / `scene:updated` | `Scene` |
| `token:created` / `token:updated` | `Token` |
| `token:deleted` | `{ tokenId }` |
| `chat:message` | `ChatMessage` |
| `initiative:updated` | `InitiativeState` (estado completo, simples de sincronizar) |
| `server:error` | `{ message }` |

### HTTP (fora do socket)

| Rota | Uso |
|---|---|
| `GET /health` | `{ status, db, uptime }` |
| `POST /api/rooms` | cria sala |
| `POST /api/upload` | upload de imagem (mapa/token) |
| `GET /uploads/:file` | serve imagens |

## 6. Fluxo de sincronização (regra geral)

1. Cliente aplica a mudança **otimisticamente** na store local (o arraste parece instantâneo).
2. Emite o evento com ack.
3. Servidor valida (Zod + permissão), persiste, faz broadcast a **todos** na sala.
4. Todo cliente (inclusive o autor) aplica o broadcast — o servidor é a fonte da verdade.
5. Se o ack vier `ok: false`, o cliente reverte para o último estado conhecido e mostra um toast.

## 7. Estrutura de pastas prevista

```
apps/web/src/
  App.tsx       escolhe a tela pela URL
  components/   Lobby, RoomPage (liga stores aos componentes), TopBar, VttCanvas,
                TokenInspector, SidePanel, ChatTab, InitiativeTab, MapConfigModal,
                NicknamePrompt, Toasts
  store/        connection.ts (socket + emitAck), bindSocket.ts (broadcast → store),
                room.ts, tokens.ts, chat.ts, initiative.ts, ui.ts (toasts)
  lib/          router.ts (2 rotas, sem lib), api.ts (HTTP), grid.ts (célula↔pixel, puro),
                session.ts (localStorage), throttle.ts, useImage.ts
apps/server/src/
  index.ts, env.ts, db.ts
  http/         rooms.ts, upload.ts
  socket/       index.ts, types.ts, ack.ts (validação Zod + ack), room.ts, scene.ts,
                token.ts, chat.ts, initiative.ts
  services/     serialize.ts (Prisma → shared), snapshot.ts, presence.ts,
                initiativeState.ts, permissions.ts, chatCommands.ts, ids.ts
packages/shared/src/
  schemas/      (Zod, inclui payloads.ts)  events.ts  dice/ (parser + roller, puro, sem I/O)
packages/shared/systems/
  tormenta20.json
```

## 8. Estado da implementação

Todos os itens do MVP acima estão implementados (setembro/2026). Limitações conhecidas:
- Só existe UI para uma cena por sala (`scene:create`/`scene:activate` funcionam no servidor, sem botão no web).
- `currentIndex`/`round` da iniciativa e a presença (`connected`) se perdem ao reiniciar o servidor.
- Uploads ficam em disco (`apps/server/uploads/`), sem limpeza de arquivos órfãos.
