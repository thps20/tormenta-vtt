# Tormenta VTT — Especificação do MVP

> Documento vivo. Descreve **o que** o MVP faz, o modelo de dados e o contrato de eventos.
> A fonte da verdade dos tipos é `packages/shared/src` (Zod). Se este doc e o código divergirem, o código vence e este doc deve ser atualizado.

## 1. Visão

VTT (Virtual Tabletop) web para jogar RPG de mesa online com amigos. Primeiro sistema: **Tormenta20**.
Arquitetura **agnóstica de sistema**: tudo que é regra (atributos, perícias, fórmulas) vive em `packages/shared/systems/<id>.json`, validado pelo `SystemDefinitionSchema`. O código nunca conhece "FOR" ou "Percepção".

**Fora do MVP** (explicitamente): login/contas, fog of war, medição de distância, áudio/vídeo, compêndio de magias/itens/classes (entrou depois: §9.4), automação avançada da ficha (efeitos ativos, poderes por nível com escolhas). O que já foi feito além do MVP está em **§9 Fase 2** — inclusive múltiplos mapas por sala (§9.7, setembro/2026).

**Nomenclatura — "mapa" vs. "cena"**: em Tormenta20 **cena** é uma unidade de tempo de jogo ("dura uma cena", "até o fim da cena"), diferente da imagem com grid e tokens onde os personagens estão. Pra não confundir as duas coisas: **tudo que o usuário vê diz "mapa"** (UI, toasts, mensagens de erro do servidor); o nome interno continua `Scene` (modelo Prisma, `SceneSchema`, `sceneId`, eventos `scene:*`) — trocar isso seria um diff gigante sem ganho pra quem joga, e o código já fala inglês por convenção (`cellSize`, `ownerId`). Nos docs, "mapa" na prosa e `Scene`/`sceneId` só quando o texto fala da entidade/coluna. Ver docs/plano-mapas.md §1.

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
- URL do GM: `/room/<inviteCode>?gm=<gmSecret>` — URL do jogador: `/room/<inviteCode>`. Qualquer uma
  aceita também `&session=<sessionToken>` (`lib/router.ts#consumeSessionParam`): grava o token no
  `localStorage` (mesma chave de sempre, por papel — "gm" se `?gm=` também estiver na URL, senão
  "player") e some da URL sozinho ao carregar (`history.replaceState`, sem recarregar), pra
  reconectar como um participante específico por um link só, sem precisar que ele já tenha entrado
  antes nesse navegador. Uso principal: `make seed-test` (`docs/testar-com-amigos.md`).
- Ao abrir a URL, o cliente pede nickname (se não houver `sessionToken` salvo) e emite `room:join`.
- Servidor responde com `RoomSnapshot` (estado completo, inclui `sessionToken`) e faz broadcast de `room:participantJoined`.
- Ao desconectar, o servidor faz broadcast de `room:participantLeft { id }`; o participante **continua** na lista com `connected = false` (jogadores online = `connected = true`).
- O Lobby (`/`) tem só dois cards: criar sala e entrar com código. Não há lista de salas recentes no MVP.
- Ao criar a sala, o servidor cria automaticamente um mapa "Mapa 1" vazio e o define como ativo.

### 3.2 Mapa e grid (GM)
- `POST /api/upload` (multipart, PNG/JPG/WebP, máx. 20 MB) → salva em `apps/server/uploads/` e devolve `{ url, width, height }`.
- GM emite `scene:setMap` com a URL e dimensões. Servidor persiste e faz broadcast de `scene:updated`.
- Painel de grid: tipo (`square`/`none`), `cellSize` (px), `offsetX/Y`, cor, snap. Emite `scene:updateGrid`.
- **Calibrar pela imagem** (docs/plano-grid.md, `GridCalibrator.tsx`): botão no modal "Configurar mapa", desabilitado sem imagem. Arrasta-se um retângulo SEMPRE quadrado sobre uma célula do desenho (zoom livre com a roda, pan com Espaço+arrasto ou botão do meio); `cellSize = lado do retângulo / N` e `offsetX/Y = canto do retângulo módulo cellSize`, onde N ("Cobre N células", padrão 1) deixa arrastar sobre várias células pra ganhar precisão. Prévia do grid ao vivo sobre a imagem; ajuste fino por teclado (setas ±1px, Shift ±0,1px na posição; +/− no tamanho da célula) ou pelos campos numéricos. "Aplicar" só preenche `cellSize`/`offsetX`/`offsetY` nos campos do modal — quem persiste de verdade continua sendo "Salvar" do modal (`scene:updateGrid`); "Cancelar" descarta tudo. `cellSize`/`offsetX`/`offsetY` aceitam decimal (`GridConfigSchema`, sem `.int()`) porque uma calibração real quase nunca cai num valor redondo. Só calibração manual — não detecta grid já desenhado na imagem. Como `Token.cells` é a fonte da verdade do tamanho (docs/plano-grid.md), recalibrar NUNCA muda o tamanho relativo dos tokens — só reencaixa a posição deles (mesmo caminho de `scene:updateGrid` normal, §9.7).
- O canvas (react-konva) desenha: imagem do mapa → linhas do grid → tokens → réguas/caixa de seleção. Pan no modo "Mover mapa" (ou espaço segurado); zoom com scroll e botões +/−/ajustar.
- **Barra de ferramentas** (coluna à esquerda do canvas, um modo por vez, estado em `store/tools.ts`, atalhos em `lib/useToolShortcuts.ts`):
  - **Selecionar (V)**: clicar num token só seleciona (mantém o TokenInspector aberto, não abre ficha); duplo clique abre a ficha vinculada, se houver e o usuário puder vê-la (token sem ficha: duplo clique não faz nada além de selecionar); botão direito sempre abre o menu de condições (§3.3), mesmo em token com ficha — padrão Foundry. Arrastar no mapa vazio desenha uma caixa que seleciona os tokens com o centro dentro dela; shift+clique entra/sai da seleção; arrastar um token selecionado move todos os selecionados que o usuário controla. Arrastar um token que NÃO está selecionado já o seleciona no ato — padrão Foundry, `docs/fix-movimento-turno.md` — trocando a seleção por só ele (shift+arrastar entra na seleção atual em vez de trocar, mesma regra do shift+clique); o arraste em si sempre move só o token agarrado, os outros da seleção entram no próximo arraste. O Stage não faz pan. Duplo clique é detectado por geometria (dois `mousedown` no mesmo token dentro de ~300 ms), não pelo `dblclick` nativo do Konva — mesmo motivo do hit de token/badge de condição (`docs/debug-condicoes.md`): o canvas de hit do Konva é embaralhado por proteção anti-fingerprinting.
  - **Mover mapa (H)**: arrastar em qualquer lugar faz pan; tokens não respondem. Barra de espaço segurada ativa este modo temporariamente.
  - **Régua (R)**: clicar e arrastar mede do ponto inicial ao ponteiro (pontos grudam no centro da célula quando há grid e snap). A distância usa `grid` do `SystemDefinition` (`cellSize` na unidade do jogo, `unit`, regra de diagonais `euclidean | manhattan | alternating | chebyshev`; `rules/measure.ts` faz a conta) e o `cellSize` em px da cena. A régua é enviada por `ruler:update` (efêmero) e os outros a veem com o nickname do autor; some ao soltar.
  - **Névoa (F, só GM)**: fog of war manual, descrita em §9.3. Desenho: botão reservado (desabilitado), fora do MVP.
  - **Pino (P, só GM)**: clique no mapa abre o formulário de um pino de nota (título, texto, ícone/cor, visibilidade) — ver §9.16. Fixar um pino de handout é feito arrastando um card da biblioteca (§9.10), não por esta ferramenta.
  - Esc cancela o gesto em andamento e volta para Selecionar. Scroll = zoom em todos os modos.
  - **Desfazer/refazer (Ctrl+Z / Ctrl+Shift+Z ou Ctrl+Y, só GM)**: com a ferramenta Névoa ativa, Ctrl+Z desfaz a última forma pintada (§9.3, sem refazer); fora dela é o desfazer geral descrito em §9.6. Fora de campo de texto (`isTyping`), igual aos outros atalhos.
- Sem mapa (`mapUrl = null`) o canvas desenha um retângulo escuro de `mapWidth × mapHeight` (padrão 1600×1100) só para o grid e os tokens terem onde ficar.
- Renomear, duplicar, apagar e reordenar mapas, e navegar entre vários da mesma sala: §9.7.

### 3.3 Tokens
- Criar: GM clica "Novo token" → aparece no centro da viewport com `cells: 1`. Opcional: imagem via `/api/upload`.
- Arrastar: durante o drag o cliente emite `token:update {id, x, y}` com throttle (~30/s). Ao soltar, se `grid.snap`, alinha à célula mais próxima e emite a posição final.
- **Setas/WASD** movem o(s) token(s) selecionados (Shift = 5 células), com o mesmo snap do arraste; com combate ativo, a trava de turno vale pro teclado igual ao arraste (§9.11).
- Redimensionar: handles nos cantos (Konva Transformer), sempre em célula inteira — a alça "pula" de célula em célula durante o arrasto (`docs/plano-grid.md`). Emite `token:update {id, cells}`.
- Permissão: servidor rejeita `token:update`/`token:delete` de jogador que não é `ownerId` do token (ack `{ ok: false }`).
- Todo `token:*` aceito é persistido e reenviado a todos na sala (inclusive quem enviou, para manter uma única fonte de verdade).
- Tokens com `visible = false` não são enviados a jogadores. Se o GM oculta um token visível, jogadores recebem `token:deleted`; se torna visível de novo, recebem `token:updated` (o cliente trata `token:updated` como upsert).
- Jogador (dono) só pode alterar `x, y, cells, rotation, conditions`; o servidor ignora os demais campos do patch. Nome, cor, dono, visibilidade e imagem são só do GM (painel do token).
- **PV do token solto** (`Token.hp: { current, max } | null`, painel do token, só GM): só vale enquanto o token não tem `characterId`; vinculado a uma ficha, quem manda é o recurso `tokenBar` dela (§3.6). `null` = sem PV definido, o token não aparece como alvo de `token:apply-damage`.
- **Condições** (`Token.conditions: TokenCondition[]`, `{ key, expiresRound? }` — chave de `SystemDefinition.conditions[]`, §3.6; `expiresRound` ausente = permanente): menu com toggle por condição, aberto pelo botão direito no token ou pelo botão "Condições" do painel — GM em qualquer token, jogador só nos que possui (`token:update` normal, sem evento novo; servidor rejeita chave que não existe no sistema da sala). Uma ficha salva antes de `expiresRound` existir grava só a chave (`string`); o schema aceita as duas formas (`z.preprocess`, sem migration de dado). Render: ícones pequenos na borda inferior do token (máx. 6 visíveis, o resto vira "+N"), tooltip no hover com nome e descrição; condição com duração ganha um selinho com as rodadas restantes no canto do ícone (mesmo número no painel de combate, ao lado do ícone da linha do combatente). Cada condição pode ter `modifiers[]` no JSON (mesmo formato `{ target, value }` do Modificador da ficha, §3.6), mas isso ainda é só estrutura — nenhuma automação de regra por enquanto.
  - **Duração em rodadas** (docs/plano-duracao-condicoes.md): com um combate ativo na cena (`status !== "ended"`) e a condição marcada, o menu mostra um campo opcional "duração (rodadas)" — vazio = permanente. Convertido para `expiresRound` via `deriveExpiresRound(round, N)` (`packages/shared/src/rules/conditions.ts`): com o combate em `"rolling"` (`round` 0, ainda rolando iniciativa) conta a partir da rodada 1, senão uma condição marcada antes do primeiro "Próximo" expiraria na própria virada pra rodada 1, sem nunca ter valido. `SystemDefinition.conditions[].defaultDuration?` pré-preenche o campo ao marcar (ex.: Surpreendido = 1). Condição já marcada pode ganhar, editar ou remover a duração pelo mesmo campo.
- **Aplicar dano/cura em token** (card de rolagem com `damage[]` no chat): botão "Aplicar" (GM sempre; jogador só em tokens que possui) abre um seletor dos tokens da cena atual (nome, PV atual/máximo, dono, busca, multi-seleção) com um multiplicador por alvo (×1, ×½ "reduz à metade" arredondado pra baixo, ×2, ×0) e ajuste manual — já abre com os alvos marcados pré-selecionados, se houver (§9.12). Confirma → `token:apply-damage { messageId, targets: [{ tokenId, amount, multiplier? }] }`; `amount` já vem com sinal (negativo tira PV, positivo cura) e é **sempre** o que o Mestre confirmou (ele pode editar livremente — o servidor nunca recalcula esse valor, ver "Sugestão pelo tipo de dano" abaixo). O servidor valida tudo-ou-nada (todos os alvos, senão nenhum) e aplica: dano gasta PV temporário antes do atual (`applyResourceDelta`, `packages/shared/src/rules/resources.ts`), travado no mín./máx. calculado (ficha) ou em `0..max` (token solto); broadcast normal (`token:updated`/`character:updated`). O card acumula o resultado em `roll.applied[]` ("Aplicado: Goblin −7, Orc −3 (½)"), sem sobrescrever aplicações anteriores; cada entrada carrega também `raw`/`adjustment` (decomposição bruto/ajuste — ver abaixo), num tooltip discreto sobre o valor. PV mínimo/inconsciência não é automatizado — só o número.
- **Resistência pelo tipo de dano** (`suggestDamage`, `packages/shared/src/rules/damageResponse.ts`, §9.5): ao marcar um alvo com ficha vinculada, o multiplicador já vem pré-selecionado pela `damageResponses` dela (imune → ×0, vulnerável → ×2, "reduz à metade" → ×½) e aparece um aviso ao lado com a conta ("sugerido 7 → 3 · Resistente a fogo (RD 4)"). RD ou dano de tipos mistos calcula o valor mas deixa o multiplicador livre (a conta não bate com um botão só). Este preview é calculado no **cliente** (`ApplyDamageButton`), chamando a mesma `suggestDamage` pura do shared que o servidor chama — sem evento de preview algum (decisão registrada em `docs/plano-criaturas.md` §0.4: os dois lados calculam igual, o servidor nunca confia no que o cliente mostrou). O Mestre sempre confirma ou troca o valor antes de enviar; o que ele confirmar é o que é aplicado (`amount`, acima) — o servidor **não** substitui esse número pelo sugerido. Ele recalcula por conta própria (de novo com `suggestDamage`, contra a resposta a dano ATUAL do alvo — token solto usa uma resposta neutra) só pra gravar a decomposição no card: `raw` (bruto, com sinal) e `adjustment` (quanto a resistência mudaria o bruto, com sinal) — `raw + adjustment` é o **sugerido** pelo servidor, não necessariamente igual a `amount` quando o Mestre editou à mão. Registro/auditoria, nunca aplicação automática.

### 3.4 Chat e dados
- Input único. Texto normal vira `ChatMessage{kind:"text"}`. Outros tipos: `roll` (rolagem), `system` (aviso) e `item` (card de poder/magia usado pela ficha, ver §3.6).
- Comandos:
  - `/r <fórmula> [# rótulo]` — rola no **modo de rolagem** atual do autor (abaixo), ex.: `/r 2d6+3`, `/r 1d20+5 # Ataque`.
  - `/gmr <fórmula>` — força rolagem secreta (só o GM vê); `/gr` é sinônimo. `/pr <fórmula>` — força rolagem pública.
  - `/w <nickname> <mensagem>` — sussurro (docs/plano-narracao.md): manda uma mensagem de texto visível só pro GM, o autor e quem tem esse nickname (case-insensitive). Nickname de mais de uma palavra funciona com aspas (`/w "Ana Maria" oi`) ou sem — sem aspas, casa o MAIOR prefixo do texto que é nickname de alguém da sala ("Ana Maria" antes de "Ana", se as duas existirem); nickname inexistente ou repetido por dois participantes: o ack devolve erro e a mensagem NÃO é enviada (nem sussurrada, nem como texto normal — o autor claramente tentou sussurrar). Autocomplete com Tab (entre aspas sozinho quando o nickname tem espaço).
- **Modo de rolagem** (botão na faixa "Rolar" do chat, ao lado dos dados rápidos, com ícone e rótulo; clique alterna para o próximo, clique longo ou a seta abre o menu com os três):
  - **Pública** (`visibility: "all"`): todos veem.
  - **Secreta** (`"gm"`): só o GM vê. Se quem rolou é jogador, ele **não** vê o próprio resultado (rolagem às cegas; o ack volta sem `roll` e o cliente mostra o toast "Rolagem às cegas enviada ao GM"). O GM vê quem rolou e o resultado.
  - **Própria** (`"self"`): só quem rolou vê (nem o GM).
  - O modo vale para tudo que a pessoa rolar (faixa, `/r`, ficha, botões dos cards) até trocar; persiste na aba (`sessionStorage`). `/gmr` e `/pr` forçam secreta/pública pontualmente. Texto e cards de item (`character:use-item`) são sempre públicos.
  - Fora de "Pública", o campo do chat ganha borda âmbar e o rótulo do modo à direita.
  - `ChatMessage.visibility` (`all | gm | self`) é filtrado pelo servidor no broadcast e no snapshot (`messageVisibleTo`, `apps/server/src/services/chatVisibility.ts`). Quem não pode ver o resultado **não fica sem a mensagem**: recebe a mesma mensagem sem `roll`/`item`/`text` (placeholder "Fulano fez uma rolagem secreta/própria", `apps/server/src/services/chatVisibility.ts#redactMessage`) na hora da rolagem, e o cliente mostra um card oculto no lugar do card de rolagem. O GM tem o botão **Revelar** (`chat:reveal`) nesse card, que muda `visibility` para `all` e reenvia a mesma mensagem (mesmo `id`) a todos com o conteúdo completo: o cliente faz upsert ordenado por `createdAt`, então o card oculto vira o card cheio no lugar.
  - **Sussurro** (`ChatMessage.whisperTo`, docs/plano-narracao.md): além do `/w` acima, um seletor "para" ao lado do botão de modo de rolagem escolhe um participante pontualmente — vale pra próxima mensagem (texto OU rolagem, inclusive `/r`), sem ficar "grudado" como o modo de rolagem: some sozinho depois de enviar. Setado, a mensagem existe só pro **GM, o autor e o alvo** (o autor sempre recebe a própria mensagem, mesma regra de qualquer outra — bug corrigido, ver `docs/revisao-narracao.md`) — nem card, nem placeholder pros demais, independente de `visibility` (que o servidor força para `"all"` quando há sussurro — o `whisperTo` já restringe quem recebe). Mesmo campo/mecanismo que já existia só para `handout:show` "mostrar para X" (§9.10), agora reaproveitado pelo chat comum. O GM **sempre** vê um sussurro, mesmo entre dois jogadores que não são ele (mesma postura de sempre no projeto — nunca um sussurro cego pro GM); nesse caso (GM não é autor nem alvo) o card ganha o rótulo explícito "sussurro de X para Y" — autor vê só "para Y", alvo só "de X". Renderização com destaque visual (borda/fundo roxo).
  - **Rolagem ligada a um token** (`ChatMessage.tokenId`, opcional: combate — §3.5 — ou ficha com token vinculado a ela, em qualquer mapa da sala): quem não pode ver esse token (`visible = false` ou sob a névoa) **ou** cujo token está num mapa que não é o ATIVO da sala (mesmo que o token em si esteja perfeitamente visível — GM pode estar rolando num mapa que a mesa não vê, §9.7) não recebe a mensagem de jeito nenhum — nem o card, nem o placeholder acima — independente de `visibility`; o GM e o **autor da própria rolagem** sempre recebem (mesmo que o token dele esteja oculto ou no mapa errado), o gate vale só para os demais jogadores. Essa checagem roda **antes** e além da de `visibility` (`tokenGateOk`/`emitChatMessage` em `apps/server/src/services/chatVisibility.ts`) e é refeita do zero a cada snapshot (`room:join`): se o mapa depois vira o ativo (ou o token é revelado), a mensagem represada passa a ser entregue no próximo, sem reenvio ao vivo (mesma limitação anotada em `docs/backlog.md`). `character:roll`/`character:use-item` ligam a rolagem ao token vinculado à ficha em QUALQUER mapa (`findLinkedTokenId`, preferindo o ativo quando há mais de um) — sem isso a rolagem virava uma mensagem "solta" sem `tokenId`, sem gate nenhum. Rolagem solta de verdade (`/r` sem ficha vinculada) não tem `tokenId` e segue só a regra de `visibility`.
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
- Ataque com alvo marcado (§9.12): o card ganha uma linha por alvo ("Acertou **Goblin 2** (18 vs Defesa 15)").
- Placeholders de sistema (`{attr.for}`, `{skill.percepcao}`, `{derived.defense}`, `{level}`...) são resolvidos **antes** do parser a partir da ficha do autor. Regra do `/r`: o autor precisa ter exatamente **uma** ficha própria na sala; com zero ou várias, o ack devolve erro pedindo para rolar pela ficha (`character:roll`), que sabe qual usar.

