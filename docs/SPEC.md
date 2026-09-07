# Tormenta VTT — Especificação do MVP

> Documento vivo. Descreve **o que** o MVP faz, o modelo de dados e o contrato de eventos.
> A fonte da verdade dos tipos é `packages/shared/src` (Zod). Se este doc e o código divergirem, o código vence e este doc deve ser atualizado.

## 1. Visão

VTT (Virtual Tabletop) web para jogar RPG de mesa online com amigos. Primeiro sistema: **Tormenta20**.
Arquitetura **agnóstica de sistema**: tudo que é regra (atributos, perícias, fórmulas) vive em `packages/shared/systems/<id>.json`, validado pelo `SystemDefinitionSchema`. O código nunca conhece "FOR" ou "Percepção".

**Fora do MVP** (explicitamente): login/contas, fog of war, medição de distância, áudio/vídeo, múltiplos mapas simultâneos, compêndio de magias/itens/classes (entrou depois: §9.4), automação avançada da ficha (efeitos ativos, poderes por nível com escolhas). O que já foi feito além do MVP está em **§9 Fase 2**.

A **ficha básica** (§3.6) entrou no escopo em setembro/2026: atributos, perícias, recursos, stats derivados, modificadores e itens físicos com ataque/dano ligados ao chat. Poderes e magias com ativação (custo de PM, CD de resistência, card no chat) entraram em seguida (fase 3), e classes e raças como itens que alimentam nível, PV/PM e atributos (fase 4). Raciocínio e mapeamento em `docs/modelo-personagem.md`; planos em `docs/plano-passo3.md` e `docs/plano-passo4.md`.

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
- O canvas (react-konva) desenha: imagem do mapa → linhas do grid → tokens → réguas/caixa de seleção. Pan no modo "Mover mapa" (ou espaço segurado); zoom com scroll e botões +/−/ajustar.
- **Barra de ferramentas** (coluna à esquerda do canvas, um modo por vez, estado em `store/tools.ts`, atalhos em `lib/useToolShortcuts.ts`):
  - **Selecionar (V)**: clicar/arrastar tokens; arrastar no mapa vazio desenha uma caixa que seleciona os tokens com o centro dentro dela; shift+clique entra/sai da seleção; arrastar um token selecionado move todos os selecionados que o usuário controla. O Stage não faz pan.
  - **Mover mapa (H)**: arrastar em qualquer lugar faz pan; tokens não respondem. Barra de espaço segurada ativa este modo temporariamente.
  - **Régua (R)**: clicar e arrastar mede do ponto inicial ao ponteiro (pontos grudam no centro da célula quando há grid e snap). A distância usa `grid` do `SystemDefinition` (`cellSize` na unidade do jogo, `unit`, regra de diagonais `euclidean | manhattan | alternating | chebyshev`; `rules/measure.ts` faz a conta) e o `cellSize` em px da cena. A régua é enviada por `ruler:update` (efêmero) e os outros a veem com o nickname do autor; some ao soltar.
  - **Névoa (F, só GM)**: fog of war manual, descrita em §9.3. Desenho: botão reservado (desabilitado), fora do MVP.
  - Esc cancela o gesto em andamento e volta para Selecionar. Scroll = zoom em todos os modos.
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
- **PV do token solto** (`Token.hp: { current, max } | null`, painel do token, só GM): só vale enquanto o token não tem `characterId`; vinculado a uma ficha, quem manda é o recurso `tokenBar` dela (§3.6). `null` = sem PV definido, o token não aparece como alvo de `token:apply-damage`.
- **Aplicar dano/cura em token** (card de rolagem com `damage[]` no chat): botão "Aplicar" (GM sempre; jogador só em tokens que possui) abre um seletor dos tokens da cena atual (nome, PV atual/máximo, dono, busca, multi-seleção) com um multiplicador por alvo (×1, ×½ "reduz à metade" arredondado pra baixo, ×2, ×0) e ajuste manual. Confirma → `token:apply-damage { messageId, targets: [{ tokenId, amount, multiplier? }] }`; `amount` já vem com sinal (negativo tira PV, positivo cura). O servidor valida tudo-ou-nada (todos os alvos, senão nenhum) e aplica: dano gasta PV temporário antes do atual (`applyResourceDelta`, `packages/shared/src/rules/resources.ts`), travado no mín./máx. calculado (ficha) ou em `0..max` (token solto); broadcast normal (`token:updated`/`character:updated`). O card acumula o resultado em `roll.applied[]` ("Aplicado: Goblin −7, Orc −3 (½)"), sem sobrescrever aplicações anteriores. PV mínimo/inconsciência não é automatizado — só o número.

