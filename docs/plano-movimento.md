# Plano: movimento por teclado e orçamento de deslocamento

Escopo: (1) mover o token selecionado com setas/WASD, com snap ao grid; (2) orçamento de
deslocamento por turno com combate ativo — caminho percorrido desenhado no mapa, gasto acumulado,
bloqueio ao ultrapassar, override do GM; (3) barra fina de movimento restante no painel de combate.
**Fora deste plano**: condições que alteram deslocamento (Lento, Imóvel…) — o cálculo já sai numa
função pura que recebe modificadores, mas nada as gera ainda; terreno difícil; caminho com desvio
(a medição é sempre em linha reta entre os pontos do caminho, como a régua). Vira **§9.11** do SPEC.

---

## Decisões (confirmar antes de implementar)

**D1 — `movement.diagonals` e `unit` não se repetem no JSON.** O pedido descreve
`movement: { derived, diagonal: <regra já usada pela régua>, unit: "m" }`. A regra de diagonais e a
unidade já existem em `SystemDefinition.grid` (`diagonals: "alternating"`, `unit: "m"`,
`cellSize: 1.5`) e são o que a régua usa. Duplicar convida a divergir. Então o bloco novo fica:
`movement: { derived, default, diagonals? }` — `diagonals` **opcional**, ausente = `grid.diagonals`
(existe só para o caso de uma mesa querer que combate e régua contem diferente); a unidade sempre
vem de `grid.unit`. Se você preferir os três campos explícitos, é uma linha no schema.

**D2 — o orçamento é medido do "âncora", não do `dragFrom` do cliente.** O servidor guarda, por
combatente, a posição de onde o movimento atual é medido (`movementAnchor`: onde o token estava no
início do turno, ou no fim do último movimento confirmado). Todo `token:update` (inclusive os ecos
`live` do arraste, ~30/s) é validado contra `âncora → destino`; só o patch final (sem `live`)
**consome** orçamento e avança a âncora. Isso resolve dois problemas de uma vez: os ecos `live` já
escrevem no banco durante o arraste (então o "antes" lido do banco seria a posição de 33 ms atrás,
o mesmo motivo que criou o `dragFrom` do histórico), e o cliente não precisa ser confiado em nada —
mesmo um cliente adulterado que só mande ecos `live` nunca consegue afastar o token da âncora além
do orçamento.

**D3 — quem NÃO está no combate continua se movendo normalmente.** Com combate ativo no mapa, a
trava "só o combatente da vez" vale para **tokens que estão no combate**. Um token fora da lista de
combate (cenário, montaria, um NPC que o GM está posicionando) continua respondendo ao teclado e ao
arraste para quem o controla. A leitura literal do pedido ("outros tokens não respondem") travaria
até isso; se for o que você quer, é um `if` a menos.

**D4 — orçamento resolvido no início do turno e gravado no combatente.** Quando o combatente vira o
da vez, o servidor calcula o orçamento (override manual do GM → `derived` da ficha vinculada →
`movement.default` do sistema) e **grava** em `Combatant.movementBudget`. Motivo: validar cada eco
`live` teria que ler ficha + rodar `computeCharacter` 30×/s. Efeito colateral aceito: mudar o
deslocamento na ficha no meio do turno só vale no turno seguinte (ou o GM ajusta à mão).

**D5 — o caminho e o gasto são públicos para quem vê o token.** Todos que enxergam o token do
combatente da vez veem a linha do caminho e "4,5 / 9 m" — inclusive de NPC do GM (o jogador acaba
sabendo o deslocamento do monstro). É o comportamento do Foundry e o que faz a mesa funcionar;
restringir depois é filtrar um campo em `toCombat`.

**D6 — segurar a tecla é UM movimento, não N.** Cada *pressionada* de tecla vira uma entrada no
histórico do GM, como pedido. Mas o auto-repeat do teclado (segurar a seta) usa o mesmo modelo do
arraste: manda `live: true` enquanto anda e confirma uma vez só ao soltar (ou 250 ms depois da
última tecla) — senão segurar a seta 2 s empilharia ~30 entradas de Ctrl+Z. Alternativa simples:
ignorar `e.repeat` (só anda uma célula por pressionada, Shift para andar 5).

**D7 — desfazer não devolve deslocamento.** Ctrl+Z de um movimento (que passa por
`writeTrackablePatch`, não pelo handler normal) reposiciona o token mas não estorna `movementUsed`.
Estornar exigiria snapshot do estado de movimento em cada entrada de histórico; o GM tem o botão de
zerar o gasto do combatente (§4.3) para o caso raro.