### 3.5 Modo de combate
> Substitui o rastreador manual de iniciativa da versão anterior do MVP. Plano e decisões em `docs/plano-combate.md`; divergências encontradas na implementação em `docs/revisao-combate.md`.

- **Combate por mapa** (`Combat`, um por mapa — `Scene.combat?`, `@@unique` em `sceneId`; deixou de exigir "mapa ativo" — §9.7, docs/plano-mapas.md §7 — dois mapas podem ter combate ao mesmo tempo e ativar outro não encerra o anterior): `{ id, sceneId, round, status: "rolling" | "active" | "ended", activeCombatantId, combatants[] }`. Todo evento `combat:*` leva `sceneId`; jogador só age no mapa ATIVO da sala, GM em qualquer um que esteja vendo. `Combatant`: `{ id, tokenId, characterId? (cópia do token no momento em que entrou, só informativa), name/color (denormalizados do token na hora de enviar), ownerId (do token), initiative: number | null, rolled, bonus, delayed, surprised, order, addedRound, movementBudget, movementUsed, movementDiagonals, movementPath[] }` — os quatro últimos são o orçamento de deslocamento do turno (§9.11).
- **Regras do sistema** (`SystemDefinition.combat`, nunca hardcoded): `initiative` (fórmula de quem tem ficha vinculada), `initiativeNoSheet` (token sem ficha, `{bonus}` = valor manual do GM), `tiebreakBonus` (fórmula sem dado gravada em `Combatant.bonus` ao entrar), `tiebreak` (critérios de desempate após o valor, na ordem: T20 usa `["bonus", "order"]`), `surprise.rounds` (combatente surpreso é pulado nas N primeiras rodadas; `0` = sistema sem surpresa).
- **Fluxo**: GM seleciona tokens no mapa (ferramenta Selecionar) e clica "Iniciar combate" (`combat:start { sceneId, tokenIds, visibility? }`) — cria o combate com `status: "rolling"`; tokens podem ser adicionados (`combat:add { sceneId, tokenIds, visibility? }`, reforços, entram sem iniciativa) ou removidos (`combat:remove`) depois. **"Rolar iniciativa dos NPCs ao iniciar o combate"** (opção da sala, checkbox no painel de combate, só GM — `combat:set-auto-roll-npc-initiative`, memória, padrão **ligada**, mesmo padrão não-persistido de "ignorar limite de movimento", §9.11): ligada, `combat:start`/`combat:add` rolam sozinhos, no servidor, a iniciativa dos combatentes recém-entrados sem dono (`token.ownerId === null`) — um card em lote (mesmo mecanismo de `scope: "npcs"` abaixo), com o modo de rolagem de quem chamou (`visibility` do payload, ausente = "all"). Jogadores nunca são afetados: continuam rolando a própria pelo botão de sempre. Desligada, os NPCs entram sem iniciativa como sempre, e o GM rola à mão ("Rolar NPCs"/"Rolar que faltam", abaixo). `combat:next` com `status: "rolling"` inicia os turnos (`round = 1`); no último combatente que pode agir, incrementa a rodada e volta ao primeiro; `combat:prev` faz o inverso (rodada mínima 1) e **não restaura condição nenhuma** (decisão deliberada: "prev" corrige um clique errado do GM, não rejoga o combate). Combatente sem iniciativa nunca recebe turno, fica no fim da lista; a ordem (`sortCombatants`, `packages/shared/src/rules/combat.ts`) é recalculada a CADA `combat:updated`, `"rolling"` ou `"active"` — então a lista do `CombatPanel` já reordena sozinha a cada iniciativa que chega (maior primeiro, desempate por bônus), sem esperar o primeiro "Próximo"; como é o mesmo cálculo nos dois status, a ordem não pula quando os turnos começam — já é a mesma que estava sendo exibida. O cliente nunca reordena por conta própria: usa a lista na ordem em que o servidor mandou (`combat.combatants`), nunca o campo `order` de cada combatente (esse só entra como desempate final no servidor, ou quando o GM arrasta pra reordenar manualmente). surpreso é pulado enquanto `round <= surprise.rounds`; adiado (`combat:delay`, só no próprio turno) sai da rotação até "entrar agora" (`combat:resume`) — que copia iniciativa/bônus de quem está agindo e assume o turno na hora, deixando quem foi interrompido para agir em seguida. `combat:end { clear? }` encerra (`status: "ended"`, mantém a ordem visível) ou, com `clear: true`, apaga o combate.
- **Expiração de condições** (docs/plano-duracao-condicoes.md): quando `combat:next` faz a rodada avançar (`round` maior que antes, inclusive a virada de `"rolling"` pra `round = 1`), os tokens da cena com condição `expiresRound <= round` a perdem — um `token:updated` por token afetado (mesmo com várias condições vencendo juntas) e uma mensagem de chat `kind: "system"` por condição ("Goblin: Atordoado terminou"), com `tokenId` setado (só quem vê o token recebe, mesmo gate de sempre). `combat:end { clear: true }` faz o mesmo pelas condições com duração, não importa o valor de `expiresRound` — o combate acabou, então **não viram permanentes**, são removidas e listadas no chat do mesmo jeito; condição permanente (sem `expiresRound`) nunca é tocada por nenhum dos dois.
- **Rolagem**: `combat:roll { scope, combatantId?, visibility? }` rola no servidor; `combat:updated` sai uma vez só, no fim do lote. `scope: "self"` (GM ou jogador) rola os combatentes do autor (token que possui, ou cuja ficha vinculada é dele) que ainda faltam; `"one"` um específico; `"npcs"`/`"missing"` (só GM) os sem dono / todos que faltam. `visibility` é o modo de rolagem de quem clicou — inclusive do GM (sem forçar secreta para NPC automaticamente). Token sem ficha: rola por `combat.initiativeNoSheet` com o bônus manual; a UI mostra a faixa discreta "Combate iniciado — rolar iniciativa" para quem tem combatente sem `rolled`, e "É o seu turno" (com botão Adiar) para quem está agindo — ambas somem sozinhas quando deixam de valer; o título da aba pisca "▶ Seu turno" enquanto isso.
  - **Card no chat**: um `combatantId` só publica `ChatMessage{kind:"roll"}` normal (rótulo "Nome: Iniciativa", com `characterId` quando há ficha vinculada) — ganha de graça o card, "Revelar" e a rolagem às cegas (§3.4). Mais de um combatente de uma vez (`"npcs"`/`"missing"`, ou `"self"` com mais de um combatente do autor faltando) publica **um card só**, `ChatMessage{kind:"initiative-batch", initiativeBatch: { round, entries: [{ combatantId, tokenId, name, formula, result }] } }`, entradas ordenadas do maior resultado pro menor. Visibilidade em duas camadas: `visibility` (all/gm/self, igual a todo `ChatMessage`) decide se `formula`/`result` aparecem em cada linha para quem recebe o card (sem elas, a UI mostra só o nome e "rolou" — mesma regra de rolagem às cegas: o GM sempre vê, o autor só se `visibility` permite); e, por linha, o gate de token oculto/névoa (§3.4/§3.5) tira do jogador as linhas dos tokens que ele não pode ver — a linha simplesmente não existe na cópia dele, sem virar placeholder, e as demais linhas continuam normalmente; se nenhuma linha sobrar, ele não recebe o card. GM sempre recebe o card inteiro. "Revelar" (GM) muda `visibility` para `all` para todos — como o revelar normal — mas não afeta o gate de token: linha de token oculto continua ausente da cópia de quem não o vê.
- **Visibilidade**: jogador recebe só os combatentes cujo token pode ver (mesmo filtro de token/névoa de sempre) — oculto/na névoa não aparece nem some da posição: ao ser revelado, reaparece onde já estava, porque a ordem é sempre calculada sobre a lista completa no servidor e só depois filtrada. Jogador vê a ORDEM de todo mundo (nome, se já rolou), mas o **valor numérico** (iniciativa e bônus) só do **próprio** combatente (token que possui) — e mesmo assim não quando a última rolagem dele foi às cegas (`visibility: "gm"`, mesma regra de "rolagem às cegas" do chat: quem rolou não vê o próprio resultado); valor digitado à mão pelo GM (`combat:set-initiative`) não conta como às cegas, fica visível. Dos demais combatentes (inclusive de outros jogadores), nunca vê o valor. GM vê tudo sempre. Rolagens ligadas a um token que o jogador não pode ver (`visible = false` ou sob a névoa) **ou** cujo mapa não é o ATIVO da sala (mesmo com o token visível — GM pode rolar num mapa que a mesa não vê, §9.7) são omitidas por completo para ele — nem card, nem placeholder de "rolagem secreta" — independentemente do modo de rolagem de quem rolou; o **autor da rolagem sempre a recebe**, mesmo que o próprio token dele esteja oculto ou no mapa errado — o gate vale só para os demais jogadores; só o GM sempre recebe também (`ChatMessage.tokenId`, ver §3.4 e §5). Vale para `combat:roll` (inclusive linha a linha de um `initiative-batch`), `character:roll` (token vinculado à ficha, `findLinkedTokenId`) e `character:use-item`. Se o token depois for revelado, sair da névoa, ou o mapa dele virar o ativo, essas mensagens passam a ser entregues no próximo `room:join`/snapshot (não há reenvio ao vivo das mensagens já publicadas; anotado em `docs/backlog.md`).
- **GM**: reordenar arrastando (`combat:reorder`, grava `order`), editar valor à mão (`combat:set-initiative`, `null` volta pra "não rolou"), marcar/desmarcar surpresa (`combat:set-surprised`), adicionar/remover, pular turno, encerrar. Jogador: rolar a própria, adiar/retomar a própria. Opção por usuário (checkbox na aba, `localStorage`) de centralizar o mapa no token da vez.
- **Orçamento de deslocamento** (§9.11): toda vez que o combatente da vez muda (`combat:next`/`prev`/`delay`/`resume`, ou a remoção do ativo), o servidor resolve e grava um orçamento novo pra ele, zerando o gasto do turno anterior.
- **Mapa**: anel destacado no token da vez (visível para quem vê o token).
- UI nesta fase: mínima e funcional na aba Iniciativa (renomeada para o modo de combate); o visual definitivo virá do AI Studio depois.

### 3.6 Ficha de personagem
- Tudo que é regra vem do JSON do sistema (`SystemDefinitionSchema` v2): atributos, perícias (com tags, variantes como "Ofício" e flags de tamanho/armadura), recursos, stats derivados por fórmula (`derived[]`: Defesa, CD, carga...), tamanhos, tipos de dano, moedas, campos de traço, stats de equipamento (`equipStats`) e tipos de item com campos declarados (`itemKinds`).
- A ficha guarda só **entradas**: base dos atributos, treinado/outros por perícia, atual/temporário/máximo digitado por recurso, overrides de derivados, modificadores, traços, moedas, itens. Os valores finais vêm de `computeCharacter(def, character)` (função pura em `packages/shared/src/rules/compute.ts`), que servidor e cliente rodam igual. O cliente usa só para exibir; o servidor é quem monta e rola.
- **Modificador** = `{ target, value }` com `target` textual validado por regex (`attr.for`, `skill.luta`, `skill.*`, `skill[tag=ataque]`, `derived.defense`, `resource.pv.max`, `attack`, `attack.luta`, `damage`, `damage.pontaria`). Cobre bônus de poderes, condições e itens sem o código conhecer nenhuma chave.
- **Item** = tipo (`kind` de `itemKinds`), campos do tipo (`fields`), `equipped`, `statBonuses` (ex.: armadura dá `defense`, `maxAttr`, `armorPenalty`; só contam equipados) e **ações**: `attack` (perícia + atributo alternativo + margem de crítico), `damage` (fórmula + atributo `auto` pela regra `damageAttribute` do sistema + tipo), `check` e `formula` (fórmula livre; `damageType?` opcional — definido, a fórmula rola tal e qual em `damage[]`, sem somar atributo/bônus nem passar por aprimoramentos, só o suficiente pra ligar "Aplicar" no chat, §3.3). Blocos `activation` e `save` guardam a ativação e o teste de resistência de poderes/magias/consumíveis.
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
- Vínculo com token: `token:link-character` (GM, ou dono do token que também é dono da ficha). Apagar a ficha desvincula os tokens (`token:updated` com `characterId = null`). Na mesa, dar duplo clique num token vinculado a uma ficha visível abre a ficha (§3.3); o token mostra uma barra com o recurso apontado por `tokenBar` no JSON do sistema (atual/máximo da ficha, via `computeCharacter`).
- UI: a ficha abre numa gaveta lateral (`CharacterSheetDrawer`) com modo visualização (clique rola) e modo edição. Jogador tem o botão "Meu personagem" na barra superior (estado vazio + "Criar personagem" se não tiver ficha); o GM tem "Fichas", com todas as fichas da sala.
- **Classes e raças** (fase 4) são itens: `level.classes` no JSON aponta o tipo de item de classe e seus campos de níveis e "classe inicial"; `resources[].perLevel` diz como PV/PM acumulam por nível (`firstLevelField` no 1º nível da classe inicial, `classField` nos demais, `+ attribute`, piso `minPerLevel`; multiclasse soma). Quando a ficha tem ao menos uma classe e `manualProgression = false`, `computeCharacter` devolve `levelSource = "classes"`: nível = soma dos níveis (até `level.max`) e PV/PM ignoram `maxOverride` (a conta vai em `resources[].detail` para o tooltip). Sem classe, ou com "Modo manual" ligado, tudo continua digitado; fichas antigas não mudam.
  - Campos de item estruturados (`ItemFieldDef.type`): `attributeBonuses` (raça: CON +2), `attributeChoice` (Humano: +1 em 3 à escolha, guardada em `chosen`), `skillGrants` (perícias fixas + grupos "escolha N de [lista]", com `chosen`) e `size`. Valem para qualquer item ativo (não físico, ou físico equipado) e **não são gravados na ficha**: viram `computed.itemModifiers` (origem = id do item) e `skills[].grantedBy`; remover o item remove o efeito. `itemKinds[].maxCount` limita a quantidade (1 raça), conferido em `character:update` por `validateCharacterItems`.
  - UI: abas Classe e Raça em "Equipamentos e habilidades"; cabeçalho mostra "Guerreiro 3 / Arcanista 2" e o nível total com a soma no tooltip; nível e máximos de PV/PM ficam somente leitura (cadeado) com a conta no tooltip; botão "Modo manual" liga `manualProgression` copiando os valores calculados para os campos digitados. Escolhas (atributos flexíveis, perícias da classe) são chips que o dono marca fora do modo edição, com aviso "faltam N escolhas". Perícia concedida aparece com o checkbox travado e "Treinada por <item>". Modificadores vindos de itens aparecem travados na seção Modificadores. `senses` da raça é só informativo; `movement` alimenta o placeholder `{race.movement}` usado por `derived.movement` (§9.11) — sem raça na ficha, `derived.movement` cai no `default` do campo (9 em T20).

## 4. Modelo de dados

Espelhado em `apps/server/prisma/schema.prisma` (persistência) e `packages/shared/src/schemas` (validação/transporte).

```
Room 1───* Participant
Room 1───* Scene 1───* Token *───? Participant (owner)
Scene 0/1─* Combat 1───* Combatant *───1 Token
Room 1───* Character *───? Participant (owner)
Token *───? Character
Room 1───* ChatMessage *───? Token
Room 1───* SavedEncounter
```