### 3.4 Chat e dados
- Input único. Texto normal vira `ChatMessage{kind:"text"}`. Outros tipos: `roll` (rolagem), `system` (aviso) e `item` (card de poder/magia usado pela ficha, ver §3.6).
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
- **Item** = tipo (`kind` de `itemKinds`), campos do tipo (`fields`), `equipped`, `statBonuses` (ex.: armadura dá `defense`, `maxAttr`, `armorPenalty`; só contam equipados) e **ações**: `attack` (perícia + atributo alternativo + margem de crítico), `damage` (fórmula + atributo `auto` pela regra `damageAttribute` do sistema + tipo), `check` e `formula`. Blocos `activation` e `save` guardam a ativação e o teste de resistência de poderes/magias/consumíveis.
- `character:roll` monta a fórmula no servidor (`buildCharacterRoll`), rola e publica no chat como `ChatMessage{kind:"roll"}` com `characterId` e, em ataques, `critThreshold` (o chat destaca crítico a partir dele).
  - **Dano por tipo**: a ação de dano vira uma lista de **parcelas** (`BuiltRoll.damage[{ formula, damageType }]`): a base (tipo da ação, com atributo e bônus) e uma por tipo extra vindo de aprimoramentos. O servidor rola cada parcela em separado (`rollParsedMany`) e grava em `DiceRoll.damage[]` a fórmula, os grupos e o total de cada uma (`groups`/`modifier`/`total` da rolagem são a junção). O chat mostra o total e a decomposição com o selo de cada tipo: "21 (7 Fogo + 14 Frio)" e a fórmula "6d6 + 1 Fogo + 4d6 Frio"; uma parcela só mostra apenas o selo.
  - **Selo de tipo de dano** (`DamageTypeBadge`, `apps/web/src/components/DamageTypeBadge.tsx`): onde aparece tipo de dano (botões de ação na ficha, card do item e resultado da rolagem no chat, preview do compêndio, efeito de aprimoramento) ele é um selo com fundo na cor a ~20% e texto na cor cheia. A cor vem do JSON via `damageTypeInfo` (`rules/damageTypes.ts`): `damageTypes[].color`, senão a cor do `damageTypeGroups[]` referenciado em `group` (T20: corte, impacto, perfuração e "Dano" compartilham o cinza-pedra do grupo `fisico`; cada tipo elemental/mágico tem a sua), senão cinza neutro.
