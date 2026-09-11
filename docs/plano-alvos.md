# Plano: Sistema de alvos (targets), estilo Foundry

> Escrito em 10/09/2026, antes de qualquer código. **Aguardando aprovação do dono do projeto.**
> Vira **§9.12** do SPEC.

Escopo: cada usuário marca tokens como **seus alvos** (efêmero, em memória, sincronizado por socket);
rolagens de ataque/dano da ficha levam os alvos para o card do chat; ataque calcula acerto/erro pela
regra do JSON do sistema; "Aplicar" já abre com os alvos marcados; gabarito de área vira a lista de
alvos de quem o colocou. **Fora deste plano**: aplicar dano sozinho (confirmação continua manual),
rolar o dano automaticamente ao acertar, alvo em `/r` solto, checagem de alcance/linha de visão,
acerto automático em 20 natural/erro em 1 natural (ver pergunta Q3).

## Perguntas antes de começar (o resto do plano assume a resposta recomendada)

- **Q1 — Quem vê os alvos dos outros?** O pedido tem duas frases que puxam para lados diferentes
  ("sincronizados para os outros verem 'alvo de Kael'" e "anel só para quem marcou, e o GM se
  optar"). **Recomendo:** os meus alvos eu sempre vejo (anel pontilhado + marcador). Os dos outros
  aparecem como um selinho discreto com o nome ("alvo de Kael") só se o usuário ligar a opção
  "Mostrar alvos dos outros" (checkbox por usuário, `localStorage`, **desligada por padrão** para
  todos). Os alvos do **GM nunca vão para jogadores** — mirar num token é informação de mestre.
- **Q2 — Apagar o gabarito devolve os alvos manuais de antes?** **Recomendo não**: o pedido diz que a
  área *substitui* a seleção manual, então apagar o gabarito só limpa os alvos. Restaurar exigiria
  guardar a lista anterior e surpreenderia quem já mudou de ideia no meio.
- **Q3 — 20 natural acerta sempre / 1 natural erra sempre?** Não coloco isso no código sem você
  confirmar a regra de T20. A regra do JSON desta rodada é **uma comparação só**
  (`{total} >= {target.derived.defense}`). Se a regra existir, entra depois como um campo extra no
  JSON (ex.: `rolls.attackAutoHit`/`attackAutoMiss` com `{natural}`), sem mudar o resto do desenho.

## Decisões

- **Alvos são por usuário e efêmeros**: guardados em memória no servidor (`Map`, mesmo padrão de
  `services/templates.ts`/`presence.ts`), nunca no banco. Sobrevivem a F5 (vêm no `RoomSnapshot`),
  não a um restart do servidor. *Por quê:* é estado de "mão", como a régua; não vale uma migration.
- **Servidor é a fonte da verdade** (regra do projeto): o cliente aplica local (otimista), emite
  `target:set` com ack, o servidor filtra (jogador só mira token que **vê**, só no mapa ativo) e
  devolve a lista aceita; ack `ok:false` reverte.
- **A rolagem manda a lista de alvos explicitamente** (`character:roll { …, targetTokenIds }`), em vez
  de o servidor ler a memória de alvos. *Por quê:* fica claro no payload o que foi usado naquela
  rolagem, é testável sem estado escondido, e o servidor revalida cada id do mesmo jeito que em
  `target:set` (existe, não apagado, jogador vê). Ids inválidos são descartados em silêncio (o token
  pode ter sumido um instante antes).
- **Acerto é calculado no servidor, na hora da rolagem, e gravado no card** (`roll.targets[]`). O
  servidor é o único que conhece a ficha NPC (jogador nem recebe ficha `npc`), então só ele sabe a
  Defesa do Goblin. O resultado fica congelado no card (mudar a Defesa depois não reescreve o chat).
- **Regra de acerto no JSON, não no código** (regra número 1): `rolls.attackHit` opcional. Ausente =
  o card só lista os alvos, sem "Acertou/Errou". Placeholders novos: `{total}` (total da rolagem) e
  `{target.<caminho>}` (qualquer caminho global da ficha, lido da ficha **do alvo**:
  `target.derived.defense`, `target.attr.des`, `target.resource.pv.max`…).
- **Número da Defesa por quem vê** (pedido): GM sempre vê "18 vs Defesa 15"; jogador vê
  "Acertou/Errou" sem o número, a não ser que o token alvo seja dele. Como isso muda por pessoa, o
  card com alvos passa a ser enviado **uma cópia por participante** — o mesmo mecanismo que o card de
  iniciativa em lote já usa (`initiativeBatchForViewer`, §3.5). Linha de alvo cujo token o jogador não
  vê (oculto/névoa/outro mapa) some da cópia dele, igual à linha de iniciativa.
- **Interação por geometria**, não pelo hit canvas do Konva (mesmo motivo de sempre,
  `docs/debug-condicoes.md`): Alt+clique e a tecla Y usam `tokenAtPointer()`.
- **Quais rolagens levam alvos**: só `character:roll { type: "action" }` cujo resultado é ataque
  (`action.kind === "attack"`) ou dano (tem `damage[]`). Teste de perícia/atributo e `/r` não.

## 1. `packages/shared`

### 1.1 Schema do sistema (`schemas/system.ts`) + `tormenta20.json`
- `rolls.attackHit?: FormulaSchema` — "condição": exatamente **um** operador `>=`, `<=`, `>`, `<` ou
  `==`, com uma expressão sem dado de cada lado.
- `tormenta20.json`: `"attackHit": "{total} >= {target.derived.defense}"`.
- `validateSystemDefinition`: confere que há exatamente um operador e que os placeholders existem —
  `{total}` é contextual; `{target.X}` passa pela mesma checagem dos globais, mas contra a lista
  **completa** de `derived[]` (não só os declarados antes). Erro de JSON diz o que corrigir, como hoje.

### 1.2 Card (`schemas/dice.ts`)
`DiceRoll.targets: z.array(RollTargetSchema).default([])` — `.default([])` faz as rolagens antigas do
banco continuarem válidas sem migration (o `roll` já é coluna `Json`).
```ts
RollTargetSchema = z.object({
  tokenId: IdSchema,
  name: z.string().max(64),          // nome no momento da rolagem (sobrevive a renomear/apagar)
  hit: z.boolean().nullable(),       // null = sem regra, alvo sem ficha, ou fórmula sem valor
  targetValue: z.number().int().optional(), // ex.: a Defesa; o servidor tira da cópia de quem não pode ver
})
```

### 1.3 Payloads (`schemas/payloads.ts`) e eventos (`events.ts`)
- `CharacterRollSchema` ganha `targetTokenIds: z.array(IdSchema).max(50).default([])`.
- `TargetSetSchema = { sceneId, tokenIds: IdSchema[] (max 50) }`.
- Cliente → servidor: `"target:set": (p, ack: Ack<{ tokenIds: string[] }>)` (lista completa, não
  "adiciona/remove" — dois cliques rápidos não se atropelam, mesmo raciocínio do `fog:update`).
- Servidor → cliente: `"target:updated": { participantId, sceneId, tokenIds }`.
- `RoomSnapshot.targets: { participantId, sceneId, tokenIds }[]` (já filtrado para quem recebe).

### 1.4 Regras puras (`rules/targets.ts`, novo, com `targets.test.ts`)
- `parseHitRule(rule) → { left, op, right }` (lança se não houver exatamente um operador).
- `evaluateHitRule(rule, { total }, resolveTarget) → { hit, targetValue } | null` — substitui os
  placeholders (`substitutePlaceholders`), avalia cada lado com `evaluateConstant` e compara;
  `targetValue` = o lado que contém `{target.…}`. `null` quando o alvo não tem ficha ou algum
  placeholder não resolve (o card mostra só o nome).
- `hitRuleTargetLabel(def, rule)` → rótulo do primeiro `{target.derived|attr|resource…}` do lado do
  alvo (T20: "Defesa", do `derived[].label`); sem match, "alvo". O web usa pra montar "18 vs Defesa 15".
- `toggleTarget(current, tokenId, additive)` — Alt: vira o único alvo (ou limpa, se já era o único);
  Shift+Alt: entra/sai da lista.
- `targetsFromTemplate(tokens, template, cellSizePx)` — mesma regra de `tokensInTemplate` (centro da
  célula; token grande conta se qualquer célula estiver dentro), devolvida como lista em ordem
  estável (por nome), pronta pra ser a lista de alvos.
- `pruneTargets(targetIds, existingIds)` — tira ids que não existem mais.
- `BuiltRoll` (`rules/rolls.ts`) ganha `isAttack?: true` no case `"attack"`, pra o servidor saber
  quando aplicar `attackHit` sem olhar chave nenhuma do sistema.

## 2. `apps/server`

### 2.1 Estado dos alvos (`services/targets.ts`, novo)
`Map<roomId, Map<participantId, { sceneId, tokenIds }>>` + `setTargets`, `listTargets(roomId)`,
`removeTokenFromTargets(roomId, tokenId)`, `clearSceneTargets(roomId, sceneId, onlyPlayers?)`.
Não limpa no disconnect (senão F5 perderia os alvos); o cliente só desenha selinho de participante
com `connected = true`.

### 2.2 Handler `target:set` (`socket/targets.ts`, novo)
- Jogador: `requirePlayerOnActiveScene` (mesma checagem de `template:upsert`); cada token precisa ser
  da cena, não apagado e `tokenVisibleTo` o jogador — os outros ids são descartados e o ack devolve a
  lista aceita. GM: qualquer mapa vivo da sala.
- Broadcast `target:updated`: sempre para `rooms.gm` e para a sala do próprio autor (outras abas);
  se o autor é **jogador**, também para os outros jogadores, cada um recebendo só os ids de tokens
  que ele vê (uma cópia por jogador, poucos participantes). Alvos do GM nunca vão para jogadores (Q1).
- Limpeza no servidor: `token:delete`/`token:delete-many` tiram o id de todas as listas e emitem
  `target:updated` de quem mudou; `scene:activate` limpa as listas dos jogadores (eles mudaram de
  mapa); `scene:delete` limpa todas as do mapa apagado. Snapshot (`services/snapshot.ts`) inclui as
  listas filtradas para quem entra.

### 2.3 Rolagem com alvos (`socket/character.ts` + `services/rolls.ts`)
- `character:roll`: se `targetTokenIds` não vazio **e** (`built.isAttack` ou `built.damage`), carrega
  os tokens (mesma validação do 2.2), as fichas vinculadas e o `computeCharacter` de cada um.
- `createRollMessage` ganha `targets?: { tokenId, name, resolve? }[]` e `hitRule?: string`; depois de
  rolar (quando o total existe), monta `roll.targets[]` com `evaluateHitRule` (só quando
  `built.isAttack` e o sistema declara `rolls.attackHit`; dano grava os alvos com `hit: null`).

### 2.4 Envio por pessoa (`services/chatVisibility.ts`)
- `rollTargetsForViewer(msg, viewer, tokenInfo, activeSceneId)`: tira as linhas de tokens que o
  jogador não vê (mesma regra de linha do `initiativeBatchForViewer`) e remove `targetValue` quando o
  viewer não é GM nem dono do token alvo.
- `emitChatMessage`: mensagem `roll` com `roll.targets` não vazio segue o caminho "uma cópia por
  participante" (generalizando `emitInitiativeBatchMessage`): gate de token/sussurro → sem permissão
  de `visibility` recebe o placeholder de sempre (`redactMessage`) → senão, a cópia de
  `rollTargetsForViewer`. Isso cobre de graça o `chat:reveal` e o reenvio de `token:apply-damage`,
  que já passam por `emitChatMessage`. Snapshot e ack do autor (`redactForAuthor`) aplicam a mesma
  função.

## 3. `apps/web`

### 3.1 Store `store/targets.ts` (novo domínio, regra "uma store por domínio")
`mine: string[]`, `source: { kind: "manual" } | { kind: "template", templateId }`, `others:
Record<participantId, { sceneId, tokenIds }>`, `showOthers` e `clearOnTurnEnd` (`localStorage`, com
try/catch). Ações `toggle(tokenId, additive)`, `clear()`, `setFromTemplate(templateId, ids)`,
`prune(existingIds)`, `applyRemote(p)`; `toggle`/`clear`/`setFromTemplate` são otimistas com ack e
reversão (componentes não chamam `socket.emit`). `bindSocket.ts` liga `target:updated`; o snapshot e
o `scene:enter` populam.

### 3.2 Marcar no canvas (`VttCanvas.tsx`, ferramenta Selecionar)
- **Alt+clique** num token → `toggle(id, false)`; **Shift+Alt+clique** → `toggle(id, true)`;
  **Alt+clique no mapa vazio** → `clear()` (a seleção normal não muda). No `mousedown` com Alt o token
  **não** começa arraste nem entra na seleção (senão um Alt+clique com 2 px de tremida moveria o token).
- **Tecla Y** (Shift+Y adiciona) marca o token **sob o cursor** (`tokenAtPointer`, última posição
  conhecida do ponteiro); sem token sob o cursor não faz nada. Ignorada em campo de texto
  (`isTyping`), como os outros atalhos. `Y` sozinho não conflita (hoje só Ctrl+Y = refazer).
- Trocar de mapa (o que o usuário está vendo) chama `clear()`; `token:deleted` e tokens que deixam de
  ser visíveis passam por `prune` (e reemitem se a lista mudou).

### 3.3 Visual
- `TokenNode`: meus alvos → anel pontilhado vermelho-escuro (cor diferente do dourado do turno, pra
  não confundir) + um pequeno ícone de mira no canto superior direito; alvos dos outros (com
  `showOthers`) → selinho com a inicial/cor do participante e tooltip "alvo de Kael". Tudo
  `listening={false}`.
- `CombatPanel`: ícone de mira (`Crosshair`, lucide) na linha do combatente que é meu alvo (nas duas
  listas, com e sem iniciativa); com `showOthers`, tooltip com quem mais mira. Dois checkboxes novos
  ao lado de "centralizar no token da vez": "Mostrar alvos dos outros" e "Limpar meus alvos ao fim do
  meu turno".
- **Fim do turno**: quando `combat:updated` troca o `activeCombatantId` e o combatente que estava
  agindo era meu (token com `ownerId` = eu; para o GM, combatente sem dono), e a opção está ligada →
  `clear()`. Fica no cliente porque é preferência por usuário.

### 3.4 Card no chat (`ChatTab.tsx`)
Abaixo do total, uma linha por alvo: "✓ Acertou **Goblin 2** (18 vs Defesa 15)", "✗ Errou
**Goblin 2**" (sem o parêntese quando `targetValue` não veio), ou só "→ **Goblin 2**" quando
`hit === null`. Rótulo "Defesa" via `hitRuleTargetLabel`. Sem alvo: card igual ao de hoje.

### 3.5 "Aplicar" com alvos (`ApplyDamageButton.tsx`)
Novo prop `preselectTokenIds`: os `roll.targets` do card; se o card não tiver alvos, os meus alvos
atuais. Ao abrir, marca esses tokens (só os que já aparecem na lista daquela pessoa — jogador continua
vendo só os próprios) passando pelo mesmo `toggle` de hoje, então o multiplicador sugerido pela
`damageResponses` continua vindo junto. "Confirmar" continua manual.

### 3.6 Gabarito de área → alvos
Quando **eu** coloco um gabarito (`handleTemplateCreate` em `RoomPage.tsx`, GM e jogador), meus alvos
viram `targetsFromTemplate(tokens visíveis, gabarito)` com `source = template`. Enquanto esse
gabarito existir, um efeito recalcula quando ele é movido/girado ou quando tokens entram/saem dele
(só reemite se a lista mudar). Apagar o gabarito limpa os alvos (Q2); um Alt+clique manual encerra o
modo área (`source` volta a `manual`). Gabaritos dos outros não mexem nos meus alvos.

### 3.7 Rolagem
`store/characters.ts#roll`: em `type: "action"`, manda `targetTokenIds: useTargets.getState().mine`.
Cobre a ficha, a ficha rápida do NPC e os botões de ação do card de item (todos passam por aqui).

## 4. Testes

- **shared** `rules/targets.test.ts`: `parseHitRule` (cada operador; zero ou dois operadores = erro);
  `evaluateHitRule` (acerta, erra, empate com `>=` acerta, valor negativo, alvo sem ficha → `null`,
  placeholder que não resolve → `null`); `hitRuleTargetLabel` ("Defesa" em T20, "alvo" sem match);
  `toggleTarget` (Alt troca, Alt no único alvo limpa, Shift+Alt entra/sai); `targetsFromTemplate`
  (círculo pega token de dentro, ignora o de fora, token 2×2 com uma célula dentro conta, ordem
  estável); `pruneTargets`.
- **shared** `systems.test.ts` continua validando `tormenta20.json` (agora com `attackHit`); casos
  novos de `validateSystemDefinition` recusando `attackHit` com placeholder inexistente e com dois
  operadores.
- **server** `chatVisibility.test.ts`: `rollTargetsForViewer` — GM vê `targetValue`; dono do token
  alvo vê; outro jogador vê `hit` sem `targetValue`; linha de token oculto some da cópia do jogador.

## 5. Commits (direto na `main`)

1. **shared**: schema (`attackHit`, `RollTarget`, payloads, eventos), `rules/targets.ts` + testes,
   `tormenta20.json`.
2. **server**: `services/targets.ts` + `target:set` + limpeza (token/mapa) + snapshot.
3. **server**: rolagem com alvos + envio por pessoa (`chatVisibility.ts`) + testes.
4. **web**: store, Alt/Y no canvas, anel/marcador, painel de combate, limpar no fim do turno.
5. **web**: linhas de alvo no card, "Aplicar" pré-selecionado, gabarito → alvos.

O SPEC é atualizado no mesmo commit que muda cada comportamento: §9.12 novo (alvos), §5 (eventos
`target:set`/`target:updated`, `targetTokenIds` em `character:roll`), §4 (`DiceRoll.targets`,
`rolls.attackHit` na linha do `SystemDefinition`), §3.3 ("Aplicar" pré-selecionado), §3.4 (linhas de
alvo no card), §9.9 (gabarito vira alvos) e §8 (limitações: alvos se perdem num restart; sem
alcance/linha de visão).

## 6. Riscos

- **Alt no navegador**: no Windows (Edge/Chrome) soltar o Alt sozinho pode focar o menu do
  navegador, e alguns gerenciadores de janela do Linux usam Alt+arrastar. Mitigação: `preventDefault`
  no Alt dentro do canvas e a tecla Y como alternativa. Testar manualmente no Edge do Windows.
- **Envio por pessoa**: todo card com alvos vira N emits (um por participante) em vez de 1–2. Com
  mesas de 4–6 pessoas é irrelevante; é o mesmo custo que o card de iniciativa em lote já tem.

## 7. Verificação

- `make typecheck && make test`.
- Manual com `make dev` + `make seed-test` (GM e dois jogadores): Alt+clique/Shift+Alt/Alt no vazio e
  Y; jogador não consegue mirar token na névoa; ataque com 1 e com 2 alvos mostra "Acertou/Errou" —
  GM com o número, jogador sem, dono do alvo com; ataque sem alvo igual a hoje; rolagem secreta de
  jogador com alvo continua às cegas; "Aplicar" do card de dano abre com os alvos marcados e a
  sugestão de resistência; gabarito colocado vira alvos, mover o gabarito atualiza, apagar limpa;
  apagar token/trocar de mapa limpa; "limpar ao fim do turno" funciona; F5 mantém os alvos.