---

## 1. `packages/shared`

### 1.1 Bloco `movement` no schema do sistema (`src/schemas/system.ts`)

```ts
/** Orçamento de deslocamento por turno (docs/plano-movimento.md). Ausente = o sistema não tem
 *  regra de deslocamento: nada de barra, caminho ou bloqueio (só o movimento por teclado, livre). */
export const MovementDefSchema = z.object({
  /** Chave em derived[] com o deslocamento do personagem (T20: "movement", fórmula "9"). */
  derived: KeySchema,
  /** Orçamento de token SEM ficha vinculada, na unidade do grid (T20: 9). */
  default: z.number().nonnegative(),
  /** Regra de diagonais só do movimento. Ausente = grid.diagonals (o que a régua usa) — ver D1. */
  diagonals: DiagonalRuleSchema.optional(),
});
```
Em `SystemDefinitionSchema`: `movement: MovementDefSchema.optional()`.

`validateSystemDefinition` ganha duas checagens (mesmo estilo das existentes):
- `movement.derived` precisa existir em `derived[]`;
- `movement` exige `grid` (sem `cellSize`/`unit` não há como converter célula ↔ metro nem exibir).

### 1.2 `systems/tormenta20.json`

```json
"movement": { "derived": "movement", "default": 9 }
```
`derived.movement` já existe (`"formula": "9"`, rótulo "Deslocamento (m)"). Nada mais muda.

### 1.3 Medição com diagonais acumuladas (`src/rules/measure.ts`)

A regra `alternating` (1-2-1) precisa saber **quantas diagonais já foram gastas no turno**, senão
seis passos diagonais avulsos custariam 6 células em vez de 9. Generalizar a função existente:

```ts
/** Custo de (dx, dy) células, sabendo quantas diagonais já foram contadas antes (regra 1-2-1). */
export function measureCellsFrom(dx, dy, rule: DiagonalRule, diagonalsBefore: number)
  : { cells: number; diagonals: number }
```
Para `alternating`: `cells = max(ax,ay) + floor((diagonalsBefore + d)/2) − floor(diagonalsBefore/2)`,
com `d = min(ax,ay)`; `diagonals = diagonalsBefore + d`. Nas outras regras `diagonals` é irrelevante.
`measureCells(dx, dy, rule)` continua existindo como `measureCellsFrom(..., 0).cells` — a régua e os
gabaritos não mudam nem uma linha.

### 1.4 Regras puras do orçamento (`src/rules/movement.ts`, novo)

```ts
/** Estado de deslocamento de um combatente no turno. `used` na unidade do jogo (m). */
export interface MovementState { used: number; diagonals: number }

/** Modificador de deslocamento — nada gera isto ainda (Lento/Imóvel entram aqui depois). */
export type MovementModifier =
  | { kind: "set"; value: number }        // define a base (forma alternativa, montaria)
  | { kind: "add"; value: number }        // +3 m
  | { kind: "multiply"; value: number }   // 0.5 = metade (Lento)
  | { kind: "block" };                    // 0 (Imóvel)

/** Orçamento final. Ordem: set → add → multiply → block; nunca negativo. */
export function computeMovementBudget(base: number, modifiers: MovementModifier[]): number;

/** Base antes dos modificadores: override do GM → derived da ficha → movement.default. */
export function movementBase(def, opts: { override?: number | null; derived?: Record<string, number> | null }): number | null;

/** Custo (na unidade do jogo) de ir de `from` a `to` — ambos em CÉLULAS — dado o estado atual. */
export function stepCost(def, state: MovementState, dxCells: number, dyCells: number): { cost: number; diagonals: number };

/** Estado depois de confirmar um passo. */
export function applyStep(def, state: MovementState, dxCells: number, dyCells: number): MovementState;

/** Quanto sobra (nunca negativo) e se um passo cabe (com epsilon de 1e-6 para float). */
export function movementRemaining(budget: number, state: MovementState): number;
export function fitsInBudget(def, budget: number, state: MovementState, dxCells: number, dyCells: number): boolean;

export const EMPTY_MOVEMENT: MovementState = { used: 0, diagonals: 0 };
```
Tudo puro, sem I/O: servidor (validação) e web (preview ao vivo, barra) rodam as mesmas funções.
Conversão pixels → células fica onde já está (`web/src/lib/grid.ts` no cliente; no servidor, uma
função equivalente sobre `Scene.grid`, ver §2.2).

### 1.5 `CombatantSchema` (`src/schemas/combat.ts`)