- **Ativação** (poderes, magias, consumíveis): tudo vem de `activation` no JSON do sistema: `resource` (recurso descontado pelo custo; PM em T20), `minCost` (piso após modificadores; 1 em T20), `saveDc` (fórmula da CD, `10 + {halfLevel} + {saveAttr} + {saveBonus}`), `executions[].passive` (quais execuções são passivas), `saveSkillTag` (tag das perícias que servem de resistência), `spellcastingLabel` e `enhancementCost` (fórmula do custo com aprimoramentos, `{base} + {enhancements}` em T20; ausente = sistema sem aprimoramentos). `itemKinds[].useLabel` dá o texto do botão ("Conjurar"/"Usar").
  - **Aprimoramentos**: `item.enhancements[{ id, label, cost, repeatable, effect? }]` (T20: "+2 PM: aumenta o dano em +1d6"). Item com aprimoramentos abre um popover no botão de uso: checkbox (ou contador, se `repeatable`), custo total ao vivo e botões "Conjurar (N PM)" / "Só a base"; sem aprimoramentos, usa direto. No modo edição a ficha edita a lista (texto, custo, repetível, efeito). Na visualização, a lista aparece abaixo da ativação.
  - **Efeito mecânico** (`effect`, explícito; ausente = `costOnly`): `damageDiceAdd { dice: "1d6", damageType? }` soma dados × vezes à ação de dano do item: sem `damageType` (ou igual ao da ação) os dados entram na parcela da ação; com outro tipo viram uma parcela separada daquele tipo ("+4d6 de dano de frio" numa Bola de Fogo = fogo e frio rolados e mostrados em separado; dois efeitos do mesmo tipo extra somam na mesma parcela). `damageSet { formula }` troca os dados do dano (atributo, bônus da ação e modificadores continuam somados, só na parcela base; dois `damageSet` na mesma conjuração é erro). `applyDamageEnhancements` (`rules/enhancements.ts`) monta "dados primeiro, números depois" (`6d6 + 4d6 + 3`), as parcelas extras e a decomposição ("6d6 base + 4d6 aumenta o dano ×2"). Ações de cura (tipo com `damageTypes[].healing: true`; `cura` em T20) ignoram `damageDiceAdd`/`damageSet` e só recebem `healDiceAdd { dice }`, que funciona igual (na parcela da ação). Os demais efeitos: `dcAdd { value }` soma × vezes à CD do card; `attackBonusAdd { value }` soma × vezes ao ataque das ações de ataque (`applyAttackEnhancements`, com `breakdown` "1d20 + 7 base +2 …"); `rangeSet { units, value? }`, `durationSet { units, value? }`, `areaSet { text }` e `targetsAdd { count }` só mudam o que o card exibe (`applyActivationEnhancements`; dois `rangeSet`/`durationSet`/`areaSet` na mesma conjuração é erro; alvos viram "1 criatura, +2 alvos") e o card lista em `enhanced[]` quais campos mudaram (`range|duration|area|target|dc|attack`) para a UI marcar "(aprimorado)"; `text { text }` é só descritivo e vai para `card.enhancements[].note`, em destaque no card. Ações que não são de dano nem de ataque ignoram a escolha. No editor da ficha, o efeito `dano +XdY` tem um seletor de tipo ("tipo da ação" = herda).
  - `character:use-item` (GM ou dono): `buildItemUse` (`rules/activation.ts`) valida a escolha `enhancements[{ id, times }]` contra o item (id existente, sem repetição, `times > 1` só em repetível), calcula o custo efetivo (`enhancementCost` com `{base}` e `{enhancements}` = Σ custo×vezes, depois modificadores `resource.<key>.cost`; total 0 continua 0; senão piso `minCost`), verifica o recurso pelo total (temporários gastos antes dos atuais), persiste a ficha (`character:updated`) e publica `ChatMessage{kind:"item"}` com um `ItemCard` denormalizado (nome, tipo e campos com rótulos, custo, aprimoramentos usados (com `note` nos descritivos), execução/alcance/duração/alvo/área e CD já com os efeitos aplicados mais `enhanced[]`, efeito resumido e as ações do item, cada uma com `formula` final, `breakdown` e `damage[]`, as parcelas por tipo). O botão de ação do card reenvia `character:roll { type:"action", enhancements }` com os aprimoramentos da conjuração, e o servidor rola a fórmula com os efeitos. Recurso insuficiente, item passivo ou escolha inválida: ack `{ ok:false }` e nada é publicado.
  - `{saveAttr}` é o atributo do `save.attribute` do item ou, se nulo, o `spellcastingAttribute` da ficha (editável no cabeçalho). Os botões do card no chat disparam `character:roll { type:"action" }` e só ficam ativos para GM ou dono da ficha.
  - Na ficha, itens de tipos com `hasActivation` e execução não passiva ganham o botão de uso com o custo efetivo (vermelho se o recurso atual não cobre); passivos mostram só a descrição.