| Entidade | Campos principais | Notas |
|---|---|---|
| **Room** | `id, name, inviteCode, gmSecret, systemId, activeSceneId, party(JSON)` | `gmSecret` nunca vai ao cliente (ver `RoomPublicSchema`). `activeSceneId` sempre aponta pra um mapa não apagado da sala (invariante mantida por `scene:activate`/`scene:delete`, §9.7). `party` = `PartyEntry[]` da Visão de grupo (§9.15, `{ characterId, hidden }[]`), não serializado em `RoomPublic`/`Room` do shared — vai à parte, já filtrado por papel, em `RoomSnapshot.party` (§5) |
| **Participant** | `id, roomId, nickname, role, sessionToken` | `connected` é estado em memória, não persistido |
| **Scene** | `id, roomId, name, mapUrl, mapWidth, mapHeight, grid(JSON), fog(JSON), order, arrival(JSON), gmNotes?, deletedAt?` | Múltiplos mapas por sala (§9.7). `grid` e `fog` são JSON para evoluir sem migration; `fog` segue `FogConfigSchema` (§9.3). `order`: posição no painel "Mapas", renumerada 0..n-1 a cada `scene:reorder`. `arrival` = `{x,y} \| null` (pixels do mapa): onde tokens levados de outro mapa aparecem ao ativar. `gmNotes` (docs/plano-narracao.md, §9.16): nota do Mestre sobre o mapa, markdown leve — coluna só do banco, **nunca** sai no `Scene` do shared (só `hasNotes: boolean`, calculado em `toScene`); o texto só sai por `scene:get-notes` (GM only). `deletedAt` (coluna só do banco, nunca serializada no `Scene` do shared, mesmo padrão de `Token.deletedAt`): soft delete de `scene:delete` — todo lugar que lista "mapas da sala agora" filtra `deletedAt: null`; limpeza definitiva depois de 30 dias (`services/cleanup.ts`) |
| **Token** | `id, sceneId, name, imageUrl, x, y, cells, rotation, zIndex, visible, ownerId, color, characterId?, hp?(JSON), conditions(JSON: TokenCondition[]), notes?, deletedAt?` | Posição (`x, y`) em **pixels do mapa**, não em células (docs/plano-grid.md). `cells` (inteiro ≥ 1) é a fonte da verdade do TAMANHO — lado do token em células, sempre quadrado; os pixels (`width`/`height` do `Token` do shared, nunca persistidos nem trafegados no socket) são derivados on-the-fly de `cells × cellSize do grid ATUAL da cena` (`tokenPixelSize`, `packages/shared/src/rules/placement.ts`) em quem precisa (canvas, espiral de posicionamento, névoa) — trocar de mapa ou editar o `cellSize` do mapa (`scene:updateGrid`) nunca precisa "converter" tamanho nenhum. `characterId` só muda por `token:link-character`. `hp` = `{ current, max } \| null` (§3.3), ignorado enquanto há `characterId`. `conditions` = `{ key, expiresRound? }[]` — chave de `SystemDefinition.conditions[]`, `expiresRound` comparado a `Combat.round` (§3.5), ausente = permanente; coluna `Json` no banco (não `String[]`, pra caber o objeto). `notes` (docs/plano-narracao.md, §9.16): nota do Mestre sobre o token — coluna só do banco, **nunca** sai no `Token` do shared (só `hasNotes: boolean`); redigido de novo pra jogador mesmo quando `true` (`redactTokenForViewer`, `services/visibility.ts`) — o indicador no token é "só o GM vê" mesmo sendo o dono. Texto só sai por `token:get-notes` (GM only). `deletedAt` (coluna só do banco, nunca serializada no `Token` do shared): soft delete de `token:delete`/`token:delete-many` (§9.6) — todo lugar que lista "tokens da cena agora" filtra `deletedAt: null`; a limpeza definitiva apaga a linha de vez depois de 30 dias (`services/cleanup.ts`). Uma nota sobrevive ao soft delete/desfazer do token normalmente (a coluna não é tocada por `token:delete`), mas `token:get-notes`/`token:set-notes` recusam um token soft-deleted (mesma regra "não encontrado" de qualquer handler normal) |
| **Character** | `id, roomId, ownerId?, name, kind, data(JSON), compendiumEntryId?` | `data` segue `CharacterDataSchema` (atributos, perícias, recursos, modificadores, itens...). Colunas só para o que precisa de índice/permissão; o resto é agnóstico de sistema e evolui sem migration. `compendiumEntryId` (coluna só do banco, nunca serializada no `Character` do shared): id da entrada do compêndio que gerou este NPC (`compendium:spawn-creature`/`encounter:spawn`, §9.5/§9.14) — metadado de app, não regra de sistema; `null` = ficha feita à mão (ou PC). Usado só por "salvar tokens selecionados como encontro" (§9.14) pra reconstruir de qual criatura cada token veio |
| **ChatMessage** | `id, roomId, participantId, nickname, kind, text?, roll?(JSON), item?(JSON), initiativeBatch?(JSON), handout?(JSON), visibility, tokenId?, whisperTo?` | `roll` segue `DiceRollSchema` (dano da ficha traz `damage[]`, uma parcela rolada por tipo; `applied[]` acumula o que já foi aplicado em tokens, §3.3; `natural`/`targets[]` são o sistema de alvos, §9.12 — ataque OU dano com alvo marcado, congelados na hora da rolagem, ataque com acerto/erro calculado e dano só com o nome; `criticalConfirmed` é o crítico confirmado de "Rolar dano junto com o ataque", §9.13); `item` segue `ItemCardSchema` (kind `item`); `initiativeBatch` segue `InitiativeBatchSchema` (kind `initiative-batch`: `{ round, entries: [{ combatantId, tokenId, name, formula?, result? }] }`, `combat:roll` rolando mais de um combatente, §3.5); `handout` segue `HandoutCardSchema` (kind `handout`, §9.10: cópia denormalizada do handout mostrado); `visibility` = `all \| gm \| self` (§3.4, sempre `all` num handout — quem recebe é decidido por `whisperTo`); `tokenId?` liga a rolagem a um token (combate/ficha), filtrado à parte de `visibility` (§3.4/§3.5) — um `initiative-batch` não usa este campo (várias linhas, vários tokens): o gate é por linha, dentro de `initiativeBatch.entries`; `whisperTo?` (§9.10) é um sussurro visual por PESSOA (`participantId`): setado, só o GM e ele recebem a mensagem, nem card nem placeholder pros demais — mesmo mecanismo de exclusão de `tokenId`, só que por pessoa |
| **Handout** | `id, roomId, name, kind, imageUrl?, width?, height?, text?, tags[], deletedAt?` | Biblioteca por sala (§9.10), só o GM vê (`handout:list` é `gmOnly`). `kind` = `image \| text`; imagem reaproveita `POST /api/upload` (mesmo limite de 20 MB do mapa), texto vai até 20 000 caracteres, sem parser de markdown (texto puro). `deletedAt` (coluna só do banco, nunca serializada, mesmo padrão de `Token.deletedAt`): soft delete de `handout:delete`, que também soft-deleta os `Pin` deste handout em qualquer mapa (§9.10) |
| **Pin** | `id, sceneId, kind, handoutId?, x, y, visible, name?, imageUrl?, width?, height?, text?, icon?, color?, deletedAt?` | Pino no mapa (§9.10/§9.16, docs/plano-narracao.md — unifica o antigo `HandoutPin` com pino de nota). Geometria em pixels do mapa, como `Token`/`Template`. `kind` = `image \| text` (handout — `handoutId` setado, campos de conteúdo são uma CÓPIA denormalizada do `Handout` no momento de `pin:create`, mesmo padrão de `Combatant.name/color`: editar o handout original depois não atualiza pinos já fixados) \| `note` (`handoutId` null; `name` faz o papel de título, `text` o corpo, `icon`/`color` a aparência — conteúdo é o próprio dado, editável no lugar por `pin:update`). `visible` = GM controla se o pino aparece pros jogadores (mesma regra de `Token.visible`, sem névoa). `deletedAt`: soft delete de `pin:remove` (e da cascata de `handout:delete`), entra no desfazer do GM (§9.6) |
| **SavedEncounter** | `id, roomId, name, tags[], notes, entries(JSON), deletedAt?` | Encontro salvo (§9.14): grupo de criaturas do compêndio que o GM monta uma vez e solta de uma vez. `entries` = `{ entryId, count, visibleOnSpawn, nameOverride? }[]` (`SavedEncounterEntrySchema`) — só a "receita", nunca cópia de ficha; resolvida contra o compêndio ATUAL na hora de soltar (`encounter:spawn`). `deletedAt` (coluna só do banco, nunca serializada, mesmo padrão de `Handout.deletedAt`): soft delete de `encounter:delete` |
| **Combat** | `id, roomId, sceneId (único: um combate por cena), round, status, activeCombatantId?` | `status` = `rolling \| active \| ended` (§3.5). Persistido (ao contrário da iniciativa manual anterior, que vivia em memória) |
| **Combatant** | `id, combatId, tokenId, characterId? (cópia informativa, não normativa), initiative?, bonus, delayed, surprised, order, addedRound, movementBudget?, movementUsed, movementDiagonals, movementAnchorX?, movementAnchorY?, movementPath?(JSON)` | `initiative = null` = ainda não rolou. `combat:remove` apaga o combatente (e ajusta `activeCombatantId`/`round` se o removido era o ativo, `stateAfterRemoval`, §3.5). `token:delete`/`token:delete-many` **não** apagam mais a linha do combatente (o token agora é soft delete, §9.6): só param de listá-lo (o combate ignora combatente cujo token tem `deletedAt`) e fazem o mesmo ajuste de turno/`order`; a linha volta se o GM desfizer. Os seis últimos campos são o orçamento de deslocamento do turno (§9.11): `movementAnchorX/Y` (de onde o próximo movimento é medido) e `movementPath` (o caminho desenhado) são colunas só do banco, nunca serializadas no `Combatant` do shared — o cliente só recebe `movementBudget/Used/Diagonals` e `movementPath` via `Combat` (§5) |
| **SystemDefinition** | `id, name, attributes[], skills[], resources[] (com `color?`, §9.15), derived[], level, sizes[], damageTypeGroups[], damageTypes[] (com `color?`/`group?`/`healing?`), currencies[], traitFields[], equipStats[], itemKinds[], activation, conditions[] (`key, label, icon, color, description, modifiers[], defaultDuration?`), pinIcons[] (§9.16), skillTotal, rolls{} (inclui `attackHit?`/`attackAutoHit?`/`attackAutoMiss?`, §9.12, e `critical?`, §9.13), combat{} (§3.5), damageAttribute, tokenBar, grid?, race? (§9.11), movement? (§9.11), trainedBonus[]` | Arquivo JSON (`schemaVersion: 2`), **não** está no banco. Registrado em `packages/shared/src/systems.ts` e lido por server e web. `conditions[].icon` é um SVG simples embutido (sem arte externa); `description` vazia por ora (o JSON vai pro bundle do web, então o padrão de `descriptions.local.json` do compêndio — só servidor — não se aplica aqui); `modifiers[]` tem o mesmo formato do Modificador da ficha (§3.6) mas ainda não é lido por nenhum código. `pinIcons[]` (`key, label, icon, color`, docs/plano-narracao.md): ícones extras pra pino de nota — mesmo formato de `conditions[]`, mas NÃO é regra de sistema (é mobília de UI); vazio (padrão) = o cliente usa uma paleta embutida no código. `race?` aponta o `itemKinds[]` que alimenta o placeholder `{race.<campo>}` nas fórmulas (§9.11); `movement?` declara o orçamento de deslocamento por turno (ausente = sistema sem a regra); `rolls.attackHit?`/`attackAutoHit?`/`attackAutoMiss?` são a regra de acerto do sistema de alvos (§9.12, ausentes = sistema sem a regra); `rolls.critical?` confirma um crítico ameaçado ao rolar dano junto com o ataque (§9.13, mesma gramática de `attackAutoHit`, só `{natural}`; ausente = sistema não confirma sozinho) |

Decisão: posição em pixels (não células) para o token poder ficar "fora do grid" e para suportar `grid.type = none`. A conversão célula↔pixel é uma função pura usando `cellSize` e `offset`. Uma etapa futura pode mover a posição pra células também — só o TAMANHO (`cells`) já é célula hoje (docs/plano-grid.md).

## 5. Eventos Socket.io

Definidos com tipos em `packages/shared/src/events.ts`; os payloads têm schemas Zod em `packages/shared/src/schemas/payloads.ts` (os tipos dos eventos derivam deles). Todo evento cliente→servidor recebe um **ack**:
`{ ok: true, data }` ou `{ ok: false, error }`. Payloads são validados com Zod no servidor; inválido → `ok: false`.

Salas do Socket.io: cada socket entra em `room:<roomId>`. Broadcasts vão para essa sala. O GM entra também em `room:<roomId>:gm` para receber dados que jogadores não veem.

### Cliente → Servidor

| Evento | Payload | Quem | Efeito / broadcast |
|---|---|---|---|
| `room:join` | `{ inviteCode, nickname?, gmSecret?, sessionToken? }` | todos | ack `RoomSnapshot`; `room:participantJoined`. `sessionToken` válido → reconecta o mesmo participante; senão exige `nickname` e cria um novo |
| `scene:create` | `{ name, mapUrl?, mapWidth?, mapHeight? }` (`mapUrl` opcional: "criar por upload" numa chamada só) | GM | `scene:created` |
| `scene:activate` | `{ sceneId, moveTokenIds?, dropPoint? }` (§9.7: diálogo "Levar para o mapa") | GM | `token:updated` de cada token movido, `combat:updated` do mapa de origem se ele tinha combate, `room:activeSceneChanged` |
| `scene:enter` | `{ sceneId }` | GM (qualquer mapa vivo da sala), jogador (só o ativo) | ack `{ tokens, combat, templates }` (§9.9); sem broadcast — navegar/restaurar sem os efeitos colaterais de `room:join` (§9.7) |
| `scene:rename` | `{ sceneId, name }` | GM | `scene:updated` |
| `scene:duplicate` | `{ sceneId, name? }` (nome ausente = gerado, "Cópia de X") | GM | `scene:created` |
| `scene:delete` | `{ sceneId, confirmMovePlayerTokens? }` | GM | ack `{ status: "deleted" }` ou `{ status: "needs-confirm", playerTokenIds }` (nada apagado ainda); `scene:deleted` + `token:updated` dos tokens de jogador movidos (§9.7) |
| `scene:reorder` | `{ sceneIds }` (lista completa) | GM | `scene:reordered` |
| `scene:setArrival` | `{ sceneId, arrival: {x,y} \| null }` | GM | `scene:updated` |
| `scene:list` | `{}` | GM | ack `{ items: SceneListItem[] }` (contagens/combate de cada mapa, painel "Mapas"); sem broadcast |
| `scene:setMap` | `{ sceneId, mapUrl, mapWidth, mapHeight }` (`null` remove o mapa) | GM | `scene:updated` |
| `scene:updateGrid` | `{ sceneId, grid: Partial<GridConfig> }` | GM | `scene:updated`; se a troca reencaixou algum token, `token:updated` de cada um + `history:updated` (§9.6/§9.7) |
| `fog:update` | `{ sceneId, op }` com `op` = `add {shape}` \| `removeLast` \| `revealAll` \| `hideAll` \| `setEnabled {enabled}` | GM | `fog:updated` + reenvio dos tokens do mapa conforme a visibilidade nova (§9.3); jogador só recebe se `sceneId` for o mapa ATIVO (§9.7) |
| `token:create` | `TokenCreate` | GM | `token:created` |
| `token:update` | `TokenPatch` (`id` + campos, `live?` marca eco do arraste — §9.6) | GM ou owner | `token:updated` |
| `token:update-many` | `{ patches: TokenPatch[] }` (min 1) | GM ou owner de cada token (tudo-ou-nada) | `token:updated` de cada um; arraste em grupo (2+ tokens), uma entrada de histórico só (§9.6) |
| `token:delete` | `{ tokenId }` | GM ou owner | `token:deleted` (soft delete, §9.6) |
| `token:delete-many` | `{ tokenIds: string[] }` (min 1) | GM ou owner de cada token (tudo-ou-nada) | `token:deleted` de cada um; uma entrada de histórico só (§9.6) |
| `token:link-character` | `{ tokenId, characterId \| null }` | GM, ou owner do token que é owner da ficha | `token:updated` |
| `token:apply-damage` | `{ messageId, targets: [{ tokenId, amount, multiplier? }] }` (`amount` já assinado: negativo tira PV, positivo cura; é o valor CONFIRMADO, o servidor não o recalcula) | GM, ou owner de cada token alvo (tudo-ou-nada) | `token:updated`/`character:updated` de cada alvo + `chat:message` com `roll.applied[]` atualizado (cada entrada ganha `raw`/`adjustment` — decomposição pela resposta a dano do alvo, calculada no servidor, §3.3) |
| `target:set` | `{ sceneId, tokenIds }` (lista completa, §9.12) | GM (qualquer mapa vivo); jogador (só o mapa ATIVO, só tokens que vê) | ack `{ tokenIds }` (a lista aceita); `target:updated` — GM sempre, autor sempre, alvos do GM nunca vão a jogador |
| `character:create` | `{ name, kind?, ownerId? }` | todos (jogador: `ownerId` = ele, `kind` = pc) | `character:created` (NPC só para o GM) |
| `character:update` | `{ id, patch }` (patch raso de `CharacterDataSchema` + `name`, `ownerId`, `kind`) | GM ou owner (jogador não muda `ownerId`/`kind`) | `character:updated` |
| `character:delete` | `{ characterId }` | GM ou owner | `character:deleted` + `token:updated` dos tokens desvinculados |
| `character:roll` | `{ characterId, roll: {type: attribute\|skill\|initiative\|extra\|action, ...}, visibility?, targetTokenIds? }` (ação: `enhancements?: [{ id, times }]` aplica os efeitos dos aprimoramentos ao dano; `combineDamageActionId?` (§9.13) rola junto uma ação de DANO do mesmo item, só válido quando `actionId` é ataque; `visibility` = modo de rolagem do autor; `targetTokenIds` = alvos marcados no momento, §9.12 — ataque OU dano constroem `roll.targets[]`, ataque com acerto/erro e dano só com o nome) | GM ou owner | `chat:message` (rolagem com `characterId`; dano com `damage[]` por tipo; ataque com alvo ganha `roll.natural`/`roll.targets[]`; combinado ganha os dois, §9.13, mais `roll.criticalConfirmed`); sem alvo, sala toda recebe e quem `visibility` não permite recebe sem `roll` (placeholder, §3.4); COM alvo, uma cópia por participante (§9.12) |
| `character:use-item` | `{ characterId, itemId, enhancements?: [{ id, times }] }` | GM ou owner | `character:updated` (se houve custo) + `chat:message` (`kind:"item"`); recurso insuficiente ou aprimoramento inválido = ack erro, sem broadcast |
| `compendium:list` | `{}` | todos | ack `{ entries: CompendiumEntry[], roomIds: string[] }` do sistema da sala (sem broadcast; §9.4); jogador nunca recebe `type: "creature"` — filtro no servidor, `roomIds` só para o chip "Sala" (§9.5) |
| `compendium:spawn-creature` | `{ sceneId, entryId, count (1..20), visible, x, y }` (`x, y` em pixels do mapa) | GM | `character:created` (uma por cópia) + `token:created`; ack com os `Token[]` criados (§9.5) |
| `encounter:list` | `{}` | GM | ack `SavedEncounter[]` da sala; sem broadcast (§9.14) |
| `encounter:create` | `{ name, tags?, notes?, entries: SavedEncounterEntry[] }` | GM | `encounter:created` (só GM); duplicar reusa este evento no cliente (§9.14) |
| `encounter:create-from-tokens` | `{ tokenIds[], name, tags?, notes? }` | GM | `encounter:created` (só GM); ack `{ encounter, ignoredTokens }` — tokens sem `Character.compendiumEntryId` são ignorados e contados (§9.14) |
| `encounter:update` | `{ id, patch: { name?, tags?, notes?, entries? } }` | GM | `encounter:updated` (só GM) |
| `encounter:delete` | `{ id }` | GM | ack; `encounter:deleted` (só GM, soft delete) |
| `encounter:spawn` | `{ id, sceneId, x, y }` (pixels do mapa) | GM | `character:created`/`token:created` por cópia, como `compendium:spawn-creature`; ack `{ tokens: Token[], skippedEntryIds: string[] }` — entradas cuja criatura sumiu do compêndio são puladas e avisadas, não derrubam a soltura inteira (§9.14) |
| `chat:send` | `{ text, visibility? }` (`visibility` = modo de rolagem do autor; `/gmr` e `/pr` no texto forçam) | todos | `chat:message` a todos (texto sempre público); rolagem fora de "Pública" vai a todos, mas quem `visibility` não permite recebe sem `roll` (placeholder, §3.4); ack sem `roll` quando o autor não pode ver (às cegas) |
| `chat:reveal` | `{ messageId }` | GM | `chat:message` da mesma mensagem com `visibility: "all"` para todos (cliente faz upsert) |
| `combat:start` | `{ sceneId, tokenIds[], visibility? }` | GM | `combat:updated`; substitui um combate anterior do mapa, se houver; com a opção da sala ligada (padrão), rola sozinho os NPCs recém-entrados (`visibility` = modo de quem chamou) — publica `chat:message{kind:"initiative-batch"}` junto, igual a `combat:roll` |
| `combat:add` | `{ sceneId, tokenIds[], visibility? }` | GM | `combat:updated`; reforços entram sem iniciativa; mesma rolagem automática de NPCs de `combat:start` acima, só entre os reforços |
| `combat:remove` | `{ sceneId, combatantIds[] }` | GM | `combat:updated`; ajusta o turno se um removido era o ativo |
| `combat:roll` | `{ sceneId, scope: self\|one\|npcs\|missing, combatantId?, visibility? }` | `self`/`one`: GM ou dono do combatente (só no mapa ativo); `npcs`/`missing`: GM | Rola no servidor; um alvo publica `chat:message{kind:"roll"}`, mais de um publica um só `chat:message{kind:"initiative-batch"}` (§3.5); `combat:updated` uma vez, no fim do lote |
| `combat:set-initiative` | `{ sceneId, combatantId, initiative: number\|null, bonus? }` | GM | `combat:updated` |
| `combat:set-surprised` | `{ sceneId, combatantId, surprised }` | GM | `combat:updated` |
| `combat:next` / `prev` | `{ sceneId }` | GM | `combat:updated` |
| `combat:reorder` | `{ sceneId, combatantIds[] }` (nova ordem completa) | GM | `combat:updated` |
| `combat:delay` | `{ sceneId, combatantId }` (só no próprio turno, só no mapa ativo) | GM ou dono do combatente | `combat:updated` |
| `combat:resume` | `{ sceneId, combatantId }` (só no mapa ativo) | GM ou dono do combatente | `combat:updated` |
| `combat:end` | `{ sceneId, clear? }` | GM | `combat:updated` (`combat: null` se `clear: true`) |
| `combat:set-movement` | `{ sceneId, combatantId, budget?: number \| null, used? }` (§9.11; `budget: null` volta a seguir a ficha; `used` também reinicia âncora/caminho) | GM | `combat:updated` |
| `combat:set-movement-limit` | `{ enabled }` (§9.11; trava por SALA, em memória) | GM | ack `{ enabled }`; `combat:movementLimitChanged` a todos |
| `combat:set-auto-roll-npc-initiative` | `{ enabled }` (§3.5; opção por SALA, em memória, padrão ligada) | GM | ack `{ enabled }`; `combat:autoRollNpcInitiativeChanged` a todos |
| `ruler:update` | `{ sceneId, ruler: { start, end } \| null }` (pixels do mapa) | todos | `ruler:updated` para os **outros** (efêmero: não persiste; `null` apaga) |
| `template:upsert` | `{ sceneId, template: Template, live?, dragFrom? }` (§9.9) | GM, ou dono (só no mapa ativo) | `template:upserted`; cria (id novo) ou edita (mover/girar); `ownerId` do payload nunca é confiado (fixo desde a criação); `dragFrom` (x/y/rotation do mousedown) só informa o "antes" do desfazer do GM (§9.6) |
| `template:remove` | `{ sceneId, templateId }` | GM, ou dono (só no mapa ativo) | `template:removed` |
| `handout:create` | `{ name, tags?, kind: "image", imageUrl, width, height } \| { name, tags?, kind: "text", text }` (`imageUrl` vem do upload HTTP feito antes) | GM | `handout:created` (só pra `rooms.gm`) |
| `handout:update` | `{ id, patch: { name?, tags? } }` (trocar imagem/texto é apagar e criar de novo) | GM | `handout:updated` (só GM) |
| `handout:delete` | `{ id }` | GM | ack; `handout:deleted` (só GM) + `pin:removed` de cada pino deste handout em qualquer mapa (soft delete em cascata, uma entrada de desfazer só, §9.6) |
| `handout:list` | `{}` | GM | ack `{ items: Handout[] }` da biblioteca da sala; sem broadcast |
| `handout:show` | `{ id, target: "all" \| { participantId } }` | GM | publica `chat:message{kind:"handout"}` (visibility `all`, `whisperTo` = `participantId` do alvo ou `null`); quem recebe o broadcast AO VIVO abre o overlay sozinho (cliente) |
| `handout:close` | `{ messageId }` | GM | `handout:closed` pro mesmo público da mensagem (fecha o overlay de quem a via; a mensagem continua no chat) |
| `pin:create` | `{ sceneId, x, y, visible, kind: "handout", handoutId } \| { sceneId, x, y, visible, kind: "note", title, text, icon?, color? }` (pixels do mapa) | GM | ack `Pin`; `pin:created`; entra no desfazer do GM (§9.6) |
| `pin:update` | `{ sceneId, pinId, patch: { title?, text?, icon?, color?, visible? } }` (só pino `kind: "note"`) | GM | ack `Pin`; `pin:updated`; entra no desfazer do GM (§9.6) |
| `pin:remove` | `{ sceneId, pinId }` | GM | `pin:removed`; entra no desfazer do GM (§9.6) |
| `scene:set-notes` | `{ sceneId, notes }` (docs/plano-narracao.md §9.16) | GM | ack `Scene`; `scene:updated` (só pra `rooms.gm` — o conteúdo é só do GM) |
| `scene:get-notes` | `{ sceneId }` | GM | ack `{ notes: string }` |
| `token:set-notes` | `{ tokenId, notes }` | GM | ack `Token`; `token:updated` (só pra `rooms.gm`) |
| `token:get-notes` | `{ tokenId }` | GM | ack `{ notes: string }` |
| `notes:search` | `{ query }` | GM | ack `{ items: [{ kind: "scene", sceneId, name, snippet } \| { kind: "token", sceneId, tokenId, name, snippet }] }` — busca `contains` (case-insensitive) nas notas de mapa e de token da sala inteira; mapa/token apagado nunca aparece |
| `history:undo` / `history:redo` | `{}` | GM | desfaz/refaz o topo da pilha da sala (§9.6); ack `{ summary } \| null` (`null` = pilha vazia); broadcasts normais das entidades afetadas + `history:updated` |
| `party:add` | `{ characterId }` (idempotente) | GM | Visão de grupo (§9.15); ack `PartyEntry[]` (visão do GM); `party:updated` (uma lista por papel) |
| `party:remove` | `{ characterId }` (idempotente) | GM | idem |
| `party:set-hidden` | `{ characterId, hidden }` | GM | idem |
| `party:reorder` | `{ characterIds }` (lista completa, permutação do grupo atual) | GM | idem |

