# Tormenta VTT — Especificação do MVP

> Documento vivo. Descreve **o que** o MVP faz, o modelo de dados e o contrato de eventos.
> A fonte da verdade dos tipos é `packages/shared/src` (Zod). Se este doc e o código divergirem, o código vence e este doc deve ser atualizado.

## 1. Visão

VTT (Virtual Tabletop) web para jogar RPG de mesa online com amigos. Primeiro sistema: **Tormenta20**.
Arquitetura **agnóstica de sistema**: tudo que é regra (atributos, perícias, fórmulas) vive em `packages/shared/systems/<id>.json`, validado pelo `SystemDefinitionSchema`. O código nunca conhece "FOR" ou "Percepção".

**Fora do MVP** (explicitamente): login/contas, fog of war, medição de distância, áudio/vídeo, múltiplos mapas simultâneos, compêndio de magias/itens, automação avançada da ficha (classes e raças como itens, efeitos ativos, progressão por nível).

A **ficha básica** (§3.6) entrou no escopo em setembro/2026: atributos, perícias, recursos, stats derivados, modificadores e itens físicos com ataque/dano ligados ao chat. Poderes e magias já existem nos tipos, mas a lógica de ativação (custo, CD) vem depois. Raciocínio e mapeamento em `docs/modelo-personagem.md`.

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
- Placeholders de sistema (`{attr.for}`, `{skill.percepcao}`, `{derived.defense}`, `{level}`...) são resolvidos **antes** do parser a partir da ficha do autor. Regra do `/r`: o autor precisa ter exatamente **uma** ficha própria na sala; com zero ou várias, o ack devolve erro pedindo para rolar pela ficha (`character:roll`), que sabe qual usar.

### 3.5 Iniciativa
- Painel lateral com lista ordenada por `value` desc, depois `tiebreak` desc.
- GM: adicionar entrada (a partir de um token ou manual), editar valor, ocultar/mostrar, remover, `next`/`prev`, `reset` (limpa e volta `round = 0`).
- `next` com `currentIndex = null` inicia o combate (índice 0, `round = 1`). `next` no último da lista incrementa `round` e volta ao índice 0. `prev` no primeiro volta ao último e decrementa `round` (mínimo 1).
- Ao alterar a lista (add/update/remove), o cursor continua apontando para a mesma entrada; se ela for removida, quem vinha depois passa a agir.
- Para jogadores, `currentIndex` é recalculado sobre a lista filtrada; se quem age está oculto, `currentIndex = null`.
- Jogadores veem a lista (entradas `visible = true`) e o destaque de quem está agindo. Token do turno atual ganha um contorno no mapa.
- A fórmula de iniciativa vem do JSON do sistema (`rolls.initiative`), mas no MVP o valor é digitado ou rolado com `/r`.

### 3.6 Ficha de personagem
- Tudo que é regra vem do JSON do sistema (`SystemDefinitionSchema` v2): atributos, perícias (com tags, variantes como "Ofício" e flags de tamanho/armadura), recursos, stats derivados por fórmula (`derived[]`: Defesa, CD, carga...), tamanhos, tipos de dano, moedas, campos de traço, stats de equipamento (`equipStats`) e tipos de item com campos declarados (`itemKinds`).
- A ficha guarda só **entradas**: base dos atributos, treinado/outros por perícia, atual/temporário/máximo digitado por recurso, overrides de derivados, modificadores, traços, moedas, itens. Os valores finais vêm de `computeCharacter(def, character)` (função pura em `packages/shared/src/rules/compute.ts`), que servidor e cliente rodam igual. O cliente usa só para exibir; o servidor é quem monta e rola.
- **Modificador** = `{ target, value }` com `target` textual validado por regex (`attr.for`, `skill.luta`, `skill.*`, `skill[tag=ataque]`, `derived.defense`, `resource.pv.max`, `attack`, `attack.luta`, `damage`, `damage.pontaria`). Cobre bônus de poderes, condições e itens sem o código conhecer nenhuma chave.
- **Item** = tipo (`kind` de `itemKinds`), campos do tipo (`fields`), `equipped`, `statBonuses` (ex.: armadura dá `defense`, `maxAttr`, `armorPenalty`; só contam equipados) e **ações**: `attack` (perícia + atributo alternativo + margem de crítico), `damage` (fórmula + atributo `auto` pela regra `damageAttribute` do sistema + tipo), `check` e `formula`. Blocos `activation` e `save` existem nos tipos para poderes/magias; a lógica de custo/CD é fase 3.
- `character:roll` monta a fórmula no servidor (`buildCharacterRoll`), rola e publica no chat como `ChatMessage{kind:"roll"}` com `characterId` e, em ataques, `critThreshold` (o chat destaca crítico a partir dele).
- Permissões: GM vê e edita todas; jogador vê as fichas `kind = "pc"`, cria só para si e edita/rola só as que possui (`ownerId`). Fichas `npc` não vão para jogadores (`character:deleted` se uma PC virar NPC).
- Vínculo com token: `token:link-character` (GM, ou dono do token que também é dono da ficha). Apagar a ficha desvincula os tokens (`token:updated` com `characterId = null`).
- Nível é digitado (`level.source = "manual"`); PV/PM máximos são digitados (`maxOverride`) até classes virarem itens (fase 4).

## 4. Modelo de dados

Espelhado em `apps/server/prisma/schema.prisma` (persistência) e `packages/shared/src/schemas` (validação/transporte).

```
Room 1───* Participant
Room 1───* Scene 1───* Token *───? Participant (owner)
Room 1───* Character *───? Participant (owner)
Token *───? Character
Room 1───* ChatMessage
Room 1───* InitiativeEntry ?──1 Token
```