- Permissões: GM vê e edita todas; jogador vê as fichas `kind = "pc"`, cria só para si e edita/rola só as que possui (`ownerId`). Fichas `npc` não vão para jogadores (`character:deleted` se uma PC virar NPC).
- Vínculo com token: `token:link-character` (GM, ou dono do token que também é dono da ficha). Apagar a ficha desvincula os tokens (`token:updated` com `characterId = null`). Na mesa, clicar num token vinculado a uma ficha visível abre a ficha; o token mostra uma barra com o recurso apontado por `tokenBar` no JSON do sistema (atual/máximo da ficha, via `computeCharacter`).
- UI: a ficha abre numa gaveta lateral (`CharacterSheetDrawer`) com modo visualização (clique rola) e modo edição. Jogador tem o botão "Meu personagem" na barra superior (estado vazio + "Criar personagem" se não tiver ficha); o GM tem "Fichas", com todas as fichas da sala.
- **Classes e raças** (fase 4) são itens: `level.classes` no JSON aponta o tipo de item de classe e seus campos de níveis e "classe inicial"; `resources[].perLevel` diz como PV/PM acumulam por nível (`firstLevelField` no 1º nível da classe inicial, `classField` nos demais, `+ attribute`, piso `minPerLevel`; multiclasse soma). Quando a ficha tem ao menos uma classe e `manualProgression = false`, `computeCharacter` devolve `levelSource = "classes"`: nível = soma dos níveis (até `level.max`) e PV/PM ignoram `maxOverride` (a conta vai em `resources[].detail` para o tooltip). Sem classe, ou com "Modo manual" ligado, tudo continua digitado; fichas antigas não mudam.
  - Campos de item estruturados (`ItemFieldDef.type`): `attributeBonuses` (raça: CON +2), `attributeChoice` (Humano: +1 em 3 à escolha, guardada em `chosen`), `skillGrants` (perícias fixas + grupos "escolha N de [lista]", com `chosen`) e `size`. Valem para qualquer item ativo (não físico, ou físico equipado) e **não são gravados na ficha**: viram `computed.itemModifiers` (origem = id do item) e `skills[].grantedBy`; remover o item remove o efeito. `itemKinds[].maxCount` limita a quantidade (1 raça), conferido em `character:update` por `validateCharacterItems`.
  - UI: abas Classe e Raça em "Equipamentos e habilidades"; cabeçalho mostra "Guerreiro 3 / Arcanista 2" e o nível total com a soma no tooltip; nível e máximos de PV/PM ficam somente leitura (cadeado) com a conta no tooltip; botão "Modo manual" liga `manualProgression` copiando os valores calculados para os campos digitados. Escolhas (atributos flexíveis, perícias da classe) são chips que o dono marca fora do modo edição, com aviso "faltam N escolhas". Perícia concedida aparece com o checkbox travado e "Treinada por <item>". Modificadores vindos de itens aparecem travados na seção Modificadores. `movement` e `senses` da raça são só informativos.

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
| **Scene** | `id, roomId, name, mapUrl, mapWidth, mapHeight, grid(JSON), fog(JSON)` | `grid` e `fog` são JSON para evoluir sem migration. `fog` segue `FogConfigSchema` (§9.3) |
| **Token** | `id, sceneId, name, imageUrl, x, y, width, height, rotation, zIndex, visible, ownerId, color, characterId?, hp?(JSON)` | Coordenadas em **pixels do mapa**, não em células. `characterId` só muda por `token:link-character`. `hp` = `{ current, max } \| null` (§3.3), ignorado enquanto há `characterId` |
| **Character** | `id, roomId, ownerId?, name, kind, data(JSON)` | `data` segue `CharacterDataSchema` (atributos, perícias, recursos, modificadores, itens...). Colunas só para o que precisa de índice/permissão; o resto é agnóstico de sistema e evolui sem migration |
| **ChatMessage** | `id, roomId, participantId, nickname, kind, text?, roll?(JSON), item?(JSON)` | `roll` segue `DiceRollSchema` (dano da ficha traz `damage[]`, uma parcela rolada por tipo; `applied[]` acumula o que já foi aplicado em tokens, §3.3); `item` segue `ItemCardSchema` (kind `item`) |
| **InitiativeEntry** | `id, roomId, tokenId?, name, value, tiebreak, visible` | `currentIndex` e `round` ficam em memória por sala (perdem-se ao reiniciar o servidor; aceitável no MVP) |
| **SystemDefinition** | `id, name, attributes[], skills[], resources[], derived[], level, sizes[], damageTypeGroups[], damageTypes[] (com `color?`/`group?`/`healing?`), currencies[], traitFields[], equipStats[], itemKinds[], activation, skillTotal, rolls{}, damageAttribute, tokenBar, trainedBonus[]` | Arquivo JSON (`schemaVersion: 2`), **não** está no banco. Registrado em `packages/shared/src/systems.ts` e lido por server e web |

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
| `fog:update` | `{ sceneId, op }` com `op` = `add {shape}` \| `removeLast` \| `revealAll` \| `hideAll` \| `setEnabled {enabled}` | GM | `fog:updated` + reenvio dos tokens da cena conforme a visibilidade nova (§9.3) |
| `token:create` | `TokenCreate` | GM | `token:created` |
| `token:update` | `TokenPatch` (`id` + campos) | GM ou owner | `token:updated` |
| `token:delete` | `{ tokenId }` | GM ou owner | `token:deleted` |
| `token:link-character` | `{ tokenId, characterId \| null }` | GM, ou owner do token que é owner da ficha | `token:updated` |
| `token:apply-damage` | `{ messageId, targets: [{ tokenId, amount, multiplier? }] }` (`amount` já assinado: negativo tira PV, positivo cura) | GM, ou owner de cada token alvo (tudo-ou-nada) | `token:updated`/`character:updated` de cada alvo + `chat:message` com `roll.applied[]` atualizado |
| `character:create` | `{ name, kind?, ownerId? }` | todos (jogador: `ownerId` = ele, `kind` = pc) | `character:created` (NPC só para o GM) |
| `character:update` | `{ id, patch }` (patch raso de `CharacterDataSchema` + `name`, `ownerId`, `kind`) | GM ou owner (jogador não muda `ownerId`/`kind`) | `character:updated` |
| `character:delete` | `{ characterId }` | GM ou owner | `character:deleted` + `token:updated` dos tokens desvinculados |
| `character:roll` | `{ characterId, roll: {type: attribute\|skill\|initiative\|extra\|action, ...}, secret? }` (ação: `enhancements?: [{ id, times }]` aplica os efeitos dos aprimoramentos ao dano) | GM ou owner | `chat:message` (rolagem com `characterId`; dano com `damage[]` por tipo) |
| `character:use-item` | `{ characterId, itemId, enhancements?: [{ id, times }] }` | GM ou owner | `character:updated` (se houve custo) + `chat:message` (`kind:"item"`); recurso insuficiente ou aprimoramento inválido = ack erro, sem broadcast |
| `compendium:list` | `{}` | todos | ack `CompendiumEntry[]` do sistema da sala (sem broadcast; §9.4) |
| `chat:send` | `{ text }` | todos | `chat:message` (rolagem secreta só p/ GM + autor) |
| `initiative:add` | `InitiativeEntry` sem `id` | GM | `initiative:updated` |
| `initiative:update` | `{ id, ...campos }` | GM | `initiative:updated` |
| `initiative:remove` | `{ entryId }` | GM | `initiative:updated` |
| `initiative:next` / `prev` / `reset` | `{}` | GM | `initiative:updated` |
| `ruler:update` | `{ sceneId, ruler: { start, end } \| null }` (pixels do mapa) | todos | `ruler:updated` para os **outros** (efêmero: não persiste; `null` apaga) |