### Servidor → Cliente

| Evento | Payload |
|---|---|
| `room:participantJoined` / `room:participantLeft` | `Participant` (novo ou reconectado; cliente faz upsert) / `{ id }` (marca `connected = false`) |
| `room:activeSceneChanged` | `{ sceneId }` (jogador sempre segue, chamando `scene:enter`; GM só se estava vendo o mapa que deixou de ser ativo — §9.7) |
| `scene:created` / `scene:updated` | `Scene` |
| `scene:deleted` | `{ sceneId }` (quem estava vendo esse mapa cai pro ativo) |
| `scene:reordered` | `{ order: [{ sceneId, order }] }` (só os pares que mudaram, não a lista inteira) |
| `fog:updated` | `{ sceneId, fog: FogConfig }` (estado completo; cliente substitui `scene.fog`); jogador só recebe se `sceneId` for o mapa ATIVO (§9.7) |
| `token:created` / `token:updated` | `Token`; jogador só recebe se `token.sceneId` for o mapa ATIVO da sala (§9.7) |
| `target:updated` | `{ participantId, sceneId, tokenIds }` (§9.12) — o cliente substitui a lista daquele participante; jogador nunca recebe isto pro GM |
| `token:deleted` | `{ tokenId }` |
| `chat:message` | `ChatMessage` (mensagem nova ou revelada: mesmo `id`, `visibility` nova; cliente faz upsert) |
| `character:created` / `character:updated` | `Character` (jogadores só recebem `kind = "pc"`) |
| `character:deleted` | `{ characterId }` |
| `combat:updated` | `{ sceneId, combat: Combat \| null }` (estado completo DE UM MAPA, já ordenado e filtrado pela visibilidade de quem recebe — §3.5; `combat: null` = sem combate nesse mapa. GM sempre recebe; jogador só se `sceneId` for o mapa ATIVO — §9.7) |
| `combat:movementLimitChanged` | `{ enabled }` (§9.11; trava de deslocamento da sala mudou — também entra no `RoomSnapshot` de quem entra depois) |
| `combat:autoRollNpcInitiativeChanged` | `{ enabled }` (§3.5; "Rolar iniciativa dos NPCs ao iniciar o combate" da sala mudou — também entra no `RoomSnapshot.autoRollNpcInitiativeEnabled` de quem entra depois) |
| `history:updated` | `{ canUndo, canRedo, undoSummary?, redoSummary? }` — só pro GM (§9.6) |
| `ruler:updated` | `{ participantId, nickname, sceneId, ruler \| null }` (régua de outro participante; sem eco ao autor; jogador só recebe se `sceneId` for o mapa ATIVO — §9.7) |
| `template:upserted` / `template:removed` | `{ sceneId, template }` / `{ sceneId, templateId }` (§9.9; cliente faz upsert por id) |
| `handout:created` / `handout:updated` | `Handout` (§9.10; só pra `rooms.gm`, cliente faz upsert por id) |
| `handout:deleted` | `{ id }` (só pra `rooms.gm`) |
| `pin:created` / `pin:updated` / `pin:removed` | `{ sceneId, pin }` / `{ sceneId, pin }` / `{ sceneId, pinId }` (§9.10/§9.16; mesma regra de broadcast de mapa de sempre — GM sempre, jogador só se `pin.visible` e `sceneId` é o mapa ATIVO) |
| `handout:closed` | `{ messageId }` (efêmero: instrui quem via a mensagem a fechar o overlay, sem mudar a mensagem no chat) |
| `encounter:created` / `encounter:updated` | `SavedEncounter` (§9.14; só pra `rooms.gm`, cliente faz upsert por id) |
| `encounter:deleted` | `{ id }` (só pra `rooms.gm`) |
| `party:updated` | `{ party: PartyEntry[] }` (§9.15; lista COMPLETA — cliente substitui, não faz merge — já filtrada por papel: jogador nunca recebe entrada oculta nem de ficha que não é mais PC) |
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
  components/   Lobby, RoomPage (liga stores aos componentes), TopBar (inclui o MapSelector, só
                GM — botão-seletor de mapa com dropdown, atalho M, §9.7), Toolbar, VttCanvas,
                TokenInspector, SidePanel (3 abas: Chat, Iniciativa, Fichas — responsivas, só
                ícone com tooltip/badge quando o header fica estreito demais pro rótulo; recolhível,
                §9.8), ChatTab,
                InitiativeTab (modo de combate), CombatBanner (faixa "rolar iniciativa"/"seu
                turno"), CharactersTab, MapsPanel (conteúdo do dropdown do MapSelector, §9.7),
                CarryTokensDialog ("Levar para o mapa" ao ativar, §9.7), MapConfigModal,
                NicknamePrompt, Toasts, CharacterSheetDrawer (gaveta da ficha),
                TemplateToolbar (painel da ferramenta Área), TemplateLayer (desenho dos
                gabaritos no canvas, §9.9), HandoutSelector (botão-dropdown na TopBar, atalho J,
                §9.10), HandoutsPanel (biblioteca dentro do dropdown), HandoutOverlay (tela cheia,
                zoom/arrastar imagem), HandoutDragGhost (arrastar card pro mapa), PinLayer (desenho
                dos pinos no canvas, só geometria — §9.10/§9.16), NotePinCard (cartão de um pino de
                nota), PinCreatePopover (formulário da ferramenta "Pino"), NotesPanel (notas do
                Mestre + busca, §9.16)
  components/chat/  ItemCardMessage, InitiativeBatchMessage, HandoutCardMessage (miniatura
                clicável do handout mostrado, §9.10), ApplyDamageButton, RollModeButton,
                WhisperTargetButton (seletor "para" do sussurro, §3.4)
  components/compendium/  CompendiumPalette (paleta encaixada ou flutuante), EntryPreview, DragGhost (arrasto)
  components/character/  seções da ficha: CharacterHeader, AttributesGrid, ResourcesBlock,
                DerivedStatsBar, SkillsSection, ItemsSection, ModifiersSection, DetailsSection,
                fields.tsx (inputs "commit on blur")
  store/        connection.ts (socket + emitAck), bindSocket.ts (broadcast → store),
                room.ts (viewingSceneId/selectViewedScene, ações de mapa — §9.7), tokens.ts, chat.ts,
                combat.ts (byScene: combate por mapa, §9.7), characters.ts, ui.ts (toasts),
                sceneList.ts (contagens/combate de cada mapa pro painel "Mapas", §9.7),
                tools.ts (ferramenta ativa, régua, forma/tamanho da ferramenta Área — §9.9),
                templates.ts (gabaritos por mapa, §9.9), compendium.ts (entradas, paleta, arrasto),
                handouts.ts (biblioteca, overlay aberto, arrasto — §9.10),
                pins.ts (pinos por mapa, handout ou nota — §9.10/§9.16)
  lib/          router.ts (2 rotas, sem lib), api.ts (HTTP), grid.ts (célula↔pixel, puro),
                session.ts (localStorage/sessionStorage), throttle.ts, useImage.ts,
                thumbnails.ts (miniatura de mapa gerada no cliente, cacheada — §9.7),
                system.ts (useSystemDef), ids.ts, pinIcons.ts (paleta padrão de pino, §9.16),
                useToolShortcuts.ts (V/H/R/T/P/Esc/espaço), useTurnTitle.ts (título da aba pisca no seu turno),
                compendium.ts (regras de inserção, puro), dropTargets.ts (alvos de soltura por
                data-drop-target, genérico — mesmo id "map" aceita criatura do compêndio E handout
                ao mesmo tempo, §9.10), templates.ts (ponte pixel↔metro dos gabaritos, §9.9),
                useHandoutDrag.ts (arrastar card de handout pro mapa, mesmo mecanismo de
                useCompendiumDrag — §9.10)
apps/server/src/
  index.ts, env.ts, db.ts
  http/         rooms.ts, upload.ts
  socket/       index.ts, types.ts, ack.ts (validação Zod + ack), room.ts, scene.ts,
                token.ts, chat.ts, combat.ts (modo de combate), character.ts, ruler.ts (efêmero),
                compendium.ts, templates.ts (efêmero, §9.9), handout.ts (biblioteca, §9.10),
                pins.ts (pino de handout ou nota, §9.10/§9.16), notes.ts (notas do Mestre, §9.16)
  services/     serialize.ts (Prisma → shared), snapshot.ts, presence.ts,
                combat.ts (carregar/ordenar/filtrar/emitir combate; regras de ordem em si em shared/rules/combat.ts),
                permissions.ts, chatCommands.ts, ids.ts,
                characters.ts (Prisma ↔ Character, visibilidade, broadcast),
                rolls.ts (rola, persiste e publica; usado pelo chat, pela ficha e pelo combate),
                chatVisibility.ts (quem vê cada mensagem: `visibility` + gates por `tokenId` e
                `whisperTo`, §9.10),
                compendium.ts (sistema + sala via mergeCompendium; a sala ainda é um stub vazio),
                templates.ts (gabaritos em memória por mapa, nunca no banco — §9.9),
                handouts.ts (Prisma ↔ Handout, HandoutCard denormalizado — §9.10),
                pins.ts (Prisma ↔ Pin — handout ou nota —, visibilidade de pino — §9.10/§9.16)
packages/shared/src/
  schemas/      (Zod, inclui payloads.ts, character.ts, combat.ts e template.ts)  events.ts
  dice/         parser + roller, puro, sem I/O
  rules/        placeholders.ts, modifierTarget.ts (regex do target),
                compute.ts (computeCharacter), rolls.ts (buildCharacterRoll), combat.ts (ordenação,
                turno, surpresa — puro, testado), scenes.ts (ordem, nomeação de cópia, pré-marcação
                de "levar para o mapa", quem pode apagar um mapa — puro, testado, §9.7), defaults.ts,
                templates.ts (geometria dos gabaritos e parseAreaText, puro, testado — §9.9)
  systems.ts    registro dos JSONs (getSystemDefinition)
  compendium/   registro dos compêndios (subpath @tormenta-vtt/shared/compendium, só o servidor importa)
packages/shared/systems/
  tormenta20.json
  tormenta20/compendium/{classes,races,weapons,armor,spells,powers}.json
```

## 8. Estado da implementação

Todos os itens do MVP acima estão implementados (setembro/2026), incluindo a ficha básica (§3.6). Limitações conhecidas:
- Ficha: o compêndio (§9.4) vem dos packs do Foundry e tem lacunas listadas em `scripts/import-report.md` (proficiências e limite de atributo das armaduras pesadas, sentidos/perícias das raças, páginas ausentes, fórmulas com variáveis do Foundry); o compêndio da sala (homebrew) só existe como interface. Sentidos da raça não alimentam `derived[]` (§9.11: deslocamento já alimenta, via `{race.movement}`); poderes de classe por nível ficam de fora. Consumíveis usam a mesma ativação de poderes/magias, mas a quantidade não é descontada ao usar.
- `character:update` é um patch raso: editar um item reenvia a lista `items` inteira (fichas são pequenas; ok por ora).
- A presença (`connected`) se perde ao reiniciar o servidor. O combate (§3.5), diferente da iniciativa manual anterior, agora é **persistido** (tabelas `Combat`/`Combatant`) e sobrevive a um restart.
- Uploads ficam em disco (`apps/server/uploads/`), sem limpeza de arquivos órfãos.
- Névoa (§9.3): só "desfazer último" (sem histórico completo nem refazer); sem luz dinâmica, paredes ou visão por token; a visibilidade de um token olha só o centro dele; `fog:updated` sempre manda a lista completa de shapes (limitada a 500).
- Modo de combate (§3.5): duração de condição em rodadas é só schema preparado, sem automação nenhuma; a mensagem de uma rolagem ligada a um token oculto (card individual ou linha de um `initiative-batch`) só volta a ser entregue no próximo `room:join`, não ao vivo quando o token é revelado; a barra "iniciar/adicionar combatentes" reaproveita a seleção de tokens do mapa (ferramenta Selecionar) em vez de ter um seletor próprio na aba.
- Criaturas do compêndio (§9.5): o pack `convocacoes` do Foundry (convocações que escalam pelo nível do conjurador) ficou fora do importador — `docs/backlog.md`. `NpcQuickCard` é a versão mínima do contrato (`docs/tipos-ficha-rapida.md`); a UI de verdade vem do AI Studio depois.
- Gabaritos de área de efeito (§9.9): ângulo do cone e largura da linha são únicos por sistema (ou por preset), não digitáveis por gabarito na hora de colocar; nenhuma automação de regra (dano, CD, resistência continuam manuais); não interagem com a névoa; entram no undo/redo geral do GM, jogador tem um Ctrl+Z local só das próprias ações — se perdem num restart do servidor (efêmeros por design).
- Handouts (§9.10): um pino no mapa é uma cópia do handout no momento de fixar — editar nome/imagem/texto do handout original depois NÃO atualiza pinos já fixados, e não dá pra arrastar um pino pra reposicionar (apagar e fixar de novo faz as duas coisas). Handout de texto é sempre texto puro (`white-space: pre-wrap`), sem parser de markdown — "leve" no nome, não na renderização. Uploads de imagem de handout caem na mesma pasta sem limpeza de órfãos do mapa (§8, acima).
- Movimento e orçamento de deslocamento (§9.11): condições que alterariam o deslocamento (Lento, Imóvel...) não são automatizadas ainda (só a função pura já aceita modificadores); terreno difícil e caminho com desvio não existem (medição sempre em linha reta, como a régua); Ctrl+Z de um movimento não estorna `movementUsed` (D7 do plano — o GM tem o botão de zerar); um `token:update-many` (arraste em grupo) não é atômico no banco — se um patch do meio do lote for recusado por orçamento, os anteriores já foram persistidos (mesma característica pré-existente do handler, não uma regressão desta feature); ver `docs/revisao-movimento.md` para as bordas testadas.
- Sistema de alvos (§9.12): alvos são efêmeros (memória, como a régua/gabaritos) — se perdem num restart do servidor, não num F5. Sem checagem de alcance ou linha de visão (marcar um alvo do outro lado do mapa funciona igual); sem acerto automático em crítico (20/1 natural) a menos que o sistema declare `attackAutoHit`/`attackAutoMiss` (T20 declara). O selo de "quem mais mira" (`showOtherTargets`) mostra só iniciais/contagem, sem tooltip com os nomes. Ver `docs/revisao-alvos.md` para as bordas testadas.

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

### 9.5 Criaturas do compêndio para o mapa

Bloco de monstro pronto no compêndio, soltável direto no mapa (setembro/2026). Plano e decisões em
`docs/plano-criaturas.md`; contrato da ficha rápida em `docs/tipos-ficha-rapida.md`. Princípio igual
ao do compêndio de itens (§9.4): uma criatura é só um `Character` de `kind: "npc"` pré-preenchido,
sem id; soltar faz uma **cópia** (ficha nova + token vinculado), nunca um vínculo — editar o goblin
da mesa não mexe no compêndio. Nenhuma migration: tudo cabe nas colunas `Json` de `Character`/`Token`
que já existem.

- **Sistema**: bloco opcional `SystemDefinition.creatures = { typeField, ndField, defaultColor,
  typeColors }` diz onde está o tipo da criatura (`traitFields[]`) e que cor cada tipo tem;
  `validateSystemDefinition` confere que as chaves existem. `tormenta20.json` ganhou os `traitFields`
  `nd` (texto: "1/4", "1/2", "20") e `deslocamentos` (texto: "voo 12m, natação 9m" — o deslocamento
  normal continua sendo o derivado `movement`, sobrescritível). `CharacterDataSchema.damageResponses
  = { all, byType: Record<tipo, resposta> }` (`{ reduction, half, immune, vulnerable }`) guarda
  resistência/imunidade/vulnerabilidade por tipo de dano; usada em exibição (preview, ficha rápida) e
  na sugestão de §3.3, nunca automatizada no cálculo do servidor.
- **Compêndio**: `CompendiumEntry` (§9.4) virou união discriminada por `type` (`item` — o formato de
  sempre, inferido por `z.preprocess` quando o campo falta — ou `creature`). Uma entrada de criatura
  tem `id, name, tags, description, page` e `sheet` (`CharacterData` sem `imageUrl`/`bio`, com itens
  sem id). `validateCreatureEntry` confere atributos/perícias/recursos/traits/`damageResponses`
  contra o sistema, `size`/tipo válidos e cada item embutido pelo mesmo `validateItemBody` dos itens
  soltos. `entryToCharacter(def, entry, newId, opts?)` monta a ficha NPC nova (`opts.name` para o
  nome numerado). `compendium:list` (§5) some do jogador — filtro no servidor, não só na UI — e o
  ack ganhou `roomIds` (entradas da sala, hoje sempre `[]`: o compêndio da sala aceita `type:
  "creature"` só por schema, sem tela).
- **Importador**: `pnpm import:compendium` converte o pack `ameacas` do Foundry (83 NPCs) em
  `creatures.json`; mapeamento completo, o truque do "outros" pra perícia bater com `computeCharacter`
  e as decisões (ex.: pack `convocacoes` deixado de fora — escala pelo nível do conjurador, ficha
  quase vazia no Foundry) em `docs/plano-criaturas.md` §1.5 e `docs/backlog.md`.
- **Paleta contextual**: a mesma paleta do compêndio (§9.4), não uma segunda. Com a Mesa em foco (sem
  ficha aberta, sem modal) e Ctrl+Espaço/Ctrl+Shift+Espaço/"/" fora de campo de texto
  (`useMapPaletteShortcut`), abre flutuando 384 px à esquerda do mapa, sem escurecer o fundo — o mapa
  continua o alvo da soltura. GM vê itens + criaturas + encontros salvos (§9.14; chips "Criaturas"/
  "Encontros" sempre à mostra no contexto mapa, os `itemKinds[]` do sistema e "Sala" atrás do chip
  "todos ▾"); jogador só consulta itens (o servidor nem manda criaturas nem encontros), chips como
  no contexto ficha (§9.4). `CreaturePreview.tsx` é **compacto** por padrão: nome; "ND · tamanho ·
  tipo"; uma linha com PV/Defesa/Deslocamento (best-effort e genérico — PV via `tokenBar`, Defesa via
  o stat do alvo que `rolls.attackHit`/`attackAutoHit` referencia — `hitRuleTargetPath`,
  `rules/targets.ts` — e Deslocamento via `movement.derived`; sistema sem um desses blocos
  simplesmente omite aquele stat) e Iniciativa (`characterTiebreakBonus`); ataques, um por linha
  (nome do item + fórmula de dano + `DamageTypeBadge`). Sem atributos/perícias/CD/resistências/
  poderes/descrição — isso é o **bloco completo** (`CreatureFullSheet.tsx`, overlay maior, só
  leitura, nunca solta no mapa): botão "Ver bloco completo" no rodapé do preview, ou duplo clique na
  linha da lista. Rodapé do preview: só **quantidade** (1..20) e o toggle **"invisível ao soltar"**
  (padrão ligado, lembrado na sessão) — soltar em si não tem botão próprio, é Enter/Ctrl+Enter/
  arrastar (mesmo de sempre).
- **Soltar no mapa**: `VttCanvas` registra o alvo `"map"` em `dropTargets` (só GM, só `type:
  "creature"`); durante o arrasto desenha um fantasma de `count` retângulos de célula (lado pelo
  `sizes[].tokenCells`, cor do tipo) numa espiral a partir da célula do cursor. Enter no preview
  solta no centro da área visível, mesma espiral. `findFreeCells`/`numberedNames`
  (`packages/shared/src/rules/placement.ts`, com testes) são as **mesmas** funções puras usadas pelo
  cliente (fantasma) e pelo servidor (posição final) — inclusive o `findFreeSpot` que já existia no
  `VttCanvas` virou um caso particular (1 célula) delas. `findFreeCells` anda em anéis de raio
  crescente (Chebyshev) pulando células ocupadas e clampadas às bordas do mapa (grid `"none"` usa
  célula virtual de 70 px, como o botão "novo token"); estoura o raio máximo (12 anéis) → devolve
  menos posições que o pedido, e o servidor solta ali mesmo (nunca fora do mapa nem sobreposto). Nome
  numerado a partir do maior sufixo já na cena ("Goblin 3" se já existem "Goblin 1/2"); com `count = 1`
  e nenhum homônimo, sem número.
- **Evento** `compendium:spawn-creature { sceneId, entryId, count, visible, x, y }` (§5): o cliente
  manda só o ponto de soltura em pixels, nunca as posições — o servidor roda a mesma espiral, então um
  cliente adulterado não empilha nem sai do mapa. Handler roda numa `prisma.$transaction` (N
  `Character` + N `Token`, tudo ou nada), depois faz um `character:created`/`token:created` por cópia
  (NPC e visibilidade respeitados pelo broadcast de sempre); spawn durante um combate ativo não mexe
  nele — token novo nunca entra sozinho no combate (§3.5, `combat:add` continua manual). Iniciativa: a
  ficha vem com o `{skill.iniciativa}` do bloco, então `combat.tiebreakBonus` já sai certo sem código
  novo.
- **Ficha rápida do NPC** (`NpcQuickCard`, contrato em `docs/tipos-ficha-rapida.md`): clique simples
  num token NPC do GM abre este card **no lugar** do `TokenInspector` genérico (que continua existindo
  atrás do botão "Token" do card — nome, cor, dono, imagem, apagar); qualquer outro token abre o
  `TokenInspector` direto. Versão mínima (a UI de verdade vem do AI Studio sobre o mesmo contrato):
  nome/ND/tipo, PV com −1/+1 e campo de delta, derivados, ataques (clique rola, `character:roll`),
  poderes (clique usa, `character:use-item`), atalhos de condição e "Ficha completa" (abre o drawer).

### 9.2 Barra de ferramentas e régua
Descritas em §3.2: modos Selecionar / Mover mapa / Régua com atalhos, caixa de seleção, movimento em grupo e a régua efêmera (`ruler:update`).

### 9.3 Fog of war manual
Névoa pintada à mão pelo GM. **Sem** luz dinâmica, paredes ou visão por token (ficam para depois). Plano e decisões em `docs/plano-fog.md`.

- **Modelo**: `Scene.fog = { enabled, base: "hidden" | "revealed", shapes: FogShape[] }` (`FogConfigSchema`, `packages/shared/src/schemas/fog.ts`). `FogShape = { id, mode: "reveal" | "hide" }` + geometria em **pixels do mapa**: `circle {cx, cy, r}`, `rect {x, y, width, height}`, `polygon {points}` ou `stroke {points, width}` (pincel: um arrasto inteiro vira uma polilinha com largura, e não dezenas de círculos). A área visível é a composição em ordem: parte de `base` e a última shape que contém o ponto decide (`isPointRevealed`, `packages/shared/src/fog/visibility.ts`, usada por cliente e servidor).
- **Eventos**: `fog:update { sceneId, op }` (GM) com as operações `add`, `removeLast` (desfazer último; sem histórico completo), `revealAll` / `hideAll` (limpam a lista e setam `base`) e `setEnabled`. O cliente manda a operação, não a lista, para dois cliques rápidos não se sobrescreverem. O servidor aplica, persiste e faz broadcast de `fog:updated` com o estado completo.
- **Visibilidade de tokens**: o GM vê todos. O jogador vê um token se `visible` e (é dono, ou fog desligado, ou o **centro** do token está em área revelada). Token que o jogador não pode ver **não é enviado** (mesmo mecanismo de `visible = false`: `token:deleted` ao esconder, `token:updated` ao reaparecer), então nem nome nem existência vazam. Como "é dono" varia por pessoa, o broadcast vai para a sala do GM, a sala do dono e `players` exceto o dono. Após `fog:update` o servidor reenvia todos os tokens da cena com essa regra (e o combate da cena, se houver — §3.5, mesma visibilidade); o snapshot filtra igual. O cliente aplica a mesma função nos tokens alheios para cobrir broadcasts fora de ordem.
- **Renderização**: camadas mapa → tokens que o usuário **não** controla → névoa → tokens que controla → réguas. Jogador vê a névoa preta opaca; GM a vê a 50% (opacidade CSS no canvas da Layer, para o `destination-out` das áreas reveladas continuar exato). Shapes `reveal` apagam com `destination-out`; `hide` pintam preto por cima.
- **Ferramentas** (só GM, modo Névoa, atalho **F**): sub-modos Revelar / Ocultar; formas Pincel (círculo que segue o arrasto, tamanho ajustável), Retângulo e Polígono (cliques; duplo clique fecha; Esc cancela); botões Desfazer último (Ctrl+Z no modo Névoa), Revelar tudo, Ocultar tudo e o toggle "Fog ativo". O pincel envia ao soltar o mouse, nunca a cada movimento, com os pontos decimados.
- **Limite de shapes** (decisão): o cliente avisa o GM ao passar de 400 e o servidor recusa `add` acima de 500 (constantes `FOG_SHAPES_WARN` / `FOG_SHAPES_MAX`). Não há mesclagem automática de geometria: unir polígonos com precisão é complexo, e na prática um arrasto já é uma shape só e "Revelar/Ocultar tudo" zera a lista. Cada shape aceita no máximo 2000 pontos.

### 9.6 Desfazer/refazer (Ctrl+Z) para ações do Mestre no mapa

Pilha de histórico por sala, só do GM (setembro/2026). Plano e decisões em `docs/plano-desfazer.md`;
revisão pós-implementação em `docs/revisao-desfazer.md`.

- **Escopo**: apagar token — um ou vários (`token:delete`/`token:delete-many`), mover e redimensionar
  — um token ou vários selecionados juntos (`token:update`/`token:update-many`), alternar condição e
  alterar visibilidade (também `token:update`, mesmos campos rastreados), soltar criaturas do
  compêndio (`compendium:spawn-creature`) ou um encontro salvo inteiro (`encounter:spawn`, §9.14 —
  mesmo mecanismo, uma entrada só pro encontro todo), apagar mapa (`scene:delete`, §9.7), editar o grid de um
  mapa quando isso reencaixa/redimensiona algum token (`scene:updateGrid`, §9.7 — só quando há
  token pra reencaixar; um patch que só muda cor/`snap` não entra na pilha), colocar/mover/girar/
  apagar um gabarito de área de efeito do GM (`template:upsert`/`template:remove`, §9.9 — do
  jogador não entra aqui, tem a própria pilha local), fixar/mover/editar/apagar um pino de handout
  ou nota no mapa (`pin:create`/`pin:update`/`pin:remove`, §9.10/§9.16 — mover vale pra qualquer
  `kind`, editar conteúdo só pra nota), e apagar um handout da biblioteca (`handout:delete`, §9.10 —
  apaga junto, na mesma entrada, os pinos dele em qualquer mapa; desfazer restaura os dois). Fora:
  notas do Mestre (`scene:set-notes`/`token:set-notes`, §9.16 — trivial de desfazer à mão: escreve
  de novo), chat/rolagens (inclusive
  `handout:show`/`handout:close`, que não mexem em nada persistido além da mensagem em si),
  ações de `combat:*` disparadas pelo usuário, ficha de personagem, criar token em branco, os
  demais campos de `token:update` (nome, cor, imagem, dono — painel do token),
  criar/renomear/duplicar/reordenar/ativar mapa sem apagar nada (§9.7), criar/editar um handout na
  biblioteca (`handout:create`/`handout:update` — trivial de desfazer à mão: apaga/edita de novo)
  e a Névoa, que mantém seu próprio Ctrl+Z (`fog:update removeLast`, §9.3) — dentro da ferramenta
  Névoa o atalho continua sendo o dela; fora, é o desfazer geral daqui.
- **Pilha**: em memória por sala (não persistida — mesmo padrão da presença de conexão e da régua;
  se perde num restart do servidor), cap de 50 entradas de undo, sem cap próprio no redo; uma ação
  nova do GM limpa o redo. Só ações com `role === "gm"` empilham (jogador movendo o próprio token
  não conta — ver `docs/plano-desfazer.md` §6 pela justificativa). Uma entrada cobre tudo que saiu
  na MESMA chamada de socket: `token:delete-many`/`token:update-many` (lote explícito) e
  `compendium:spawn-creature` (N cópias) ou `encounter:spawn` (várias criaturas diferentes do
  encontro, §9.14) já nascem como uma entrada só; ecos "ao vivo" do arraste (`TokenPatch.live`)
  nunca empilham, só o patch final do gesto.
- **Apagar token = soft delete** (`Token.deletedAt`, §4): a linha continua no banco (PV, condições,
  `characterId`, `Combatant`), então desfazer restaura tudo sem precisar de snapshot manual; se o
  token era combatente, o desfazer também devolve `round`/`activeCombatantId`/`order` do combate ao
  que eram antes. Um token soft-deleted conta como "não encontrado" pra qualquer handler normal.
  Limpeza definitiva: 30 dias depois, `services/cleanup.ts` apaga a linha de vez (sem gatilho de
  "encerrar sala" — não existe esse conceito no MVP).
- **Spawn de criatura desfaz com hard delete** (assimetria proposital com o soft delete acima:
  cópias recém-criadas, sem histórico próprio ainda) — apaga a ficha NPC e o token de vez; refazer
  recria as mesmas linhas (mesmos ids) a partir do snapshot capturado na hora do spawn.
  `entryToCharacter`/o restante do fluxo de spawn (§9.5) não mudam; `encounter:spawn` (§9.14) monta
  a mesma entrada (`buildMultiSpawnHistoryEntry`, reaproveitado pelos dois handlers) para todas as
  cópias de todas as criaturas do encontro de uma vez. Se o token spawnado entrou num
  combate depois (`combat:add`, manual — spawn nunca entra sozinho, §9.5), o desfazer roda o mesmo
  ajuste de `round`/`activeCombatantId`/`order` de sempre antes do hard delete (o combatente cai
  junto pelo `onDelete: Cascade`, mas o combate não fica com o cursor de turno apontando pra alguém
  que sumiu); o snapshot devolvido nesse ajuste é descartado (não há "restaurar" num hard delete).
- **Invalidação**: `revert`/`apply` reconferem premissas (linha ainda existe) antes de escrever; se
  algo não bate, a entrada é descartada (não vai pro lado oposto da pilha) e o ack devolve erro.
- **UI**: botões de desfazer/refazer na Toolbar (só GM), desabilitados quando a pilha correspondente
  está vazia, tooltip com o resumo da entrada no topo ("apagar Goblin 3"); toast "Desfeito/Refeito:
  <resumo>" ao usar. Atalho Ctrl+Z fora do modo Névoa (Ctrl+Shift+Z/Ctrl+Y refazem), sempre que o
  foco não está em campo de texto (`isTyping`, mesma proteção dos outros atalhos — cobre o chat).

### 9.7 Múltiplos mapas por sala

Criar, renomear, duplicar, apagar, listar e reordenar mapas numa sala; escolher o mapa ativo; o GM
navegar e editar qualquer mapa sem ativar; levar tokens de um mapa para outro ao ativar; combate por
mapa (setembro/2026). Plano e decisões em `docs/plano-mapas.md`; revisão pós-implementação em
`docs/revisao-mapas.md`. Nomenclatura ("mapa" na UI, `Scene` no código): §1.

- **Modelo**: `Scene` ganhou `order` (posição no painel, renumerada 0..n-1 a cada `scene:reorder`),
  `arrival` (`{x,y} | null`, ponto de chegada de "Levar para o mapa") e `deletedAt` (soft delete,
  mesmo padrão de `Token.deletedAt` — §4). `activeSceneId` da sala é uma invariante: sempre aponta
  pra um mapa vivo (nunca apagado); `scene:delete` recusa apagar o mapa ativo ou o último da sala.
- **Estado por cliente — `viewingSceneId`**: jogador sempre vê o ativo (derivado). GM tem um mapa
  "visitado" independente do ativo (estado do cliente, persistido em `sessionStorage` por sala —
  dois GMs, ou duas abas, podem olhar mapas diferentes ao mesmo tempo). `selectViewedScene`
  substitui `selectActiveScene` em quase todo lugar do web (canvas, névoa, régua, combate, spawn de
  criatura, `MapConfigModal`); `selectActiveScene` continua valendo pro `MapSelector`. Quando os
  dois divergem, o botão-seletor da TopBar troca para "Vendo X · ativo: Y" com destaque âmbar — o
  aviso que evita o erro mais provável da feature: editar um mapa achando que a mesa está vendo.
- **Enquadramento (zoom/pan) por mapa e por usuário** (`VttCanvas`, `lib/session.ts#getSavedView`/
  `setSavedView`): cada aba lembra o zoom/pan de cada mapa que já viu nesta sessão, em
  `sessionStorage` por sala+mapa (`tvtt:view:<roomId>:<sceneId>` — sobrevive a F5, igual a
  `viewingSceneId` acima). Ao trocar de mapa visto (`scene:enter`: `scene:activate`, jogador
  seguindo `room:activeSceneChanged`, GM navegando pelo `MapSelector`) restaura o enquadramento
  salvo desse mapa; nunca visto nesta sessão cai no padrão (ajustar à tela). Vale pra GM e jogador,
  cada um com o seu (é por ABA, mesmo raciocínio de `viewingSceneId`: duas pessoas — ou duas abas —
  nunca compartilham enquadramento). Só muda o enquadramento salvo o que o usuário decide de
  propósito — roda do mouse, botões +/−/"Ajustar" e arrastar o mapa (gravado ali mesmo, nunca por um
  efeito reativo em zoom/pan — ver comentário de `saveView` em `VttCanvas.tsx`); receber
  `token:updated`/`fog:updated`/`combat:updated` nunca reenquadra. "Centralizar no token da vez"
  (§3.5, preferência por usuário) continua sobrepondo por cima quando ligada, mas não é salvo como
  enquadramento do mapa — é um foco temporário, não a escolha do usuário para aquele mapa.