| Entidade | Campos principais | Notas |
|---|---|---|
| **Room** | `id, name, inviteCode, gmSecret, systemId, activeSceneId` | `gmSecret` nunca vai ao cliente (ver `RoomPublicSchema`) |
| **Participant** | `id, roomId, nickname, role, sessionToken` | `connected` é estado em memória, não persistido |
| **Scene** | `id, roomId, name, mapUrl, mapWidth, mapHeight, grid(JSON)` | `grid` é JSON para evoluir sem migration |
| **Token** | `id, sceneId, name, imageUrl, x, y, width, height, rotation, zIndex, visible, ownerId, color, characterId?` | Coordenadas em **pixels do mapa**, não em células. `characterId` só muda por `token:link-character` |
| **Character** | `id, roomId, ownerId?, name, kind, data(JSON)` | `data` segue `CharacterDataSchema` (atributos, perícias, recursos, modificadores, itens...). Colunas só para o que precisa de índice/permissão; o resto é agnóstico de sistema e evolui sem migration |
| **ChatMessage** | `id, roomId, participantId, nickname, kind, text?, roll?(JSON)` | `roll` segue `DiceRollSchema` |
| **InitiativeEntry** | `id, roomId, tokenId?, name, value, tiebreak, visible` | `currentIndex` e `round` ficam em memória por sala (perdem-se ao reiniciar o servidor; aceitável no MVP) |
| **SystemDefinition** | `id, name, attributes[], skills[], resources[], derived[], level, sizes[], damageTypes[], currencies[], traitFields[], equipStats[], itemKinds[], activation, skillTotal, rolls{}, damageAttribute, tokenBar, trainedBonus[]` | Arquivo JSON (`schemaVersion: 2`), **não** está no banco. Registrado em `packages/shared/src/systems.ts` e lido por server e web |

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
| `token:link-character` | `{ tokenId, characterId \| null }` | GM, ou owner do token que é owner da ficha | `token:updated` |
| `character:create` | `{ name, kind?, ownerId? }` | todos (jogador: `ownerId` = ele, `kind` = pc) | `character:created` (NPC só para o GM) |
| `character:update` | `{ id, patch }` (patch raso de `CharacterDataSchema` + `name`, `ownerId`, `kind`) | GM ou owner (jogador não muda `ownerId`/`kind`) | `character:updated` |
| `character:delete` | `{ characterId }` | GM ou owner | `character:deleted` + `token:updated` dos tokens desvinculados |
| `character:roll` | `{ characterId, roll: {type: attribute\|skill\|initiative\|extra\|action, ...}, secret? }` | GM ou owner | `chat:message` (rolagem com `characterId`) |
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
| `character:created` / `character:updated` | `Character` (jogadores só recebem `kind = "pc"`) |
| `character:deleted` | `{ characterId }` |
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
                TokenInspector, SidePanel, ChatTab, InitiativeTab, CharactersTab,
                MapConfigModal, NicknamePrompt, Toasts, CharacterSheetDrawer (gaveta da ficha)
  components/character/  seções da ficha: CharacterHeader, AttributesGrid, ResourcesBlock,
                DerivedStatsBar, SkillsSection, ItemsSection, ModifiersSection, DetailsSection,
                fields.tsx (inputs "commit on blur")
  store/        connection.ts (socket + emitAck), bindSocket.ts (broadcast → store),
                room.ts, tokens.ts, chat.ts, initiative.ts, characters.ts, ui.ts (toasts)
  lib/          router.ts (2 rotas, sem lib), api.ts (HTTP), grid.ts (célula↔pixel, puro),
                session.ts (localStorage), throttle.ts, useImage.ts, system.ts (useSystemDef), ids.ts
apps/server/src/
  index.ts, env.ts, db.ts
  http/         rooms.ts, upload.ts
  socket/       index.ts, types.ts, ack.ts (validação Zod + ack), room.ts, scene.ts,
                token.ts, chat.ts, initiative.ts, character.ts
  services/     serialize.ts (Prisma → shared), snapshot.ts, presence.ts,
                initiativeState.ts, permissions.ts, chatCommands.ts, ids.ts,
                characters.ts (Prisma ↔ Character, visibilidade, broadcast),
                rolls.ts (rola, persiste e publica; usado pelo chat e pela ficha)
packages/shared/src/
  schemas/      (Zod, inclui payloads.ts e character.ts)  events.ts
  dice/         parser + roller, puro, sem I/O
  rules/        placeholders.ts, modifierTarget.ts (regex do target),
                compute.ts (computeCharacter), rolls.ts (buildCharacterRoll), defaults.ts
  systems.ts    registro dos JSONs (getSystemDefinition)
packages/shared/systems/
  tormenta20.json
```

## 8. Estado da implementação

Todos os itens do MVP acima estão implementados (setembro/2026), incluindo a ficha básica (§3.6). Limitações conhecidas:
- Ficha: poderes e magias existem como itens com campos, mas sem custo de PM, CD de resistência nem ativação na UI (fase 3). Classes e raças como itens, nível e PV/PM automáticos são a fase 4.
- `character:update` é um patch raso: editar um item reenvia a lista `items` inteira (fichas são pequenas; ok por ora).
- Só existe UI para uma cena por sala (`scene:create`/`scene:activate` funcionam no servidor, sem botão no web).
- `currentIndex`/`round` da iniciativa e a presença (`connected`) se perdem ao reiniciar o servidor.
- Uploads ficam em disco (`apps/server/uploads/`), sem limpeza de arquivos órfãos.