Quatro campos novos (todos derivados do estado do servidor, jogador e GM recebem igual — D5):

```ts
/** Orçamento do turno, na unidade do grid. null = sistema sem `movement`, ou combate sem turno ativo. */
movementBudget: z.number().nullable(),
/** Gasto acumulado no turno, mesma unidade. */
movementUsed: z.number(),
/** Diagonais já contadas no turno (regra 1-2-1). */
movementDiagonals: z.number().int(),
/** Caminho do turno em pixels do mapa (primeiro ponto = onde o turno começou). Preenchido só para
 *  o combatente da VEZ; [] nos demais, pra não inchar o payload. */
movementPath: z.array(z.object({ x: z.number(), y: z.number() })),
```

### 1.6 Eventos e payloads (`src/events.ts`, `src/schemas/payloads.ts`)

- `combat:set-movement` (GM) — `{ sceneId, combatantId, budget?: number | null, used?: number }`:
  ajusta o orçamento à mão (correr, magia, empurrão) e/ou zera o gasto. `budget: null` volta a
  seguir a ficha. Ack devolve o `Combat`, como os demais `combat:*`.
- `combat:set-movement-limit` (GM) — `{ enabled: boolean }`: liga/desliga a regra **na sala, na
  sessão** (memória, não vai ao banco). Broadcast `combat:movementLimitChanged { enabled }` para
  todos, e o valor entra no `RoomSnapshot` (`movementLimitEnabled: boolean`) para quem entra depois.
- Nenhum evento novo para mover: o movimento continua sendo `token:update` / `token:update-many`.

---

## 2. `apps/server`

### 2.1 Prisma (`schema.prisma` + `make db-migrate` → `movimento_por_turno`)

No `model Combatant`:
```prisma
/// Orçamento do turno na unidade do grid, resolvido quando o combatente virou o da vez (D4).
/// null = ainda não teve turno, ou o sistema não tem `movement`.
movementBudget    Float?
/// Gasto acumulado no turno (mesma unidade) e diagonais já contadas (regra 1-2-1).
movementUsed      Float   @default(0)
movementDiagonals Int     @default(0)
/// Posição de onde o próximo movimento é medido: início do turno, ou fim do último confirmado (D2).
movementAnchorX   Float?
movementAnchorY   Float?
/// Caminho do turno: [{x,y}] em pixels do mapa, no máximo 200 pontos (ver §2.3).
movementPath      Json?
```

### 2.2 `services/movement.ts` (novo)

- `resolveBudget(def, combatantRow)`: override → `computeCharacter(def, ficha).derived[def.movement.derived]`
  → `def.movement.default`; passa por `computeMovementBudget(base, [])` (os modificadores chegam vazios
  hoje — é o gancho de Lento/Imóvel).
- `startTurnMovement(combatId, combatantId)`: zera `movementUsed`/`movementDiagonals`, grava o
  orçamento resolvido, âncora = posição atual do token, `movementPath = [posição]`. Chamada de
  **todo** lugar que grava `activeCombatantId` (`combat:next`, `combat:prev`, `combat:delay`,
  `combat:resume`, `combat:start`→`startTurns`, `stateAfterRemoval`) — uma função só, para não
  esquecer um caminho.
- `checkMovement(def, ctx, tokenRow, patch)`: o coração. Só roda quando o patch mexe em `x`/`y`.
  1. `prisma.combat.findUnique({ where: { sceneId }, select: { id, status, activeCombatantId } })`;
     sem combate, ou `status !== "active"` → libera.
  2. `prisma.combatant.findUnique({ where: { combatId_tokenId } })`; token fora do combate → libera (D3).
  3. Não é o combatente da vez → jogador: `HandlerError("Não é o seu turno")`; GM: libera sem consumir.
  4. É o da vez: sem `def.movement`, sem `grid` do sistema, grid da cena `"none"`, ou limite
     desligado na sala → libera sem consumir. Senão calcula
     `dxCells/dyCells = (destino − âncora) / cellSize(px)` e `stepCost`; não cabe →
     `HandlerError("Deslocamento insuficiente: restam 3 m")`.
  5. Devolve `{ commit }` — chamado **depois** do `prisma.token.update`, e só quando `patch.live`
     não está setado: grava `movementUsed`/`movementDiagonals` novos, âncora = destino, empurra o
     ponto em `movementPath` (limite de 200 pontos: passando disso, substitui o último em vez de
     empilhar — o desenho perde detalhe, os números continuam exatos) e reemite `combat:updated`
     do mapa.