- **`scene:enter`**: troca de mapa sem os efeitos colaterais de `room:join` (presença, snapshot
  inteiro) — busca só tokens+combate do mapa pedido. GM entra em qualquer mapa vivo da sala;
  jogador só no ativo. `room:join` continua devolvendo tokens/combate do mapa ATIVO (o que todo
  jogador quer no primeiro frame); ao receber `room:activeSceneChanged`, jogador sempre chama
  `scene:enter` do novo ativo, GM só se estava vendo o que deixou de ser ativo — quem clicou em
  "Ativar" muda `viewingSceneId` na hora e segue sempre pro destino.
- **Broadcast de mapa** (`token:*`, `fog:updated`, `combat:updated`, `ruler:updated`): o GM sempre
  recebe (pode estar preparando um mapa que a mesa não vê); jogador só se o mapa em questão for o
  ATIVO da sala (`services/visibility.ts#isActiveScene`) — nunca sabe de tokens/combate/névoa de um
  mapa que não vê.
- **Combate por mapa** (§3.5): deixou de exigir mapa ativo — `requireActiveScene`/
  `requireActiveCombat` viraram `requireScene`/`requireCombat(sceneId)`; todo `combat:*` leva
  `sceneId`. `combat:updated` virou `{ sceneId, combat }`. Jogador só age no mapa ativo da sala
  (`requirePlayerOnActiveScene`); ativar outro mapa não encerra o combate do anterior.
- **Ativar com "Levar para o mapa"** (`scene:activate { sceneId, moveTokenIds?, dropPoint? }`):
  diálogo (`CarryTokensDialog`) pré-marca tokens de jogador (ficha ou dono) e os que estavam
  selecionados no mapa; o GM ajusta livremente, confirma ("Ativar e levar" ou "Ativar sem levar
  ninguém") e o servidor, numa transação: tira cada token movido do combate de origem (linha do
  `Combatant` apagada de vez — diferente do soft delete de `token:delete`, aqui o token não some, só
  muda de mapa), calcula a posição no destino com `findFreeCells` (mesma espiral do spawn de
  criatura) a partir de `scene.arrival ?? dropPoint ?? centro do mapa`, e muda `sceneId`/`x`/`y` —
  PV, condições, ficha, dono, rotação, imagem e **tamanho** (`cells`) vão junto de graça: como
  `cells` é a fonte da verdade (docs/plano-grid.md), o token não precisa mudar de tamanho ao trocar
  de mapa — os pixels já são sempre `cells × cellSize do mapa ATUAL`, então um token 2×2 continua
  2×2 mesmo indo pra um mapa com `cellSize` diferente (fica maior/menor em pixels, nunca em
  células). Ponto de chegada definido pelo GM no menu do card do mapa (pino visível só pro GM no
  canvas, não é token).
- **Apagar mapa**: bloqueado se for o ativo ou o último da sala. Com token de jogador, a primeira
  chamada só avisa (`{ status: "needs-confirm", playerTokenIds }`, nada apagado ainda); confirmando,
  o servidor move esses tokens pro mapa ativo (mesma mecânica de ativar) antes do soft delete. Tokens de NPC/monstro vão junto com o mapa (ficam soft-deletados por tabela, voltam
  se o GM desfizer). É uma das duas ações de mapa que entram na pilha de desfazer (§9.6, a outra é
  `scene:updateGrid` quando reencaixa tokens, ver abaixo) — criar, renomear, duplicar, reordenar e
  ativar sem apagar nada não entram (efeito colateral de mover tokens seria assustador num Ctrl+Z;
  as outras quatro são triviais de desfazer à mão).
- **Editar o grid** (`scene:updateGrid { sceneId, grid: Partial<GridConfig> }`): merge parcial no
  `grid` da cena. Se a troca muda a geometria efetiva (`cellSize`, `offsetX/Y` ou `type` — inclusive
  a célula virtual de 70px do grid "none") de um jeito que desalinha algum token já no mapa, o
  servidor reencaixa a POSIÇÃO de TODOS os tokens da cena na mesma chamada: mesma célula (col/row,
  recalculada no grid novo), grudada dentro do mapa (`resnapTokenPosition`,
  `apps/server/src/services/grid.ts`, achado da revisão do plano do grid — `docs/revisao-grid.md`
  §2: sem o clamp, um token já encostado numa borda podia sair do mapa se a célula nova empurrasse
  a posição reencaixada pra fora) — sem isso, mudar o grid de um mapa com tokens deixaria cada um
  desalinhado da célula, ou fora do mapa. O TAMANHO (`cells`)
  nunca precisa mudar aqui (docs/plano-grid.md: já é sempre `cells × cellSize do grid ATUAL`, então
  recalibrar/trocar `cellSize` nunca redimensiona nada, só reencaixa posição). Um patch que só muda
  cor/`snap` não reencaixa ninguém (`resnapTokenPosition` detecta que nada mudou). Cada token
  reencaixado sai num `token:updated` (mesma visibilidade de sempre); se algum foi, a troca inteira
  (grid + tokens) entra na pilha de desfazer como UMA entrada — reencaixar não é trivial de desfazer
  à mão, diferente de só mudar cor/snap.
- **Seletor de mapa** (`MapSelector`, na TopBar, só GM): botão "Mapa: <nome visitado> ▾" (ou "Vendo
  X · ativo: Y" em destaque âmbar quando diverge, ver acima). Clique ou a tecla **M** (fora de campo
  de texto) abrem um dropdown de ~420 px ancorado abaixo do botão; Esc ou clique fora fecham. Quando
  divergente, o topo do dropdown ganha "← Ir para o ativo" e "Ativar este". O corpo é o `MapsPanel`:
  card por mapa com miniatura (gerada no cliente, cacheada em `localStorage` — `lib/thumbnails.ts`),
  contagem de tokens e status de combate (`scene:list`, buscado ao abrir o dropdown — dados que o
  cliente não carregou de mapas que não visitou), badges Ativo/Vendo, renomear inline, duplicar,
  apagar, arrastar para reordenar (`scene:reorder`, mesmo contrato de `combat:reorder`), e no
  rodapé "+ Novo mapa"/"Novo por upload". Selecionar um mapa ou iniciar "Definir ponto de chegada"
  fecha o dropdown (o segundo precisa que o clique seguinte chegue ao canvas); as demais ações
  deixam o dropdown aberto. Jogador só vê o texto "Mapa: <nome do ativo>", sem botão nem dropdown.
  O menu ⋯ de cada card (Renomear/Duplicar/ponto de chegada/Apagar) abre num portal em
  `document.body` (posição `fixed`, calculada a partir do botão), nunca preso ao
  `overflow-y-auto` da lista — com muitos mapas o card fica escondido por trás da rolagem sem
  isso. Abre ancorado à direita do botão, embaixo por padrão e virado pra cima quando não há
  espaço abaixo; fecha em clique fora, Esc ou rolagem da lista.