### Servidor → Cliente

| Evento | Payload |
|---|---|
| `room:participantJoined` / `room:participantLeft` | `Participant` (novo ou reconectado; cliente faz upsert) / `{ id }` (marca `connected = false`) |
| `room:activeSceneChanged` | `{ sceneId }` |
| `scene:created` / `scene:updated` | `Scene` |
| `fog:updated` | `{ sceneId, fog: FogConfig }` (estado completo; cliente substitui `scene.fog`) |
| `token:created` / `token:updated` | `Token` |
| `token:deleted` | `{ tokenId }` |
| `chat:message` | `ChatMessage` |
| `character:created` / `character:updated` | `Character` (jogadores só recebem `kind = "pc"`) |
| `character:deleted` | `{ characterId }` |
| `initiative:updated` | `InitiativeState` (estado completo, simples de sincronizar) |
| `ruler:updated` | `{ participantId, nickname, sceneId, ruler \| null }` (régua de outro participante; sem eco ao autor) |
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
  components/   Lobby, RoomPage (liga stores aos componentes), TopBar, Toolbar, VttCanvas,
                TokenInspector, SidePanel, ChatTab, InitiativeTab, CharactersTab,
                MapConfigModal, NicknamePrompt, Toasts, CharacterSheetDrawer (gaveta da ficha)
  components/compendium/  CompendiumPalette (paleta encaixada ou flutuante), EntryPreview, DragGhost (arrasto)
  components/character/  seções da ficha: CharacterHeader, AttributesGrid, ResourcesBlock,
                DerivedStatsBar, SkillsSection, ItemsSection, ModifiersSection, DetailsSection,
                fields.tsx (inputs "commit on blur")
  store/        connection.ts (socket + emitAck), bindSocket.ts (broadcast → store),
                room.ts, tokens.ts, chat.ts, initiative.ts, characters.ts, ui.ts (toasts),
                tools.ts (ferramenta ativa, régua), compendium.ts (entradas, paleta, arrasto)
  lib/          router.ts (2 rotas, sem lib), api.ts (HTTP), grid.ts (célula↔pixel, puro),
                session.ts (localStorage), throttle.ts, useImage.ts, system.ts (useSystemDef), ids.ts,
                useToolShortcuts.ts (V/H/R/Esc/espaço), compendium.ts (regras de inserção, puro),
                dropTargets.ts (alvos de soltura por data-drop-target)
apps/server/src/
  index.ts, env.ts, db.ts
  http/         rooms.ts, upload.ts
  socket/       index.ts, types.ts, ack.ts (validação Zod + ack), room.ts, scene.ts,
                token.ts, chat.ts, initiative.ts, character.ts, ruler.ts (efêmero), compendium.ts
  services/     serialize.ts (Prisma → shared), snapshot.ts, presence.ts,
                initiativeState.ts, permissions.ts, chatCommands.ts, ids.ts,
                characters.ts (Prisma ↔ Character, visibilidade, broadcast),
                rolls.ts (rola, persiste e publica; usado pelo chat e pela ficha),
                compendium.ts (sistema + sala via mergeCompendium; a sala ainda é um stub vazio)