Duas consultas indexadas por movimento (inclusive nos ecos `live`); nenhuma leitura de ficha no
caminho quente, graças a D4.

### 2.3 `socket/token.ts`

Em `applyTokenUpdate`, depois de `canEditToken`/`requirePlayerTokenOnActiveScene` e antes do
`prisma.token.update`: `const movement = await checkMovement(...)`; depois do update e do
`broadcastToken`, `if (!patch.live) await movement?.commit()`. `token:update-many` chama o mesmo
caminho por patch — como já é tudo-ou-nada, um arraste em grupo de jogador que inclua um combatente
que não é o da vez é recusado inteiro (mensagem do item 3).

### 2.4 `socket/combat.ts` + `services/combat.ts`

- `toCombat` passa os quatro campos novos (`movementPath` só do combatente da vez, `[]` nos outros).
- Handlers novos: `combat:set-movement` (gmOnly; `budget` grava direto, `used` zera gasto +
  diagonais + âncora na posição atual + caminho reiniciado) e `combat:set-movement-limit` (gmOnly;
  `services/movementLimit.ts`, um `Map<roomId, boolean>` em memória, mesmo padrão de
  `services/templates.ts`/`presence.ts`; broadcast + entra no snapshot em `socket/room.ts`).
- Todo handler que muda o turno chama `startTurnMovement` (§2.2).

---

## 3. `apps/web` — movimento por teclado

### 3.1 `lib/useTokenMoveShortcuts.ts` (novo, montado ao lado de `useToolShortcuts` na RoomPage)