- **Testes puros** (`packages/shared/src/rules/scenes.ts`, `scenes.test.ts`): ordenação
  (`orderScenes`, `nextSceneOrder`), `reorderScenes` (renumera, rejeita conjunto incompleto/
  repetido/estranho), `duplicateScene`/`duplicateSceneName`, `pickTokensToCarry` (pré-marcação),
  `canDeleteScene` (bloqueado/precisa confirmar/ok). `tokenPixelSize`/`cellsFromPixels`
  (`packages/shared/src/rules/placement.ts`, `placement.test.ts`) e o reencaixe de posição
  (`resnapTokenPosition`, `apps/server/src/services/grid.ts`, `grid.test.ts`: troca de `cellSize`,
  só offset, grid "none" ↔ square, sem mudança nenhuma, e o clamp na borda do mapa com token 1×1 e
  2×2) são testados à parte, sem banco.

### 9.8 Painel lateral recolhível

Recolher o `SidePanel` (Chat/Iniciativa/Fichas) pra dar a largura toda ao canvas (setembro/2026).

- **Ícone + atalho**: um botão na borda entre o canvas e o painel (expandido, sobreposto à borda
  esquerda do painel; recolhido, dentro da alça — abaixo) alterna o estado; atalho **\\** (barra
  invertida) ou **Ctrl+B**, fora de campo de texto (`isTyping`, mesma proteção dos outros atalhos
  — cobre o chat, onde `\` deveria só digitar), em `lib/useSidePanelShortcut.ts`.
- **Recolhido**: o painel vira uma alça fina (`w-7`) em vez de sumir — o canvas ocupa o resto da
  largura (é só `flex-1` no `<main>`, a alça é que encolhe). A alça mostra o botão pra reabrir e
  dois badges, só quando valem: um ponto pulsante "é o seu turno" (mesma checagem de
  `useTurnTitle`) e um contador de mensagens chegadas desde que recolheu (zera ao reabrir, não
  soma por aba — reabrir em qualquer aba já conta como "visto"; não é um "não lido" por mensagem,
  só um aviso de que algo chegou enquanto a alça estava fina).
- **Preferência por usuário**: `localStorage` (`tvtt:sidePanelCollapsed`), mesmo padrão de
  "centralizar no token da vez" (§3.5) — cada navegador/aba é "um usuário" neste app sem login.

### 9.9 Gabaritos de área de efeito (templates)

Círculo, cone, linha e quadrado no mapa, no estilo Foundry, pra visualizar alcance de magias/
poderes e ver quem está dentro (setembro/2026). Plano e decisões em `docs/plano-gabaritos.md`.
**Fora do escopo**: qualquer automação de regra (dano, CD, resistência continuam manuais — só
desenha e destaca) e interação com a névoa (gabarito aparece independente dela, como a régua).

- **Modelo**: `SystemDefinition.templates` opcional (`{ coneAngle, lineWidth, presets[],
  shapeLabels }`) — sem ele a ferramenta "Área" nem aparece na barra (regra número 1: nenhum
  ângulo/nome de forma fica hardcoded no código). `coneAngle`/`lineWidth` são o padrão de todo
  cone/linha do sistema, na unidade do `grid` (graus e metros em T20: 90° e 1,5 m); um preset
  (`presets[].angle`/`.width`) pode sobrescrever. `shapeLabels` (`{circle, cone, line, square}`)
  dá o nome de cada forma na linguagem do sistema (T20 chama o círculo de "Esfera") — usado na
  barra de ferramentas, no editor de item e no card do chat, sempre o mesmo rótulo. `Template`
  (`packages/shared/src/schemas/template.ts`) é discriminado por `shape` (`circle {r}`,
  `cone {length, angle}`, `line {length, width}`, `square {side}`), com `id, ownerId, x, y,
  rotation, label` em comum — geometria em **pixels do mapa**, como token/fog; `angle`/`width` de
  cone/linha são copiados do padrão do sistema (ou do preset) no momento da criação, então o
  gabarito continua correto mesmo se o JSON mudar depois.
- **Persistência**: efêmeros por sessão — guardados em memória no servidor
  (`apps/server/src/services/templates.ts`, `Map<sceneId, Map<templateId, Template>>`, mesmo
  padrão de `presence.ts`), nunca no banco. Sobrevivem a F5/reconexão (vêm no `RoomSnapshot` do
  mapa ativo e no ack de `scene:enter`), mas não a um restart do servidor nem à troca de mapa
  (cada mapa só mostra os seus); `scene:delete` limpa os do mapa apagado. Cap de 200 gabaritos por
  mapa (`TEMPLATE_MAX_PER_SCENE`), mesmo espírito do limite de shapes da névoa.
- **Eventos** (`template:upsert`/`template:remove`, cliente → servidor; `template:upserted`/
  `template:removed`, broadcast): mesma regra de broadcast de mapa de sempre — GM sempre recebe,
  jogador só se `sceneId` é o mapa ATIVO da sala. `template:upsert` cria (id novo) ou edita
  (mover/girar); dono é sempre travado no servidor (`ownerId` do payload nunca é confiado — fixo
  desde a criação, igual ao princípio de token). Permissão: dono ou GM edita/apaga; jogador só no
  mapa ativo (mesma regra de `ruler:update`/`combat:delay`). `dragFrom` (x/y/rotation do
  mousedown do gesto de mover/girar) viaja junto no patch final, sem `live` — mesmo papel de
  `TokenPatch.dragFrom` (§9.6): os ecos `live` já escreveram o gabarito em memória durante o
  arraste, então é o único jeito do servidor saber o "antes" de verdade pro desfazer.
- **Desfazer/refazer (§9.6)**: GM empilha na pilha geral da sala, junto com token/spawn/mapa —
  `socket/templates.ts` monta a `HistoryEntry` ("colocar"/"mover"/"girar"/"apagar área (cone 9 m)")
  e chama `pushEntry`/`emitHistoryUpdated` como qualquer outra ação do GM; `revert`/`apply`
  reemitem o gabarito em memória direto (sem linha de banco pra invalidar — best-effort, como a
  régua). Jogador não tem a pilha geral (`history:undo` é `gmOnly`): tem a própria, só no cliente
  (`apps/web/src/store/templateHistory.ts`), que empilha as PRÓPRIAS ações de gabarito e desfaz com
  Ctrl+Z (sem Ctrl+Shift+Z/Ctrl+Y — sem refazer, mesmo motivo da Névoa) reemitindo
  `template:upsert`/`remove` com o estado anterior; toast "Desfeito: `<resumo>`" nos dois casos.
- **Ferramenta "Área"** (barra do canvas, atalho **T**, não é GM-only — jogador também coloca os
  seus): sub-modo por forma e um campo de tamanho só (raio/comprimento/lado, na unidade do
  sistema); presets de `SystemDefinition.templates.presets` preenchem forma+tamanho num dropdown,
  sem posicionar sozinho. **Criar por clique e arrasto**, mousedown define a origem — o que ela
  significa depende da forma e se o grid está ativo:
  - **Círculo/cone** (sempre) e **quadrado/linha com "Grudar no grid" desligado ou grid "none"**:
    origem contínua, arrastar calcula o tamanho ao vivo pela distância (círculo: raio; cone/linha:
    comprimento, com direção = ângulo do arrasto; quadrado: lado, sem girar). Com grid ativo, Alt
    solta o snap (o tempo todo do arrasto, não só na origem): círculo gruda no CENTRO de célula
    mais perto (raio em meia célula, 0,75 m em T20 — a regra do centro decide as células, não
    precisa de vértice); cone gruda no vértice OU centro mais perto (comprimento em meia célula,
    direção em passos de 15°, Shift solta).
  - **Quadrado/linha com "Grudar no grid" ligado** (Alt cai no caso acima): as duas formas são
    SEMPRE um conjunto de células inteiras, nunca geometria livre — a célula sob o cursor no
    mousedown é a célula-âncora, nunca fica de fora do resultado. Quadrado: arrastar define
    quantas células por lado (n×n, pela distância Chebyshev até a célula do ponteiro) e pra qual
    lado cresce (o quadrante do arrasto) — as bordas caem sempre sobre linhas do grid. Linha:
    direção só em múltiplos de 45° (eixos e diagonais, sem Shift pra soltar — foge da regra de
    célula inteira); comprimento em número de células a partir da âncora; ocupa 100% de cada
    célula (fica DENTRO delas, nunca centrada numa linha do grid) — reto é uma fileira de células,
    diagonal é a escada de células que o eixo atravessa pelo centro; largura sempre 1 célula
    (`templates.lineWidth`, que em T20 já é 1 célula). Um clique sem arrasto usa o campo de
    tamanho da barra convertido em células (mínimo 1): quadrado ancora na célula clicada e cresce
    pra baixo/direita; linha começa na célula clicada apontando pra direita — mesma regra do
    arrasto, é assim que os presets continuam funcionando.

  Rótulo ao vivo (tamanho + "N alvos") durante o arrasto; soltar confirma; Esc cancela. Desenho por
  forma: círculo/cone (e uma linha livre, sem grid) usam sempre a forma lisa normal com um
  preenchimento sutil por célula por cima (regra do centro, mostra a discretização ao lado do
  contorno geométrico). Quadrado (sempre reto) e linha no EIXO do grid são sempre um retângulo
  alinhado célula a célula ponta a ponta — a própria forma lisa já é exatamente essa área, um
  preenchimento único com só o contorno EXTERNO (sem bordas entre células, sem overlay por cima:
  seria a mesma área duplicada). Linha na DIAGONAL: as células só se tocam por um canto (nunca
  compartilham uma aresta inteira), então cada uma desenhada com o próprio contorno já É o contorno
  externo da escada, sem "costura" pra fazer entre elas. Com grid "none", tudo livre, sem snap nem
  bloco de células. Depois de colocado (ferramenta Selecionar):
  arrastar o corpo move, uma alça na ponta (cone/linha) ou perto da borda (quadrado; círculo não
  tem, girar não muda nada) gira — continua geometria livre, sem o snap por célula da criação;
  Delete/Backspace apaga o selecionado. Toda a interação (selecionar, arrastar, alça de rotação) é
  por geometria, nunca pelo hit canvas do Konva — mesmo motivo de sempre neste projeto
  (`docs/debug-condicoes.md`: canvas de hit embaralhado por proteção anti-fingerprinting).
- **Destaque de alvos**: token conta como "dentro" se o centro da célula dele está na forma; token
  grande (mais de uma célula) conta se qualquer célula estiver dentro (`tokensInTemplate`,
  `packages/shared/src/rules/templates.ts`, puro e testado). Rótulo "N alvos" no gabarito e anel
  nos tokens atingidos — só destaque visual, nenhuma automação. Enquanto o gabarito que EU coloquei
  existir, esses mesmos tokens são meus alvos de verdade (`targetsFromTemplate`, §9.12) —
  substituindo a seleção manual, ao vivo conforme o gabarito ou os tokens se movem.
- **Área estruturada nos itens** (`Activation.area`, §3.6): `{ kind: "shape", shape, size } |
  { kind: "text", text } | null` em vez de texto livre — "Nenhuma"/"Forma" (só quando o sistema
  declara `templates`; select da forma com os rótulos de `shapeLabels` + número + unidade do
  grid)/"Especial" (texto livre, "3 alvos", "todos os aliados"...) no editor da ficha.
  `TemplateAreaSchema` migra o formato antigo (string solta, persistida em `Character.data` e em
  `ChatMessage.item` — cards antigos do chat) com `preprocess`: string vazia vira `null`, string
  com texto vira `{kind:"text"}`; sem migration de banco (os dois campos são `Json`). O
  aprimoramento `areaSet` continua sobrescrevendo com texto livre (`{kind:"areaSet", text}`),
  mesmo quando o item tem uma forma estruturada. O importador (`scripts/import-foundry-compendium.ts`)
  casa o texto do Foundry com `parseAreaText` (mesmo padrão de "esfera de 6 m", "esfera com 6m de
  raio", "cone de 9 m", "linha de 30 m", "quadrado/cubo de N m", "raio de N m", sem acento/caixa/
  espaço fixos); sem match, cai em texto livre — contado no relatório da importação.
- **Botão "Colocar área"** no card de item do chat, no preview do compêndio e na ficha rápida
  (`formatArea`, `packages/shared/src/rules/templates.ts` — "Esfera 6 m" ou o texto livre): o
  botão só aparece quando `area.kind === "shape"` e o sistema declara `templates` (fonte única —
  sem reparsear texto no card); clicar já abre a ferramenta com a forma e o tamanho do item, o
  clique no mapa escolhe onde colocar (não ancora no token de quem usou o item).

### 9.10 Handouts e pinos no mapa

O GM mostra uma imagem ou um texto curto pros jogadores, em tela cheia, ou fixa um pino no mapa
(setembro/2026). Biblioteca de handouts por sala, permissão de criar/editar/apagar/mostrar/fixar é
sempre do GM; jogador só vê o que é mostrado pra ele (chat) ou fixado visível no mapa.

O pino no mapa foi **unificado** com o pino de nota (docs/plano-narracao.md, §9.16): um único
modelo `Pin`, `kind: "image" | "text"` (pino de handout, como sempre) ou `"note"` (pino de nota —
título/texto/ícone/cor escritos direto no pino, sem passar pela biblioteca). Os três compartilham
geometria, `visible`, soft delete e desfazer — ver eventos `pin:*` abaixo.

- **Modelo**: `Handout` (biblioteca da sala, §4) — `kind: "image" | "text"`; imagem reaproveita
  `POST /api/upload` (mesmo fluxo de `scene:setMap`: o cliente sobe o arquivo primeiro, manda a URL
  pronta pro socket), até 20 MB; texto vai direto no evento, até 20 000 caracteres, sempre texto
  puro (sem parser de markdown — ver §8). Até 10 tags de até 30 caracteres cada, sem uso ainda além
  de guardar (busca/filtro por tag fica pra depois). Soft delete (`deletedAt`, mesmo padrão de
  `Token`/`Scene`): `handout:delete` marca a data — e a de todo `Pin` dele em qualquer mapa na
  mesma transação — numa única entrada de desfazer (§9.6); a limpeza definitiva segue o mesmo
  `services/cleanup.ts` dos outros soft deletes.
- **Mostrar** (`handout:show { id, target }`, GM): monta uma cópia denormalizada do handout
  (`HandoutCard` — nome, tipo, URL/dimensões ou texto) e publica `ChatMessage{kind:"handout"}` com
  `visibility:"all"` sempre; quem recebe de verdade é decidido por `whisperTo` (§4/§5), não por
  `visibility`. `target: "all"` = `whisperTo: null`, todo mundo recebe. `target: {participantId}` =
  sussurro visual: só o GM e aquele jogador recebem a mensagem — nem card, nem placeholder pros
  demais (mesmo mecanismo de exclusão total que já existia pro `tokenId` de uma rolagem ligada a um
  token oculto, §3.4, só que por PESSOA — `whisperGateOk`/`blockedPlayerIdsForWhisper`,
  `apps/server/src/services/chatVisibility.ts` — reaproveitado tal e qual pelo sussurro do chat
  comum, §3.4). A mensagem denormaliza o conteúdo (mesmo padrão do `ItemCard`): mesmo se o handout
  original for editado ou apagado depois, o card já publicado no chat continua mostrando o que foi
  mostrado na hora — é assim que "fica no histórico" funciona sem precisar reconsultar a biblioteca
  (que, de qualquer forma, o jogador nunca acessa).
- **Abrir automaticamente**: o cliente NÃO tem um evento separado de "abrir overlay" — ele abre
  sozinho quando o handler de `chat:message` recebe AO VIVO (via socket, não a hidratação em lote
  do `room:join`) uma mensagem `kind:"handout"` que chegou até ele (`store/handouts.ts#openFromLiveMessage`,
  chamado de `bindSocket.ts`). Isso já dá de graça a regra "quem entra depois só vê a miniatura no
  chat e clica pra abrir": o histórico do snapshot popula a store de chat por `setAll`, nunca
  dispara esse handler.
- **Fechar para todos** (`handout:close { messageId }`, GM): não mexe na mensagem nem no banco —
  só um broadcast efêmero (`handout:closed`) pro mesmo público que a mensagem original tinha
  (recalculado a partir de `ChatMessage.whisperTo`), instruindo quem tem ESSE `messageId` aberto a
  fechar. O card continua no chat, clicável — reabrir é 100% local (o conteúdo já está denormalizado
  na mensagem, sem round-trip ao servidor). Cada um também pode fechar só o próprio, a qualquer
  hora, sem avisar ninguém.
- **Pino no mapa** (`Pin`, §4): `pin:create { sceneId, x, y, visible, kind: "handout", handoutId }`
  cria uma cópia denormalizada do handout (mesmos campos do `HandoutCard`, o `kind` gravado vira
  "image"/"text" — o servidor consulta a biblioteca pra saber qual); `pin:create { ..., kind: "note",
  title, text, icon?, color? }` cria um pino de nota com o conteúdo direto (§9.16). `visible` é o
  GM quem decide na hora de fixar (pino invisível só aparece pro GM, mesma regra de `Token.visible`,
  sem névoa — um pino não tem "centro", é um ícone do GM); pino de handout não tem toggle depois
  (apagar e fixar de novo muda) — pino de nota pode editar (`pin:update`, só `kind:"note"`: título/
  texto/ícone/cor/visibilidade no lugar). Broadcast de mapa de sempre: GM recebe qualquer mapa;
  jogador só se `visible` e `sceneId` é o mapa ATIVO da sala.
  - **Interação no mapa (ferramenta Selecionar) — se comporta como token** (docs/plano-narracao.md):
    clique simples (qualquer um) SELECIONA (halo tracejado dourado, igual token/gabarito), sem abrir
    nada; duplo clique (qualquer um) abre o overlay (handout, tela cheia) ou o cartão (nota, mais
    leve — GM edita/apaga no próprio cartão). Arrastar move o pino selecionado (só GM; jogador
    seleciona/abre, não arrasta) — `pin:update { patch: { x, y } }`, que vale pra QUALQUER `kind`
    (mover não mexe no conteúdo). **Delete/Backspace apaga o pino selecionado** (só GM — mesmo
    atalho de token/gabarito, `lib/useDeleteSelectionShortcut.ts`; sem confirmação, o Ctrl+Z do GM
    cobre um clique errado tão bem quanto um `confirm()` custaria uma interrupção); token, gabarito
    e pino nunca ficam selecionados juntos (mesma exclusão mútua de sempre). Sem botão direito
    próprio (diferente de token, que abre o menu de condições ali). Tudo detectado por GEOMETRIA em
    `VttCanvas`, nunca pelo hit canvas do Konva — mesmo motivo de sempre neste projeto (canvas de
    hit embaralhado por proteção anti-fingerprinting, docs/debug-condicoes.md); `PinLayer` continua
    `listening={false}`, só desenho.
  - `pin:create`/`pin:update`/`pin:remove` entram na pilha de desfazer do GM, mesmo espírito de
    gabarito de área (§9.6) — diferente de gabarito (efêmero em memória), o pino é persistido
    (`Prisma.pin`), então `revert`/`apply` alternam `deletedAt` (criar/apagar) ou reescrevem os
    campos que mudaram — posição (mover) e/ou conteúdo de nota (editar) — sem precisar reconstruir
    nada; o resumo no tooltip do botão Desfazer diferencia "mover pino" de "editar pino".
- **Ícone/cor de pino de nota** (`SystemDefinition.pinIcons?[]`, opcional): lista de `{ key, label,
  icon (SVG), color }`, mesmo formato de `conditions[]` — não é regra de sistema (nenhuma mecânica
  lê isto), então sem essa lista o cliente usa uma paleta padrão embutida no código
  (`lib/pinIcons.ts`, mesmo espírito de `TOKEN_COLORS`); com a lista, ela entra primeiro no
  seletor. `Pin{kind:"note"}.icon` guarda a CHAVE escolhida (ou ausente = padrão embutido).