packages/shared/src/
  schemas/      (Zod, inclui payloads.ts e character.ts)  events.ts
  dice/         parser + roller, puro, sem I/O
  rules/        placeholders.ts, modifierTarget.ts (regex do target),
                compute.ts (computeCharacter), rolls.ts (buildCharacterRoll), defaults.ts
  systems.ts    registro dos JSONs (getSystemDefinition)
  compendium/   registro dos compêndios (subpath @tormenta-vtt/shared/compendium, só o servidor importa)
packages/shared/systems/
  tormenta20.json
  tormenta20/compendium/{classes,races,weapons,armor,spells,powers}.json
```

## 8. Estado da implementação

Todos os itens do MVP acima estão implementados (setembro/2026), incluindo a ficha básica (§3.6). Limitações conhecidas:
- Ficha: o compêndio (§9.4) vem dos packs do Foundry e tem lacunas listadas em `scripts/import-report.md` (proficiências e limite de atributo das armaduras pesadas, sentidos/perícias das raças, páginas ausentes, fórmulas com variáveis do Foundry); o compêndio da sala (homebrew) só existe como interface. Deslocamento e sentidos da raça não alimentam `derived[]`; poderes de classe por nível ficam de fora. Consumíveis usam a mesma ativação de poderes/magias, mas a quantidade não é descontada ao usar.
- `character:update` é um patch raso: editar um item reenvia a lista `items` inteira (fichas são pequenas; ok por ora).
- Só existe UI para uma cena por sala (`scene:create`/`scene:activate` funcionam no servidor, sem botão no web).
- `currentIndex`/`round` da iniciativa e a presença (`connected`) se perdem ao reiniciar o servidor.
- Uploads ficam em disco (`apps/server/uploads/`), sem limpeza de arquivos órfãos.
- Névoa (§9.3): só "desfazer último" (sem histórico completo nem refazer); sem luz dinâmica, paredes ou visão por token; a visibilidade de um token olha só o centro dele; `fog:updated` sempre manda a lista completa de shapes (limitada a 500).

## 9. Fase 2 (pós-MVP)

Funcionalidades entregues depois do MVP, na ordem em que entraram. O §1 continua descrevendo só o MVP.

### 9.1 Ficha de personagem
Descrita em §3.6 (entrou em setembro/2026). Poderes e magias com ativação são a "fase 3" da ficha (`docs/plano-passo3.md`); classes e raças como itens, a "fase 4" (`docs/plano-passo4.md`).

### 9.4 Compêndio
Biblioteca de itens pré-definidos que o jogador puxa para a ficha (setembro/2026). Plano e decisões em `docs/plano-compendio.md`.

- **Modelo**: `CompendiumEntry` (`packages/shared/src/schemas/compendium.ts`) = `CharacterItem` sem `id`: `{ id, name, kind, tags[], fields, actions? (sem id), activation?, enhancements? [{ id, cost, repeatable }], save?, statBonuses?, slots?, price?, description?, page? }`. Inserir na ficha faz uma **cópia** (`entryToItem`, ids novos para item e ações; aprimoramentos vão com o texto já preenchido), nunca um vínculo. No repositório só há mecânica: `description` e `enhancements[].label` ficam vazios e `page` (página do livro) é copiada para o item, para a ficha mostrar "Ver livro, pág. X" quando não há texto.
- **Dados**: `packages/shared/systems/<sistema>/compendium/*.json`, lidos do disco pelo loader (`src/compendium/index.ts`, subpath `@tormenta-vtt/shared/compendium`, fora do barrel para o web não empacotar os JSONs). Dois tipos de arquivo: `custom.json` (array editado à mão, confirmado no livro) e os **gerados** (`{ "$generated": "...", "entries": [...] }`; não editar à mão). Precedência por id: `custom.json` vence; entre gerados, o primeiro em ordem alfabética. `validateCompendiumEntry` confere cada entrada contra o JSON do sistema (tipo de item, campos e opções, ativação/resistência só nos tipos que têm, stats permitidos, perícias de ataque); um teste roda isso em todo arquivo.
- **Importador** (`pnpm import:compendium [--with-descriptions] [--source <dir>]`, `scripts/import-foundry-compendium.ts`; plano e mapeamento em `docs/plano-importador.md`): lê os YAML de `packs/_source` do sistema Tormenta20 para Foundry, mapeia para `CompendiumEntry`, valida com o mesmo `validateCompendiumEntry` (entrada inválida derruba o script) e grava `classes/races/weapons/armor/gear/consumables/spells/powers.json` mais `scripts/import-report.md`. Idempotente: ids são o slug do nome (colisão ganha sufixo do subtipo ou o `_id` do Foundry), saída ordenada por id, sem timestamps; ids presentes em `custom.json` são pulados. Cada entrada leva `$source` com o uuid do Foundry (o Zod descarta chaves `$...`). Regras que o Foundry não traz e foram decididas com o livro: PV inicial de classe = 4 × PV por nível; `power.type` ganhou `habilidade` e `distincao`; `maxAttr` de armadura não é importado (TODO no relatório). Tudo o que não tem correspondência (proficiências de classe, sentidos de raça, alcances/execuções fora dos enums, fórmulas com variáveis `@` do Foundry, efeitos ativos) vira lista de TODO no relatório, nunca valor inventado.
- **Descrições** (texto do livro, fora do git): `--with-descriptions` converte o HTML do Foundry para texto simples (parágrafos, `**negrito**`, listas, links viram só o rótulo) e grava `descriptions.local.json` (`{ id: texto }` mais `{ "id#eN": texto }` com o texto de cada aprimoramento, coberto por `*.local.json` no `.gitignore`). O servidor preenche `description` e `enhancements[].label` a partir dele ao montar o compêndio, se o arquivo existir; sem ele, preview e ficha mostram "Ver livro, pág. X". Aprimoramentos: os effects `onuse`+`self` do Foundry (o filtro do diálogo de uso de lá) viram `enhancements[{ id: "eN", cost, repeatable, effect? }]` em magias, poderes e consumíveis, com `repeatable` = flag `aumenta` ("Múltiplas Aplicações"); a lista "+N PM: ..." continua no fim da descrição. `effect` só é preenchido quando a frase inteira casa um padrão estrito ("aumenta o dano em +XdY", "+XdY de dano" → `damageDiceAdd`; com sufixo "de <tipo>" — "+4d6 de dano de frio" — o rótulo vira `damageType` pelos `damageTypes[]` do sistema, sem acento/caixa; tipo que o sistema não tem fica só custo e entra no TODO; "muda o dano para XdY" → `damageSet`; "aumenta a cura em +XdY" / "+XdY de cura" → `healDiceAdd`; "aumenta a CD em +N" → `dcAdd`; "muda o alcance para <unidade>" → `rangeSet` e "muda a duração para [N] <unidade>" → `durationSet`, com o rótulo casado em `activation.rangeUnits`/`durationUnits`; "muda a área para <texto>" numa frase só → `areaSet`; "aumenta o número/a quantidade de alvos em +N" / "+N alvos" → `targetsAdd`; `attackBonusAdd` e `text` nunca são preenchidos pelo importador); frases compostas ("muda o alcance para médio e a duração para cena") não casam; nunca inferido. Os demais ficam só custo e o relatório os lista por categoria (dano fora do padrão, alvo adicional, alcance, duração, outro), fora do total de TODO, para o jogador completar na ficha. Truque (custo vazio em magia) e custo negativo ficam só na descrição; effects `onuse` sem `self` (aprimoramentos que um poder concede a outras magias) não são modelados e só contam no relatório.
- **Servidor**: `compendium:list` devolve `mergeCompendium([sistema, sala])`; a fonte da sala (homebrew do GM, prioridade maior, id repetido substitui) é um stub vazio até existir tela e tabela.
- **Inserção** (`useCharacters.insertFromCompendium`, chamada por Enter, "+" e soltar): `checkInsert` lê `itemKinds[].maxCount` (2ª raça não é inserível; a paleta oferece "Substituir"); `buildInsertPatch` marca a primeira classe como inicial e aplica o `size` de um item com esse campo à ficha. Passa pelo `character:update` normal (otimista + ack). Escolhas pendentes seguem o fluxo de "faltam N escolhas".
- **UI**: paleta em coluna (busca, chips, lista, preview abaixo da lista), só em modo edição. Em janelas com pelo menos 1180 px ela **encaixa à esquerda da ficha** como painel lateral de 384 px (irmã do painel da ficha; a ficha não muda de tamanho nem de posição); abaixo disso flutua por cima da ficha, alinhada à esquerda. Em janelas baixas (≤ 640 px) lista e preview viram abas "Resultados"/"Detalhes". Abre pelo botão "Do compêndio" (já filtra pela aba ativa) ou atalho: Ctrl+Espaço, Ctrl+Shift+Espaço (o Brave às vezes engole o primeiro) ou "/" com o foco fora de campo de texto. O listener é do drawer da ficha (janela, fase de captura, só em modo edição) e chama `preventDefault`. Busca sem acento/caixa por nome, tags e id; chips por tipo (multi-seleção); resultados agrupados por tipo; preview à direita com o resumo mecânico e quantas escolhas a ficha vai pedir. Setas navegam, Enter insere e fecha, Ctrl+Enter insere e mantém, Esc fecha, "+" na linha insere e mantém. Após inserir, a ficha troca para a aba do tipo e destaca o item por um instante.
- **Arrastar e soltar**: pointer events (não HTML5 drag, por causa do Konva). Fantasma segue o cursor; no modo flutuante a paleta fica translúcida e sem `pointer-events` para `elementFromPoint` achar a ficha (encaixada ela nunca cobre a ficha), que ganha um halo; soltar na ficha insere e fecha a paleta, fora cancela, Esc cancela. `lib/dropTargets.ts` registra alvos por `data-drop-target` (`accepts`, `onDrop`); hoje só a ficha, preparado para o mapa aceitar entradas depois.

### 9.2 Barra de ferramentas e régua
Descritas em §3.2: modos Selecionar / Mover mapa / Régua com atalhos, caixa de seleção, movimento em grupo e a régua efêmera (`ruler:update`).

### 9.3 Fog of war manual
Névoa pintada à mão pelo GM. **Sem** luz dinâmica, paredes ou visão por token (ficam para depois). Plano e decisões em `docs/plano-fog.md`.

- **Modelo**: `Scene.fog = { enabled, base: "hidden" | "revealed", shapes: FogShape[] }` (`FogConfigSchema`, `packages/shared/src/schemas/fog.ts`). `FogShape = { id, mode: "reveal" | "hide" }` + geometria em **pixels do mapa**: `circle {cx, cy, r}`, `rect {x, y, width, height}`, `polygon {points}` ou `stroke {points, width}` (pincel: um arrasto inteiro vira uma polilinha com largura, e não dezenas de círculos). A área visível é a composição em ordem: parte de `base` e a última shape que contém o ponto decide (`isPointRevealed`, `packages/shared/src/fog/visibility.ts`, usada por cliente e servidor).
- **Eventos**: `fog:update { sceneId, op }` (GM) com as operações `add`, `removeLast` (desfazer último; sem histórico completo), `revealAll` / `hideAll` (limpam a lista e setam `base`) e `setEnabled`. O cliente manda a operação, não a lista, para dois cliques rápidos não se sobrescreverem. O servidor aplica, persiste e faz broadcast de `fog:updated` com o estado completo.
- **Visibilidade de tokens**: o GM vê todos. O jogador vê um token se `visible` e (é dono, ou fog desligado, ou o **centro** do token está em área revelada). Token que o jogador não pode ver **não é enviado** (mesmo mecanismo de `visible = false`: `token:deleted` ao esconder, `token:updated` ao reaparecer), então nem nome nem existência vazam. Como "é dono" varia por pessoa, o broadcast vai para a sala do GM, a sala do dono e `players` exceto o dono. Após `fog:update` o servidor reenvia todos os tokens da cena com essa regra; o snapshot filtra igual. O cliente aplica a mesma função nos tokens alheios para cobrir broadcasts fora de ordem.
- **Renderização**: camadas mapa → tokens que o usuário **não** controla → névoa → tokens que controla → réguas. Jogador vê a névoa preta opaca; GM a vê a 50% (opacidade CSS no canvas da Layer, para o `destination-out` das áreas reveladas continuar exato). Shapes `reveal` apagam com `destination-out`; `hide` pintam preto por cima.
- **Ferramentas** (só GM, modo Névoa, atalho **F**): sub-modos Revelar / Ocultar; formas Pincel (círculo que segue o arrasto, tamanho ajustável), Retângulo e Polígono (cliques; duplo clique fecha; Esc cancela); botões Desfazer último (Ctrl+Z no modo Névoa), Revelar tudo, Ocultar tudo e o toggle "Fog ativo". O pincel envia ao soltar o mouse, nunca a cada movimento, com os pontos decimados.
- **Limite de shapes** (decisão): o cliente avisa o GM ao passar de 400 e o servidor recusa `add` acima de 500 (constantes `FOG_SHAPES_WARN` / `FOG_SHAPES_MAX`). Não há mesclagem automática de geometria: unir polígonos com precisão é complexo, e na prática um arrasto já é uma shape só e "Revelar/Ocultar tudo" zera a lista. Cada shape aceita no máximo 2000 pontos.