- Teclas: `ArrowUp/Down/Left/Right` e `w/a/s/d`. `Shift` = 5 células. Ignora quando `isTyping(e.target)`
  ou com Ctrl/Meta/Alt. **Não há colisão hoje** (a barra usa V/H/R/F/T, mais J/M/`\`), mas a regra
  pedida vale mesmo assim: WASD só age quando há token selecionado.
- Alvo: `selectedIds` filtrados por `canControl(me, token)` e pela regra de turno (§3.2). Um token →
  `tokens.patch`; vários → `tokens.patchMany` (uma entrada de histórico só, como o arraste em grupo).
- Passo: `delta = célula × (shift ? 5 : 1)`; destino = `clampToMap(snapToGrid(pos + delta))`. Grid
  `"none"`: passo de 70 px (`effectiveCellSize`) e sem snap — mesma convenção do resto do canvas.
- Auto-repeat (D6): enquanto a tecla está segurada, `tokens.moveLive` (que já é throttled a 33 ms);
  ao soltar, ou 250 ms depois da última tecla, um `patch` final (sem `live`) confirma o gesto — uma
  entrada de Ctrl+Z por rajada.

### 3.2 Regra de turno no cliente (`store/combat.ts`)

```ts
/** Pode mover este token agora? Espelha checkMovement do servidor (o servidor decide de novo). */
export function canMoveNow(combat: Combat | null, token: Token, me: Participant): "ok" | "not-my-turn";
```
Usada em três lugares: o hook do teclado (toast discreto "Não é o seu turno", no máximo um por
rajada de teclas), o `draggable` do `TokenNode` (não é o seu turno → o token nem começa a arrastar)
e o preview de gasto (§3.3).

---

## 4. `apps/web` — orçamento na tela

### 4.1 Caminho e gasto no mapa (`components/MovementLayer.tsx`, novo)

Camada Konva desenhada acima dos tokens, só quando há combate `"active"` na cena vista e o
combatente da vez tem `movementBudget`:
- polilinha de `combatant.movementPath` (tracejada, dourada, espessura constante em pixels de tela —
  mesmo `k = 1 / stageScale` da régua e dos pinos);
- durante o arraste/teclado do token da vez, o segmento ao vivo do último ponto até a posição atual;
- rótulo ao lado do token: `4,5 / 9 m` (`Label`+`Tag`, igual à régua), dourado enquanto cabe,
  vermelho quando o próximo passo estoura. O número ao vivo = `movementUsed + stepCost(...)`,
  calculado com as funções puras do §1.4 — nada de recalcular regra na UI.
- Limite desligado na sala: mostra só o gasto (`4,5 m`), sem o "/ 9" e sem vermelho.

### 4.2 Recusa ao soltar (`VttCanvas#handleTokenDragEnd`)

Se o destino estoura o orçamento: **não** manda o patch do destino; manda um patch com a âncora
(`movementPath[último]`) — o servidor aceita (custo zero) e o broadcast recoloca o token no lugar
para todo mundo, inclusive corrigindo os ecos `live` que já tinham sido gravados. Toast:
"Deslocamento insuficiente (restam 3 m)". Mesma função usada pelo teclado quando o passo não cabe.

### 4.3 Painel de combate (`components/CombatPanel.tsx`)

- Barra fina (`h-1`, dourada, vermelha em 0) na linha do combatente da vez, largura =
  `1 − used/budget`, com `title="4,5 / 9 m"`. Só aparece quando `movementBudget != null`.
- GM, na linha do combatente: campo numérico pequeno para o orçamento (vazio = segue a ficha) e um
  botão de zerar o gasto — os dois em `combat:set-movement`, mesmo padrão do editor de iniciativa
  que já existe ali.
- GM, no cabeçalho do painel: interruptor "Ignorar limite de movimento" (`combat:set-movement-limit`),
  com legenda "vale para a sala, até reiniciar o servidor". Jogador vê o estado, não muda.

### 4.4 Stores

`store/combat.ts` ganha `setMovement(...)` e `setMovementLimit(enabled)` (padrão `run(emitAck(...))`
dos demais); `store/room.ts` guarda `movementLimitEnabled` (do snapshot e do broadcast).

---

## 5. Testes

`packages/shared/src/rules/movement.test.ts` (novo):
- `measureCellsFrom`: as quatro regras; `alternating` com `diagonalsBefore` 0/1/2 (a 2ª, 4ª… diagonal
  custa dobrado) e a equivalência "seis passos diagonais de 1" == "um passo diagonal de 6".
- `stepCost`/`applyStep`: acúmulo entre movimentos do mesmo turno, incluindo a virada da diagonal.
- `computeMovementBudget`: ordem `set → add → multiply → block`, piso em 0, lista vazia = base.
- `movementBase`: override do GM > `derived` da ficha > `movement.default`; sistema sem `movement` → null.
- `fitsInBudget`: cabe exatamente (9/9, com epsilon), não cabe por pouco, orçamento 0.
`packages/shared/src/test/systems.test.ts` continua validando o `tormenta20.json` com o bloco novo.
`apps/web/src/lib/grid.test.ts` ganha o caso do passo por teclado (snap + clamp na borda do mapa).

---

## 6. SPEC

- **§9.11 novo** — "Movimento por teclado e orçamento de deslocamento": tudo acima em prosa, com as
  decisões D1–D7.
- **§3.3 (Tokens)**: uma linha sobre setas/WASD e a trava de turno, apontando para §9.11.
- **§3.5 (Modo de combate)**: os campos novos de `Combatant`, o reset por turno e o interruptor do GM.
- **§4 (Modelo de dados)** e **§5 (Eventos)**: campos do `Combatant`, `combat:set-movement`,
  `combat:set-movement-limit`, `combat:movementLimitChanged`, `RoomSnapshot.movementLimitEnabled`.

---

## 7. Ordem de implementação (um commit por etapa)

1. `shared`: `measureCellsFrom`, `rules/movement.ts`, bloco `movement` no schema + `tormenta20.json`,
   campos novos do `Combatant`, payloads/eventos, testes. (`make test` verde aqui já.)
2. `server`: migration, `services/movement.ts`, `services/movementLimit.ts`, `checkMovement` no
   `token:update`/`update-many`, `startTurnMovement` em todos os caminhos de turno, handlers novos.
3. `web`: `useTokenMoveShortcuts` + `canMoveNow` (movimento por teclado funcionando sozinho).
4. `web`: `MovementLayer`, recusa no `handleTokenDragEnd`, barra e controles no `CombatPanel`.
5. SPEC no mesmo commit da etapa que muda o comportamento descrito.

`make typecheck && make test` ao fim de cada etapa.

---

## 8. Riscos conhecidos

- **Duas consultas por eco de arraste** (~30/s por token arrastado). São por chave única e indexadas,
  e substituem o que seria uma leitura de ficha + `computeCharacter`. Se pesar, o passo seguinte é
  um cache em memória do `{ status, activeCombatantId }` por cena, invalidado em `combat:updated`.
- **Float**: `used` acumula em metros; comparações usam epsilon de 1e-6 (a regra `euclidean` gera
  irracionais). Múltiplos de 0,5 m são exatos em binário, então o caso comum nunca "sobra 8,999".
- **Desfazer não estorna** (D7); o GM tem o botão de zerar.
- **GM com "ignorar limite" ligado** que arrasta 30 m deixa `movementUsed` acima do orçamento: a
  barra fica cheia/vermelha e o jogador não anda mais naquele turno. É o botão de zerar de novo —
  vale um aviso no tooltip do interruptor.