- **UI**: `HandoutSelector` na TopBar, ao lado do `MapSelector` — ícone de imagem, atalho **J**
  (H já é "Mover mapa", §3.2), abre um dropdown (`HandoutsPanel`) com a biblioteca em cards
  (miniatura, nome, tipo) — mesmo padrão visual do painel "Mapas" (§9.7). Cada card tem: "Mostrar
  para todos" (👁), "Mostrar para..." (envia, abre um mini-menu com os jogadores da sala),
  renomear inline, apagar, e **arrastar o card até o mapa fixa um pino** no ponto largado — mesmo
  mecanismo de arrastar uma criatura do compêndio pro mapa (§9.5): pointer events (não HTML5 drag,
  por causa do Konva), fantasma seguindo o cursor (`HandoutDragGhost`). O alvo de soltura "mapa"
  (`lib/dropTargets.ts`) passou a aceitar **os dois arrastos ao mesmo tempo** no mesmo elemento —
  criatura do compêndio e handout registram cada um o seu `accepts`/`onDrop` sob o mesmo id "map";
  o primeiro cujo `accepts` topa o que está sendo arrastado ganha (o `DropTarget` virou genérico em
  `T`, um id pode ter mais de um registro). Rodapé: "+ Imagem" (upload) / "+ Texto" (nome + textarea).
  **Ferramenta "Pino" na barra** (atalho **P**, só GM): clique no mapa abre um formulário
  (`PinCreatePopover`) com título, nota, ícone/cor e visibilidade; confirmar chama `pin:create` no
  ponto clicado. `HandoutOverlay` (handout) é tela cheia (`position: fixed`, por cima de tudo):
  imagem com zoom (scroll ou botões +/−) e arrastar (pointer events, `translate`+`scale` em CSS);
  texto com rolagem simples. Botão fechar sempre (qualquer um, local); "Fechar para todos" só pro
  GM, e só quando a exibição veio de uma mensagem de chat (um pino aberto não tem `messageId`,
  então não tem esse botão — é só uma visualização local, como abrir a ficha de um token).
  `NotePinCard` (nota) é um cartão flutuante menor, mais adequado a um texto curto: GM edita
  (título/texto no lugar, `pin:update`) ou apaga; jogador só lê. `HandoutCardMessage` no chat
  (miniatura + nome) reabre o handout com `HandoutOverlay`. `PinLayer` no canvas é só desenho
  (`listening={false}`) — clique/apagar são detectados por geometria em `VttCanvas`, mesmo motivo
  de sempre neste projeto: o canvas de hit do Konva é embaralhado por proteção anti-fingerprinting
  (docs/debug-condicoes.md). Raio do pino constante em pixels de TELA (não cresce com o zoom, como
  o rótulo "N alvos" dos gabaritos).
- **Permissões**: todo evento `handout:*` de criar/editar/apagar/listar/mostrar/fechar e `pin:*` de
  criar/editar/apagar é `gmOnly` no servidor (não só escondido na UI). Biblioteca (`handout:created/
  updated/deleted`) é enviada só pra `rooms.gm` — o jogador nunca recebe, nem filtrado; pino segue a
  regra de broadcast de mapa de sempre (§9.7).

### 9.11 Movimento por teclado e orçamento de deslocamento

Setas/WASD movem o token selecionado; com combate ativo, cada combatente tem um orçamento de
deslocamento por turno (metros em T20) — caminho desenhado no mapa, gasto acumulado, bloqueio ao
ultrapassar, override do GM. Plano e decisões em `docs/plano-movimento.md`, revisão (implementação
x plano, bordas testadas) em `docs/revisao-movimento.md`. Fora do escopo: condições que alteram
deslocamento (Lento, Imóvel...) — a conta já sai de uma função pura que recebe modificadores
(`MovementModifier`), mas nada os gera ainda; terreno difícil; caminho com desvio (a medição é
sempre em linha reta entre os pontos do caminho, como a régua, §3.2).

- **Deslocamento da raça** (`{race.movement}`): `SystemDefinition.race?: { kind }` aponta o
  `itemKinds[]` cujos campos `number` viram o placeholder `{race.<campo>}` nas fórmulas — igual
  `{equip.<stat>}` já agrega os itens equipados, mas lendo um único item ativo (T20: o item de
  Raça, no máximo 1). `derived.movement` do `tormenta20.json` passa a ser `"{race.movement}"`
  (antes, uma constante "9"): com raça escolhida, lê `race.fields.movement` (Anão 6, a maioria 9);
  sem raça na ficha, cai no `default` do campo (9). `derivedOverrides.movement` continua
  sobrescrevendo o valor calculado (NPCs com deslocamento fixo digitado à mão).
- **Regra de deslocamento** (`SystemDefinition.movement?: { derived, default, diagonals? }`,
  ausente = sistema sem a regra — nem barra, nem caminho, nem bloqueio, só o movimento livre por
  teclado): `derived` é a chave em `derived[]` com o deslocamento do personagem (T20: `"movement"`);
  `default` é o orçamento de um token SEM ficha vinculada (T20: 9); `diagonals` sobrescreve a regra
  de diagonais só do movimento (ausente = `grid.diagonals`, a mesma que a régua usa — uma mesa só
  precisaria disto se quisesse combate e régua contando diferente). Exige `SystemDefinition.grid`
  (sem `cellSize`/`unit` não dá pra converter célula ↔ metro).
- **Medição com diagonais acumuladas** (`measureCellsFrom`, `packages/shared/src/rules/measure.ts`):
  generaliza `measureCells` para saber quantas diagonais já foram contadas no turno (regra 1-2-1 do
  d20) — sem isso, seis passos diagonais avulsos de 1 célula custariam 6 células em vez de 9.
  `measureCells(dx, dy, rule)` continua existindo (= `measureCellsFrom(..., 0).cells`): régua e
  gabaritos não mudam.
- **Orçamento** (`packages/shared/src/rules/movement.ts`, puro — servidor valida, web faz o preview
  ao vivo com as MESMAS funções): `movementBase` resolve a base (override do GM → `derived` da
  ficha vinculada → `movement.default`, `null` sem `movement` no sistema); `computeMovementBudget`
  aplica modificadores (`set → add → multiply → block`, nunca negativo — hoje a lista sempre chega
  vazia, é o gancho de Lento/Imóvel); `stepCost`/`applyStep` custam e acumulam um passo (dx, dy em
  CÉLULAS) no `MovementState { used, diagonals }` do turno; `fitsInBudget`/`movementRemaining`
  respondem "cabe?" e "quanto sobra", com epsilon de 1e-6 (a regra `euclidean` gera irracionais).
- **Âncora do turno** (D2 do plano): o servidor guarda, por combatente, de onde o próximo movimento
  é medido (`Combatant.movementAnchorX/Y` — início do turno, ou fim do último movimento
  confirmado). Todo `token:update` do combatente da vez — inclusive os ecos `live` do arraste
  (~30/s) — é validado contra `âncora → destino`, mas só o patch FINAL (sem `live`) consome
  orçamento e avança a âncora: os ecos já escrevem no banco durante o arraste (o "antes" lido ali
  seria a posição de 33 ms atrás), e nenhum cliente — nem um adulterado que só manda ecos `live` —
  consegue afastar o token da âncora além do orçamento, porque o servidor decide de novo em cada um.
- **`checkMovement`** (`apps/server/src/services/movement.ts`), chamado de `token:update`/
  `update-many` antes de gravar: sem combate ativo na cena, ou o token não é combatente daquele
  combate (D3 — cenário, montaria, um NPC que o GM está posicionando continuam livres, mesmo com
  combate rolando), libera. Não é o combatente da vez: jogador recebe erro ("Não é o seu turno");
  GM libera sem consumir (não é o turno de ninguém em particular, não há o que debitar). É o da vez:
  sem `movement`/`grid` no sistema, grid da cena `"none"`, ou a trava desligada na sala (abaixo) —
  libera sem consumir, pra QUALQUER um, GM incluso (uma sessão inteira com a trava desligada não
  deixa `movementUsed` residual pra travar alguém depois que ela for religada). Senão, calcula o
  custo do passo e recusa (`HandlerError`, "Deslocamento insuficiente: restam N m") quando não cabe.
- **Início de turno** (`startTurnMovement`): toda vez que o combatente da vez muda —
  `combat:next`/`prev`/`delay`/`resume`, e a remoção do ativo (`stateAfterRemoval`) — o servidor
  resolve o orçamento fresco (ficha vinculada ao TOKEN atual → `movement.default`), zera
  `movementUsed`/`movementDiagonals` e ancora na posição ATUAL do token; `movementPath` reinicia com
  esse ponto único. "Entrar agora" (`combat:resume`) zera na hora — é o próprio turno de quem
  retomou, não espera o próximo `combat:next`.
- **Caminho e visibilidade** (D5): todos que enxergam o token do combatente da vez veem a linha do
  caminho e o gasto — inclusive de um NPC do GM (mesmo comportamento do Foundry). `Combatant.
  movementPath` só vem preenchido pra quem é o combatente DA VEZ (`[]` nos demais, pra não inchar o
  payload); limite de 200 pontos — depois disso, o ponto novo substitui o último em vez de
  empilhar (o desenho perde detalhe, os números continuam exatos).
- **Trava por sala** ("Ignorar limite de movimento", cabeçalho do painel de combate, só GM):
  `combat:set-movement-limit { enabled }` liga/desliga em memória (não vai ao banco, mesmo padrão
  de `services/movementLimit.ts` — não sobrevive a um restart do servidor), broadcast
  `combat:movementLimitChanged` pra todos e entra no `RoomSnapshot.movementLimitEnabled` de quem
  entra depois. Jogador vê o estado (legenda no painel), só o GM muda.
- **Ajuste manual** (`combat:set-movement { sceneId, combatantId, budget?, used? }`, GM): `budget`
  grava direto em `Combatant.movementBudget` (correr, magia, empurrão); `budget: null` volta a
  seguir a ficha (recalcula igual `startTurnMovement`). `used` (o botão "zerar gasto" do painel)
  também reinicia diagonais/âncora/caminho na posição atual do token — sem isso sobraria uma
  diagonal "pendurada" ou um caminho que não bate mais com o gasto zerado.
- **Teclado** (`useTokenMoveShortcuts`, `apps/web/src/lib`): setas/WASD movem o(s) token(s)
  selecionados (Shift = 5 células, snap ao grid — 70 px sem snap com grid `"none"`), só com token
  selecionado e fora de campo de texto — arrastar um token seleciona sozinho (§3.2), então na
  prática só falta seleção se ninguém clicou nem arrastou nada ainda; apertar seta/WASD nesse caso
  mostra o toast "Selecione um token para mover com o teclado" (um por tecla segurada, via o mesmo
  `warnedRef` do aviso "Não é o seu turno") em vez de não fazer nada em silêncio
  (`docs/fix-movimento-turno.md`). `canMoveNow` (`store/combat.ts`) espelha `checkMovement` do
  servidor pra decidir quem pode mover AGORA — usada pelo hook do teclado, pelo `draggable` do
  token no canvas (não é o turno → nem começa a arrastar) e pelo preview de gasto; o servidor
  sempre decide de novo. Segurar a tecla é UM movimento, não N: cada passo aplica local e emite
  `tokens.moveLive` (já throttled a 33 ms); um patch final confirma ao soltar a tecla, ou 250 ms
  depois da última — uma entrada de Ctrl+Z por rajada, não uma por passo (o auto-repeat do SO dispara
  várias vezes por segundo enquanto a tecla fica apertada).
- **Recusa ao soltar/confirmar** (`movementBudgetFallback`, `store/combat.ts`, usada por
  `VttCanvas#handleTokenDragEnd` E pelo teclado): se o destino estoura o orçamento, o cliente manda
  a ÂNCORA em vez do destino — o servidor aceita (custo zero, `HandlerError` nunca dispara pra essa
  posição) e o broadcast recoloca o token pra todo mundo, corrigindo até os ecos `live` que já
  tinham sido gravados. Toast "Deslocamento insuficiente (restam N m)", no máximo um por gesto
  mesmo em arraste de grupo.
- **No mapa** (`MovementLayer`, `apps/web/src/components`, camada Konva só-desenho): polilinha do
  caminho do combatente da vez (tracejada, dourada, espessura constante em pixels de tela — mesmo
  truque `k = 1 / stageScale` da régua e dos pinos), mais o segmento AO VIVO do último ponto
  confirmado até a posição atual do token durante um arraste/passo de teclado. Rótulo ao lado do
  token, "4,5 / 9 m": dourado enquanto o passo em andamento cabe, vermelho quando estoura — o
  número ao vivo soma `movementUsed` ao `stepCost` do segmento em andamento, com as mesmas funções
  puras do servidor. Trava desligada na sala: mostra só o gasto ("4,5 m"), sem o "/ 9" e sem
  vermelho — não há bloqueio, o número é só informativo.
- **No painel de combate** (`CombatPanel`): barra fina (dourada, vermelha em 0) na linha do
  combatente da vez, só quando `movementBudget != null`; GM ganha um campo numérico pro orçamento
  (vazio = segue a ficha) e um botão de zerar o gasto, os dois via `combat:set-movement`.
- **Desfazer não estorna deslocamento**: Ctrl+Z de um movimento (`writeTrackablePatch`, não passa
  pelo `checkMovement` normal) reposiciona o token mas não devolve `movementUsed` — estornar exigiria
  snapshot do estado de movimento em cada entrada de histórico. O botão de zerar gasto (acima)
  cobre o caso raro de precisar corrigir.

### 9.12 Sistema de alvos (targets)

Marcar tokens como alvo, estilo Foundry — o card de ataque mostra o alvo e (se o sistema definir a
regra) se acertou; gabarito de área e "Aplicar" reaproveitam os alvos marcados (setembro/2026).
Plano e decisões em `docs/plano-alvos.md`; revisão (implementação x plano, bordas testadas) em
`docs/revisao-alvos.md`. **Fora do escopo**: aplicar dano automaticamente (confirmação continua
manual), rolar o dano sozinho ao acertar, alvo em `/r` solto, alcance/linha de visão.

- **Efêmeros, por participante** (`services/targets.ts` no servidor, `Map<roomId,
  Map<participantId, {sceneId, tokenIds}>>` — mesmo padrão de `templates.ts`/`presence.ts`; nunca
  no banco). Sobrevivem a F5/reconexão (`RoomSnapshot.targets`), não a um restart do servidor.
- **`target:set { sceneId, tokenIds }`** (lista COMPLETA, não adiciona/remove — mesmo raciocínio de
  `fog:update`): jogador só marca token que VÊ (`visible` + névoa), e só no mapa ATIVO da sala; GM
  em qualquer mapa vivo que esteja vendo. Ids inválidos (token apagado, fora de vista) são
  descartados em silêncio; o ack devolve a lista que valeu. Broadcast `target:updated { participantId,
  sceneId, tokenIds }`: GM sempre recebe (de qualquer jogador); o autor sempre recebe de volta
  (outras abas); **alvos do GM nunca vão a jogador nenhum** (marcar alvo é informação de mestre); se
  o autor é jogador, os OUTROS jogadores recebem, cada um só os ids de token que ele próprio pode
  ver (uma cópia por pessoa). `token:delete`/`delete-many` tiram o token de toda lista que o
  citava; `scene:activate` limpa os alvos dos JOGADORES (o mapa mudou; o GM mantém os dele, pode
  estar preparando o próximo mapa); `scene:delete` limpa os que apontavam pro mapa apagado.
- **Marcar** (ferramenta Selecionar): Alt+clique num token marca/desmarca (vira o único alvo, ou
  limpa se já era o único); Shift+Alt entra/sai da lista; Alt num ponto vazio do mapa limpa; tecla
  **Y** (Shift+Y adiciona) marca o token sob o PONTEIRO, sem precisar clicar — alternativa ao Alt em
  ambientes onde soltar o Alt aciona algo do sistema/navegador. Tratado por geometria (mesmo motivo
  de sempre no projeto — hit canvas do Konva embaralhado, `docs/debug-condicoes.md`), nunca inicia
  seleção nem arraste (um Alt+clique que tremesse a mão não deveria mover o token).
- **Regra de acerto no JSON** (`SystemDefinition.rolls`, nunca hardcoded): `attackAutoHit`/
  `attackAutoMiss` (só `{natural}`, o resultado natural do d20 — T20: 20 e 1 natural acertam/erram
  sempre) avaliadas ANTES de `attackHit` (compara `{total}` com `{target.<caminho>}`, um stat do
  ALVO — T20: `"{total} >= {target.derived.defense}"`); cada fórmula é uma comparação com
  EXATAMENTE um operador (`==`, `>=`, `<=`, `>`, `<`). Ausente = o card lista os alvos sem
  "Acertou/Errou". `rules/targets.ts` (`parseHitRule`/`evaluateHitRule`) faz a conta; o servidor
  calcula `roll.natural` (resultado natural do d20) e `roll.targets[]` (`{ tokenId, name, hit,
  targetValue?, reason }`) na hora da rolagem — congelado no card, não recalcula se a Defesa do
  alvo mudar depois. Ações de **ataque** constroem `roll.targets[]` com acerto/erro calculado; uma
  ação de **dano** avulsa (sem ataque junto) também congela a lista, mas com `hit: null` em todas
  (sem total de ataque pra comparar contra nada) — só pro "Aplicar" do card saber quem foi mirado,
  mesmo que o Mestre (que abre o seletor) não compartilhe os alvos AO VIVO de quem rolou. "Rolar
  dano junto com o ataque" (§9.13) é o único caso com as duas coisas ao mesmo tempo: aí o acerto é
  avaliado de verdade, contra o total do ataque.
- **Quem vê o quê** (mesmo mecanismo de `ChatMessage.tokenId`/card de iniciativa em lote, §3.4/§3.5):
  linha de alvo cujo token o jogador não vê (oculto, névoa, ou mapa que não é o ativo da sala) some
  da cópia dele — nem card, nem placeholder, só aquela linha; o GM sempre vê todas. `targetValue` (o
  número da Defesa) só vai a quem é GM ou dono do token alvo; os demais veem só "Acertou"/"Errou"
  (`ChatTab`: "Acertou **Goblin 2** (18 vs Defesa 15)" pra quem vê o número, "Acertou **Goblin 2**"
  pra quem não vê, "Acertou **Goblin 2** (20 natural)"/"Errou (1 natural)" quando foi
  `attackAutoHit`/`Miss`, "→ **Goblin 2**" sem regra de acerto). Como o resultado muda por pessoa,
  uma rolagem COM alvos é enviada como uma cópia por participante (generaliza o mecanismo do card de
  iniciativa em lote); o snapshot reaplica a mesma regra no histórico.
- **"Aplicar" pré-selecionado** (§3.3): o seletor de dano/cura já abre com os alvos do CARD (ataque
  ou dano, se tinha) ou, sem eles, com os alvos AO VIVO de quem clicou — só na primeira abertura
  (reabrir depois não sobrescreve ajustes já feitos), passando pelo mesmo `toggle` de sempre (a
  sugestão por `damageResponses` vem de brinde). Rolagem combinada (§9.13) é a exceção: pré-seleciona
  só quem foi ACERTADO (`hit !== false`, então também os sem regra de acerto) e, sem alvo nenhum no
  card, abre vazio — nunca cai para os alvos AO VIVO de quem clicou (o card já é um retrato de um
  ataque específico; alvos avulsos de agora não têm nada a ver com ele). Confirmar continua manual.
- **Gabarito de área vira alvos** (§9.9): enquanto o gabarito que EU coloquei existir, os tokens
  dentro dele (`targetsFromTemplate`, mesma regra de `tokensInTemplate`: centro da célula decide,
  token grande conta se qualquer célula estiver dentro) substituem a seleção manual, recalculando ao
  mover/girar o gabarito ou tokens entrarem/saírem; apagar o gabarito limpa os alvos (não restaura a
  seleção manual de antes). Gabaritos de outros participantes não mexem nos meus alvos.
- **Visual** (`VttCanvas`/`TokenNode`): meu alvo — anel pontilhado vermelho (raio maior que o do
  turno/seleção, pra não confundir) + marcador de mira no canto; alvo de outro participante — selo
  discreto no canto oposto (dourado, inicial do nome ou contagem), só com a opção "Mostrar alvos dos
  outros" ligada (por usuário, `localStorage`, desligada por padrão). `CombatPanel`: ícone de mira na
  linha do combatente (vermelho = meu; dourado = de outro), e os dois checkboxes ("Mostrar alvos dos
  outros"/"Limpar meus alvos ao fim do meu turno") ao lado de "Centralizar no token da vez".
- **Limpar ao fim do turno** (opção por usuário, desligada por padrão): quando `combat:updated` troca
  quem está agindo e o combatente que ESTAVA agindo era meu (token com `ownerId` = eu; pro GM,
  combatente sem dono), limpa meus alvos — só no cliente (`RoomPage`), não é regra do servidor.

### 9.13 Rolar dano junto com o ataque

Preferência por usuário (`localStorage`, ligada por padrão, botão "Dano junto" na faixa "ROLAR:" do
chat): o botão de uma ação de **ataque** cujo item também tem uma ação de **dano** rola as duas numa
mensagem só — ataque em cima (acerto/erro por alvo, como sempre), dano embaixo (parcelas por tipo,
igual a uma ação de dano avulsa), e "Aplicar" pré-selecionando só quem foi acertado. Ação de dano
avulsa continua existindo (pra rolar só o dano, sem combinar nada).

- **Onde decide** (`store/characters.ts#roll`, `withCombinedDamage`): só a STORE olha a preferência
  e o item da ficha — nenhum componente que dispara rolagem (ficha, card do chat, NpcQuickCard,
  ataque rápido do mapa) precisa saber disso. Pede pro servidor `roll: { type:"action", itemId,
  actionId, combineDamageActionId }` (id da ação de dano IRMÃ, mesmo item) quando: a preferência está
  ligada; a ação clicada é `attack`; e o item tem alguma ação `damage` (a primeira encontrada). Fora
  disso, `combineDamageActionId` fica de fora e a rolagem sai como sempre (só ataque, ou só dano).
- **No servidor** (`rules/rolls.ts#buildCharacterRoll` monta as duas fórmulas sem rolar nada, ainda
  puro; `services/rolls.ts#createRollMessage` rola de verdade): o d20 do ataque vira `roll.total`/
  `groups`/`natural`/`targets[]` de sempre; o dano rola em separado e vai só em `roll.damage[]` —
  nunca soma no `roll.total` (esse continua sendo o ataque). Sem alvo marcado, ataque e dano saem do
  mesmo jeito, só sem a lista de alvos (nem acerto/erro, nem pré-seleção nenhuma no "Aplicar").
- **Crítico confirmado** (`rolls.critical?` do sistema, mesma gramática de `attackAutoHit`, só
  `{natural}`): o natural do d20 caindo na margem de crítico da ação (`critRange`, ex.: 19-20) é só
  uma AMEAÇA; role dano dobrado (`critMult`) só se `rolls.critical` existir e confirmar. Sem essa
  regra no JSON, o card marca "Possível crítico — confirme e ajuste o dano à mão" e o dano sai
  normal, sem multiplicar nada (Mestre decide). T20 não pede confirmação nenhuma (ameaçou, é
  crítico), daí `"critical": "{natural} >= 1"` (sempre verdadeiro) no JSON dele — outro sistema pode
  exigir uma comparação de verdade, ou não declarar a regra e deixar sempre "possível". Confirmado,
  `multiplyFormulaDice` (`dice/parser.ts`) dobra só os DADOS de cada parcela de dano (`1d8 + 3` ×2 =
  `2d8 + 3`, nunca `2d8 + 6` — atributo/bônus fixo não multiplica) antes de rolar; o card sinaliza
  com `roll.criticalConfirmed: true` e o dano já vem com os dados extras.
- **"Aplicar" no card combinado** (§3.3/§9.12): pré-seleciona só os alvos com `hit !== false` (os
  acertados, e os sem regra de acerto — não há como saber); os errados aparecem na lista, mas
  desmarcados. Sem alvo nenhum no card, abre vazio (não cai para os alvos AO VIVO de quem clicou,
  ao contrário do card de dano avulso — ver §9.12).
- **Fora do escopo**: confirmação de crítico com um segundo dado (o roteiro é sempre "ameaçou →
  `rolls.critical` decide na hora, com o que já foi rolado"); multiplicar só parte do dano (por
  tipo); desfazer/reverter um crítico confirmado por engano — o Mestre ajusta o valor à mão no
  seletor de "Aplicar", como em qualquer outro ajuste manual de dano.

### 9.14 Encontros salvos

Grupo de criaturas do compêndio (ou homebrew da sala) que o GM monta uma vez e solta no mapa de uma
vez (setembro/2026). Mesmo princípio de §9.5: guarda só a "receita", nunca cópias de ficha —
resolvida contra o compêndio ATUAL na hora de soltar, então editar/apagar uma entrada do compêndio
depois de salvar um encontro não quebra nada (a entrada some da soltura seguinte, avisado, não
falha).

- **Modelo**: `SavedEncounter` (§4) = `{ id, roomId, name, tags[], notes, entries[], deletedAt? }`.
  `entries: SavedEncounterEntry[] = { entryId, count (1..20), visibleOnSpawn, nameOverride? }`
  (`packages/shared/src/schemas/encounter.ts`) — sem posição: o posicionamento é decidido na hora de
  soltar, igual a `compendium:spawn-creature`. Biblioteca por sala, só o GM vê (mesmo padrão de
  `Handout`/§9.10: `encounter:list` é `gmOnly`, soft delete em `encounter:delete`).
- **Origem de compêndio de um NPC**: `Character.compendiumEntryId?` (§4, coluna só do banco) —
  gravado por `compendium:spawn-creature` e por `encounter:spawn` ao criar o NPC. Metadado de app
  (não é regra de sistema, por isso não entra em `CharacterDataSchema`); serve só para "salvar
  tokens selecionados como encontro" reconstruir de qual criatura cada token veio.
- **Criar**: três caminhos, todos batem em `encounter:create` ou `encounter:create-from-tokens` (§5).
  Na paleta (modo mapa, GM), um botão "Montar encontro" no cabeçalho **liga um modo** (painel ganha
  borda destacada): cada linha de criatura na lista ganha um "+" que soma
  `{ entryId, count: quantidade do preview, visible: !invisível do preview }` a um **carrinho** só em
  memória (`store/encounters.ts#cart`, reseta ao trocar de sala — desligar o modo NÃO esvazia o
  carrinho, só "Cancelar" abaixo esvazia); ligado, o rodapé da paleta troca o preview pelo carrinho
  (`EncounterCartPanel`): uma linha por criatura (nome, quantidade editável, toggle invisível por
  linha, remover), ND total (mesmo `sumChallengeRating` do preview de encontro salvo) e três botões —
  "Salvar encontro" (abre o formulariozinho nome/tags/notas, chama `encounter:create`), "Dos
  selecionados" (mesmo formulário a partir da seleção de tokens do mapa — GM, ferramenta Selecionar
  — chama `encounter:create-from-tokens { tokenIds }`; o servidor agrupa por
  `Character.compendiumEntryId`, tokens sem ficha do compêndio são ignorados e contados em
  `ignoredTokens` no ack, nunca derrubam a criação do resto) e "Cancelar" (esvazia o carrinho e
  desliga o modo). **Duplicar** reaproveita `encounter:create` no cliente (mesmos dados, nome +
  " (cópia)") — sem evento próprio.
- **Paleta**: no contexto "map"/GM, chips "Criaturas" e "Encontros" (`ENCOUNTER_FILTER`, mesmo truque
  de chip virtual de `CREATURE_FILTER`/`ROOM_FILTER`, §9.5) ficam sempre à mostra; os `itemKinds[]`
  do sistema e "Sala" entram atrás de um chip "todos ▾" (clique expande/recolhe — não muda nenhum
  filtro já ativo, só a visibilidade dos chips). Busca por nome/tags. `EncounterPreview.tsx`: lista
  as entradas (nome × quantidade, "sumiu do compêndio" em vermelho se a entrada não existe mais), ND
  somado só informativo (`sumChallengeRating`, best-effort: soma inteiros e frações simples como
  "1/4"/"1/2" do `traits[ndField]` de cada entrada resolvida; entradas com ND fora desse formato
  ficam de fora da soma, contadas à parte — nunca inventa um total), notas, e (se `onSpawnEncounter`)
  os checkboxes "Iniciar combate com eles"/"Rolar iniciativa dos NPCs" + botão Soltar. Editar
  (`encounter:update`) troca o preview por um formulário — só nome/tags/notas; mudar a composição
  (`entries`) é salvar de novo a partir do carrinho ou da seleção.
- **Soltar**: `encounter:spawn { id, sceneId, x, y }` (§5) — o cliente manda só o ponto, como
  `compendium:spawn-creature`. `expandEncounterEntries` (`packages/shared/src/rules/encounter.ts`,
  testada) resolve cada `SavedEncounterEntry` contra o compêndio mesclado e roda `findFreeCells`/
  `numberedNames` (§9.5) **em sequência**, com `occupied`/nomes já usados acumulando de uma entrada
  pra próxima — assim a segunda espécie do encontro já pula as células/nomes que a primeira usou, e
  a espiral inteira parte do MESMO ponto clicado. Entrada cujo `entryId` sumiu do compêndio (ou
  deixou de ser `type: "creature"`) entra em `missingIds`/`skippedEntryIds`: o resto solta normal, o
  ack avisa quais faltaram. Servidor roda **uma** `prisma.$transaction` para todas as cópias de todas
  as criaturas do encontro; histórico entra como **uma** entrada ("soltar encontro X",
  `buildMultiSpawnHistoryEntry` em `socket/spawnHistory.ts`, extraído de `compendium:spawn-creature`
  e reaproveitado pelos dois — hard delete no desfazer, mesma regra de §9.6).
- **Combate ao soltar**: "iniciar combate com eles"/"rolar iniciativa dos NPCs" não são um passo
  novo no servidor — o CLIENTE encadeia, depois do ack de `encounter:spawn`, os eventos que já
  existem: `combat:add` (ou `combat:start` se o mapa não tem combate) com os tokens criados, e
  `combat:roll { scope: "npcs" }` se pedido (`store/encounters.ts#spawn`). Fica fora da
  transação/entrada de undo do spawn, mesma regra de sempre (§9.5/§9.6: soltura nunca entra sozinha
  no combate) — só que aqui o GM pediu explicitamente com o checkbox. Falha nesse passo não desfaz o
  spawn: os botões normais do painel de combate terminam à mão. Com a opção da sala "Rolar
  iniciativa dos NPCs ao iniciar o combate" ligada (§3.5, padrão), o `combat:add`/`combat:start`
  encadeado acima já rola os NPCs sozinho — o `combat:roll` extra deste checkbox então não encontra
  mais ninguém sem iniciativa (`scope: "npcs"` filtra só quem falta) e não faz nada; o checkbox só
  importa de verdade com a opção da sala desligada.
- **Simplificações deliberadas**: o fantasma de arrasto de um encontro (`EncounterDragGhost`,
  `components/compendium/DragGhost.tsx`) é um rótulo simples (nome + "N criaturas"), não a espiral
  exata multi-espécie — duplicar `expandEncounterEntries` no cliente só para o preview visual não
  valia a complexidade; o servidor calcula a posição real de cada cópia ao soltar, como sempre.

### 9.15 Visão de grupo

Faixa compacta com os personagens de jogador "de relance" (setembro/2026), `components/PartyView.tsx`.
O chip é por **ficha** (`kind: "pc"`), não por token: um personagem só sai da faixa se a ficha for
apagada ou removida do grupo — perder/trocar de token não tira ninguém dali. O grupo em si (quem
está na faixa, em que ordem, quem está oculto) é gerenciado pelo Mestre e persistido no servidor.

- **Modelo**: `Room.party: PartyEntry[] = { characterId, hidden }[]` (§4, coluna `Json`, mesmo
  raciocínio de `Scene.grid`/`fog` — lista pequena, sempre reescrita inteira, sem tabela própria). A
  ORDEM do array é a ordem de exibição — sem coluna `order`, é sempre a lista completa da sala.
  `packages/shared/src/rules/party.ts` (testado): `addToParty`/`removeFromParty`/`setPartyHidden`
  (idempotentes) e `reorderParty` (mesma régua de `reorderScenes`: `requestedIds` precisa ser uma
  permutação exata do grupo atual).
- **Eventos** (`party:add|remove|set-hidden|reorder`, todos `gmOnly`, §5): o ack devolve a visão do
  GM (grupo inteiro, ocultas inclusive — quem chama estes eventos só pode ser o GM); quem atualiza
  os clientes de verdade é o broadcast `party:updated { party }`, com uma lista DIFERENTE por papel
  (`services/party.ts#partyFor`, testado): GM recebe toda entrada cujo personagem ainda é PC nesta
  sala (ocultas inclusive — a UI dele esmaece); jogador só as não ocultas. Uma entrada cujo
  personagem foi apagado, ou deixou de ser PC (`character:update` virando `kind: "npc"`), some pra
  TODOS, GM inclusive — deixou de ser "o grupo". `RoomSnapshot.party` (§5) manda a mesma lista já
  filtrada no `room:join`.
- **Entra/sai sozinho**: `character:create` de um PC novo já entra no fim do grupo
  (`addToParty`); `character:delete` e `character:update` que vira `kind: "npc"` tiram a entrada
  (`services/party.ts#pruneFromParty`). Sala criada antes desta feature começa com `party: []` — os
  PCs que já existiam não entram sozinhos, o Mestre usa "+ Adicionar ao grupo" (abaixo) pra trazê-los.
- **Onde**: dentro do `<aside>` do `SidePanel`, acima da navegação de abas — visível não importa
  qual aba (Chat/Iniciativa/Fichas) esteja aberta, e some junto com o painel lateral recolhido
  (`\` ou Ctrl+B) por estar dentro dele; não duplica outra faixa fixa fora do painel.
- **Conteúdo por chip**: avatar (`Character.imageUrl` ou inicial do nome) com o anel na cor do token
  vinculado no mapa que este cliente está vendo (cinza sem token aqui — ficha ainda não entrou nesse
  mapa, ou o token está oculto/na névoa: só a cor/condições/turno somem, o chip continua); nome;
  barra PRINCIPAL do recurso de `SystemDefinition.tokenBar` (PV em T20, com temporário no texto
  "12/20 +3", número escrito na própria barra) cheia/dourada/vermelha pela régua de % — SEMPRE essa
  régua, mesmo se o recurso tiver `color` configurada (ver abaixo): é "vida", a cor precisa reagir ao
  nível — mesma convenção da barra do token no mapa (`VttCanvas`: >50% verde, >25% dourado, senão
  vermelho); os demais `resources[]` do sistema (PM em T20) como uma barra SECUNDÁRIA fina (4px, sem
  número — não cabe; hover/`title` mostra o texto exato, "PM 6/9") na cor de `resources[].color` do
  JSON do sistema quando definida (PM é azul, `#378ADD` em T20 — não é "vida", ficar baixo nele não é
  a mesma urgência, a régua vermelha assustaria à toa), senão cai na mesma régua por % da principal;
  só aparece se o máximo daquele recurso for > 0 (nenhuma chave de recurso é hardcoded: um sistema
  com outro `tokenBar`/outros `resources[]`/outra `color` muda a faixa sozinho, e um recurso ainda
  não definido não polui o chip com "0/0"); a mesma `resources[].color` também tinge o selo do
  recurso secundário na ficha rápida de NPC (`NpcQuickCard`, §3.3) — sem cor configurada, ambos
  caem no visual de sempre (ciano); até 3 ícones de condição do token (`+N` se houver mais) com tooltip; um
  ponto dourado pulsante no avatar quando é a vez dele (combate do mapa que este cliente está
  vendo). Clique abre a ficha; todo número já aparece no chip, sem precisar de hover (só o `title`
  do elemento repete o texto, pro hover confirmar o valor exato).
- **Token usado por um chip**: o primeiro token do mapa visto com `characterId` = a ficha, dentre os
  tokens que este cliente já recebe (mesma lista filtrada por visibilidade/névoa do canvas).
- **Visibilidade**: NPC nunca entra aqui (já existe a ficha rápida do Mestre, §3.3, e o servidor tira
  qualquer entrada cujo personagem não é PC — ver acima); todo PC do grupo (não oculto) entra para
  GM e jogadores igualmente, números de PV/PM incluídos — é assim na mesa, ninguém esconde a vida dos
  próprios personagens uns dos outros.
- **Gerenciamento do grupo (Mestre)**: botão "⋯" em cada chip abre um menu (portal em
  `document.body`, `position: fixed` — a faixa rola horizontalmente, um menu `absolute` normal seria
  cortado nela, mesmo problema/solução do menu do painel "Mapas") com "Ocultar do grupo"/"Mostrar" e
  "Remover do grupo"; oculto pro Mestre aparece esmaecido (opacidade) com um ícone de olho riscado,
  mas continua com PV/PM/arrastável normalmente — só some da cópia que os jogadores recebem. Botão
  "+ Adicionar ao grupo" no fim da faixa (dashed, só aparece havendo candidato) abre a mesma espécie
  de menu listando os PCs da sala que ainda não estão no grupo. Arrastar um chip solta uma nova ordem
  completa (`party:reorder`); mesmo padrão de drag-and-drop do `CombatPanel` (sem otimismo — o
  broadcast `party:updated`, que chega pro autor também, é quem aplica de verdade, como
  `combat:reorder`).
- **Preferência por usuário** (`localStorage`, padrão ligada, independente de recolher o painel
  inteiro): um chevron no cabeçalho "Grupo" alterna só esta faixa entre expandida (chips) e
  recolhida (só o cabeçalho, pra reabrir rápido) — some só pra quem desligou, o grupo em si (§ acima)
  não muda pra ninguém.

### 9.16 Notas do Mestre

Um bloco de texto (markdown leve, sem parser — texto puro, mesmo padrão de Handout de texto) que só
o GM escreve e só o GM vê, por mapa e por token, com busca simples na sala inteira (setembro/2026).
Plano e decisões em `docs/plano-narracao.md`; revisão pós-implementação em `docs/revisao-narracao.md`.

- **Modelo**: `Scene.gmNotes` e `Token.notes` (§4) — colunas de texto simples, `null`/vazio = sem
  nota. Nenhum dos dois é regra de sistema (não entra no `SystemDefinitionSchema`) — é dado de app,
  como `Scene.name`. **O texto nunca sai serializado** em `Scene`/`Token` (só `hasNotes: boolean`,
  calculado em `toScene`/`toToken`): assim nenhum caminho futuro de serialização do Token/Scene pode
  vazar a nota pra quem não devia — o campo simplesmente não existe no objeto que viaja. `Token.
  hasNotes` é redigido pra jogador mesmo quando `true` (`redactTokenForViewer`,
  `apps/server/src/services/visibility.ts`, aplicado em todo broadcast/snapshot de token): o
  indicador no token é "só o GM vê" mesmo pro dono do próprio token — a nota é do Mestre sobre o
  personagem, não do personagem. `Scene.hasNotes`, por outro lado, viaja sem redação nenhuma (um
  mapa já é uma entidade compartilhada de sempre, sem broadcast assimétrico por papel hoje) —
  assimetria deliberada, registrada em `docs/revisao-narracao.md`.
- **Eventos** (`scene:set-notes`/`scene:get-notes`/`token:set-notes`/`token:get-notes`, todos
  `gmOnly`): o texto de verdade só entra/sai por eles — nunca em `token:update`/`scene:updateGrid`
  etc. `set-notes` com string vazia (ou só espaço) volta `hasNotes` pra `false`. Um token soft-
  deletado (`Token.deletedAt`, §9.6) é "não encontrado" pra `token:get-notes`/`set-notes`, mesma
  regra de qualquer handler normal — mas a nota em si **sobrevive** ao soft delete/desfazer (a
  coluna não é tocada por `token:delete`): apagar e desfazer um token não perde a nota dele.
- **Busca** (`notes:search { query }`, `gmOnly`): `contains` case-insensitive nas notas de mapa E de
  token da sala inteira, devolvendo `{ kind, sceneId, tokenId?, name, snippet }[]` (recorte de ~80
  chars ao redor do match, `buildNoteSnippet`). Mapa apagado, ou token apagado/de um mapa apagado,
  nunca aparece (mesmo filtro `deletedAt: null` de sempre, dos dois lados).
- **UI**: botão "Notas" na TopBar (só GM, só com um mapa sendo visto) abre o mesmo painel
  (`NotesPanel`) que o item "Notas do mapa" no menu ⋯ de cada card do painel "Mapas" (§9.7) — este
  último funciona pra qualquer mapa, sem precisar estar vendo ele. `TokenInspector` e a ficha rápida
  de NPC (`NpcQuickCard`, §3.3) ganham um botão "Notas" (com indicador se já há alguma) que abre o
  mesmo painel pro token. O painel: textarea (salva ao sair do campo) + campo de busca no topo;
  clicar num resultado troca o alvo mostrado no MESMO painel (mapa ou token) e, se for um mapa
  diferente do que o GM está vendo, navega pra ele (`scene:enter`) — sem fechar/reabrir o painel.
  Indicador no canvas: um ponto discreto no canto do token quando `hasNotes` (nunca aparece pro
  jogador, pela redação do servidor acima — o cliente nem checa `role`, o dado já chega `false`).
