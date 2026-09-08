# Plano: modo de combate com iniciativa

> Substitui o rastreador manual de iniciativa (SPEC §3.5) por um **modo de combate** por cena,
> persistido, com rolagem de iniciativa pela ficha, visibilidade por participante, surpresa,
> adiar turno e destaque no mapa. Escrito em 08/09/2026, **antes** da implementação.

**Princípio (regra nº 1):** nenhuma regra de T20 no código. A fórmula da iniciativa, o critério de
desempate e a existência de rodada de surpresa entram em `tormenta20.json`; o código só lê.

**Fora deste plano:** duração de condições em rodadas (só o tipo e o TODO ficam prontos), automação
de efeitos por turno, "reação"/"ação preparada", múltiplos combates simultâneos na mesma cena,
visual definitivo da aba (vem do AI Studio depois).

---

## 1. Regras no JSON do sistema

`SystemDefinitionSchema` ganha um bloco `combat` (obrigatório, como `rolls` já era):

```jsonc
"combat": {
  // Iniciativa de quem tem ficha vinculada. Placeholders globais da ficha.
  "initiative": "1d20 + {skill.iniciativa}",
  // Iniciativa de token SEM ficha. {bonus} = bônus manual digitado pelo GM.
  "initiativeNoSheet": "1d20 + {bonus}",
  // Valor sem dado usado no desempate de quem tem ficha (vira Combatant.bonus).
  "tiebreakBonus": "{skill.iniciativa}",
  // Critérios de desempate depois do valor rolado, do mais forte ao mais fraco.
  "tiebreak": ["bonus", "order"],
  // Surpresa: combatente surpreso é pulado nas N primeiras rodadas. 0 = sistema sem surpresa.
  "surprise": { "rounds": 1 }
}
```

**Decisão 1 — `rolls.initiative` sai e vira `combat.initiative`.** Hoje a fórmula da iniciativa está em
`rolls.initiative` (usada pelo botão da ficha, `DerivedStatsBar`). Manter as duas seria a mesma regra
escrita em dois lugares do JSON, que é exatamente o que a regra nº 1 evita. `buildCharacterRoll` (caso
`initiative`) e a ficha passam a ler `def.combat.initiative`. É uma mudança de 2 linhas + o JSON.

**Decisão 2 — `bonus` fica gravado no combatente.** O desempate precisa do "bônus de iniciativa" de cada
um. Em vez de ir buscar na ficha toda vez (que pode ter mudado, ou a ficha ter sumido), o servidor calcula
`tiebreakBonus` com `evaluateConstant` no momento em que o combatente entra e na hora da rolagem, e grava
o número. Token sem ficha: o GM digita. Assim a ordenação é uma função pura sobre a lista, sem I/O.

Validação: `CONTEXTUAL` em `schemas/system.ts` ganha `combatInitiative: []`,
`combatInitiativeNoSheet: ["bonus"]` e `combatTiebreak: []`, e a validação cruzada confere as três
fórmulas (é o mesmo `check()` que já roda em `rolls.*`). O teste `src/test/systems.test.ts` continua
valendo para todo JSON em `systems/`.

---

## 2. Modelo de dados

### Prisma (`apps/server/prisma/schema.prisma`)

```prisma
model Combat {
  id          String  @id @default(cuid())
  roomId      String
  sceneId     String  @unique          // um combate por cena
  round       Int     @default(0)
  status      String  @default("rolling")  // rolling | active | ended
  /// Combatente da vez. null = ninguém agindo (rolando iniciativa, ou combate encerrado).
  activeCombatantId String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  room       Room        @relation(fields: [roomId], references: [id], onDelete: Cascade)
  scene      Scene       @relation(fields: [sceneId], references: [id], onDelete: Cascade)
  combatants Combatant[]

  @@index([roomId])
}

model Combatant {
  id          String  @id @default(cuid())
  combatId    String
  tokenId     String
  characterId String?          // cópia do token no momento da entrada (só informativo)
  /// null = ainda não rolou (fica no fim da lista, cinza, e não recebe turno).
  initiative  Float?
  bonus       Float   @default(0)
  delayed     Boolean @default(false)
  surprised   Boolean @default(false)
  /// Ordem manual do GM: último critério de desempate. Renumerada 0..n-1 a cada mudança.
  order       Int     @default(0)
  addedRound  Int     @default(0)

  combat Combat @relation(fields: [combatId], references: [id], onDelete: Cascade)
  token  Token  @relation(fields: [tokenId], references: [id], onDelete: Cascade)

  @@unique([combatId, tokenId])
  @@index([combatId])
}
```

`Token` ganha `combatants Combatant[]`; `Scene` e `Room` ganham `combat`/`combats`. Apagar o token
apaga o combatente (cascade) — é o que a gente quer: token fora do mapa, fora do combate.

Migration: `pnpm --filter @tormenta-vtt/server exec prisma migrate dev --name combate_por_cena`
(via `make db-migrate`). Ela **remove** a tabela `InitiativeEntry`; a iniciativa manual em andamento
se perde, o que é aceitável (era estado efêmero de qualquer jeito).

**Decisão 3 — `activeCombatantId` no banco, `activeIndex` derivado no cliente.** O pedido original tinha
`activeIndex`. Guardar um índice numa lista que é *derivada* (ordenada por iniciativa, e ainda filtrada por
participante) é frágil: qualquer add/remove/reorder exige "reapontar" o índice — é justamente a parte chata
do código atual (`repointCursor`). Guardando o **id** de quem age, a lista pode ser reordenada e filtrada à
vontade sem tocar no cursor, e o cliente acha a posição com um `findIndex`. Se você preferir o `activeIndex`
literal no payload, é 1 linha a mais no serializador — só me diga.

### Shared (`packages/shared/src/schemas/combat.ts`)

O que trafega (e o que vai no `RoomSnapshot`):

```ts
CombatStatus = "rolling" | "active" | "ended"

Combatant = {
  id, tokenId, characterId: string | null,
  name: string,            // denormalizado do token no momento do envio
  color: string,           // idem (a lista mostra a bolinha da cor)
  ownerId: string | null,  // dono do token: define quem pode rolar/adiar
  initiative: number | null,  // null = você não pode ver o valor (ver §4)
  rolled: boolean,            // já rolou? separado do valor, para não vazar número
  bonus: number | null,       // só o GM recebe
  delayed: boolean,
  surprised: boolean,
  order: number,
  addedRound: number,
}

Combat = {
  id, sceneId, round, status,
  activeCombatantId: string | null,
  combatants: Combatant[],   // JÁ ordenados pelo servidor
}
```

**Decisão 4 — `rolled` separado de `initiative`.** No banco, `initiative = null` significa "não rolou".
No fio, `null` também significa "você não pode ver esse número" (jogador olhando o NPC). Sem o booleano
`rolled`, o jogador veria todo mundo como "sem iniciativa, cinza". Com ele, a UI sabe desenhar cinza só
quem realmente falta rolar. Também resolve a rolagem às cegas: jogador que rolou em modo secreto vê seu
combatente na ordem certa, com `rolled: true` e `initiative: null`.

**Decisão 5 — `name`/`color` denormalizados.** O jogador só recebe combatentes cujo token ele enxerga,
então poderia ler o nome da store de tokens. Mas isso cria corrida (o `combat:updated` pode chegar antes do
`token:updated`) e acopla a aba à store de tokens. O servidor copia nome e cor do token **na hora de emitir**,
então nunca ficam velhos e nada extra vai pro banco.

`schemas/initiative.ts` é **apagado** (o `InitiativeEntry`/`InitiativeState` some do barrel).

---

## 3. Regras puras no shared (`packages/shared/src/rules/combat.ts`)

Tudo o que é "regra de ordem de combate" é função pura, sem I/O, testada. Trabalha sobre um tipo mínimo
(`CombatantCore = { id, initiative, bonus, delayed, surprised, order }`), então serve tanto para a linha do
Prisma quanto para o objeto do fio.

| Função | O que faz |
|---|---|
| `sortCombatants(def, list)` | Ordena: **quem rolou primeiro** (`initiative` desc), depois os critérios de `def.combat.tiebreak` na ordem declarada (`bonus` desc, `order` asc). Quem não rolou (`initiative === null`) vai sempre para o fim, entre si por `order`. Adiados saem da rotação mas continuam na lista, logo antes dos não-rolados. |
| `canAct(def, c, round)` | `false` se não rolou, se está adiado, ou se `surprised && round <= def.combat.surprise.rounds`. |
| `advanceTurn(def, state, dir)` | A partir do `activeCombatantId` e do `round`, devolve `{ activeCombatantId, round }` novos. `dir = 1` (próximo) anda na lista ordenada pulando quem não pode agir; ao passar do último, `round += 1` e volta ao primeiro. `dir = -1` faz o inverso (`round` mínimo 1). Guarda contra laço infinito: se ninguém pode agir, tenta no máximo `surprise.rounds + 1` voltas e devolve `activeCombatantId: null`. |
| `startTurns(def, state)` | `status: "rolling" → "active"`, `round = 1`, ativo = primeiro que pode agir. |
| `normalizeOrder(list)` | Renumera `order` em `0..n-1` seguindo a ordem atual. Roda depois de todo add/remove/reorder/resume, para o campo nunca ter buraco nem empate. |
| `resumePlacement(state, id)` | Adiado "entra agora": copia `initiative` e `bonus` do combatente ativo e recebe `order` imediatamente **antes** dele, ficando ativo na hora. Quem foi interrompido age em seguida. |
| `buildInitiativeRoll(def, { character, bonus })` | Devolve `{ formula, label, bonus }`: com ficha, substitui placeholders de `combat.initiative` e calcula `combat.tiebreakBonus` (`evaluateConstant`); sem ficha, `combat.initiativeNoSheet` com `{bonus}`. Quem rola é o servidor. |

### Testes (`packages/shared/src/rules/combat.test.ts`)

1. Ordenação: valor maior primeiro; empate de valor decide por `bonus`; empate dos dois decide por `order`.
2. Não-rolados sempre no fim, mesmo com `bonus` alto.
3. `advanceTurn`: anda 1 a 1; ao fechar o ciclo incrementa a rodada e volta ao primeiro; `prev` no primeiro
   volta ao último e decrementa (mínimo 1).
4. Surpresa: surpreso é pulado na rodada 1 e age na rodada 2; `surprise.rounds = 0` nunca pula.
5. Todos surpresos na rodada 1: avança a rodada em vez de travar.
6. Adiar: sai da rotação (o `next` pula); `resumePlacement` põe ele antes do ativo e ele vira o ativo.
7. `normalizeOrder`: sem buracos e estável.
8. Combatente sem iniciativa nunca recebe turno.

---

## 4. Visibilidade (quem vê o quê)

Regra única, em `apps/server/src/services/combat.ts`, usada no broadcast **e** no snapshot:

- **GM**: recebe todos os combatentes com todos os campos.
- **Jogador**: recebe só os combatentes cujo **token ele pode ver** — exatamente o mesmo
  `tokenVisibleTo(token, viewer, fog)` que já filtra token e névoa (§9.3). Token oculto/na névoa: o
  combatente simplesmente não vem na lista, então nome e existência não vazam. Ao revelar o token, o
  combatente reaparece **na posição que já tinha** (a ordem é calculada sobre a lista completa, no
  servidor, e só depois filtrada).
- Campos escondidos do jogador: `bonus` sempre `null`; `initiative` só vem quando o combatente é dele
  (token que ele possui) **e** a rolagem não foi às cegas. Dos outros — jogadores inclusive — ele vê só a
  ordem, o nome e o `rolled`.

**Quando reemitir para os jogadores** (a visibilidade depende do estado do token):
- todo evento `combat:*` (óbvio);
- `fog:update` (já reenvia os tokens; passa a reenviar o combate também);
- `token:update` que mexa em `name`, `color` ou `visible` — nunca em `x/y` sozinho, que é o caso do
  arraste (30 eventos/s);
- `token:update` de posição **só quando o token cruza a fronteira da névoa**: comparamos
  `isPointRevealed` antes e depois (função pura, sem banco); se o booleano virou, reemitimos. Assim um
  token de combate que entra na névoa some da lista do jogador na hora, sem custo no arraste normal;
- `token:delete` (o cascade tirou o combatente).

---

## 5. Eventos

Todos em `packages/shared/src/events.ts` + schemas em `schemas/payloads.ts`. Os `initiative:*` (add,
update, remove, next, prev, reset) são **removidos**.

### Cliente → Servidor

| Evento | Payload | Quem | Efeito |
|---|---|---|---|
| `combat:start` | `{ sceneId, tokenIds: string[] }` | GM | Apaga o combate anterior da cena (se houver) e cria um novo: `status: "rolling"`, `round: 0`, um combatente por token (`order` na ordem recebida, `bonus` calculado da ficha, `initiative: null`) |
| `combat:add` | `{ tokenIds: string[] }` | GM | Reforços: entram com `addedRound = round`, sem iniciativa, no fim da ordem. Token já no combate é ignorado |
| `combat:remove` | `{ combatantIds: string[] }` | GM | Remove; se um deles era o ativo, o turno passa para o próximo que pode agir |
| `combat:roll` | `{ scope: "self" \| "npcs" \| "missing" \| "one", combatantId?, visibility? }` | ver abaixo | Rola no servidor, publica no chat e grava o valor |
| `combat:set-initiative` | `{ combatantId, initiative: number \| null, bonus? }` | GM | Valor digitado à mão. `null` volta para "não rolou" |
| `combat:set-surprised` | `{ combatantId, surprised: boolean }` | GM | Marca/desmarca surpresa |
| `combat:next` / `combat:prev` | `{}` | GM | `next` com `status: "rolling"` inicia os turnos (`status: "active"`, `round: 1`); senão anda na ordem |
| `combat:reorder` | `{ combatantIds: string[] }` | GM | Nova ordem manual completa (arrastar na lista): grava `order` na sequência recebida |
| `combat:delay` | `{ combatantId }` | GM, ou dono do token | Só no próprio turno: `delayed = true` e o turno passa ao próximo |
| `combat:resume` | `{ combatantId }` | GM, ou dono do token | "Entrar agora": `resumePlacement` põe o combatente antes do ativo e ele passa a agir |
| `combat:end` | `{ clear?: boolean }` | GM | `clear` ausente/false: `status: "ended"`, `activeCombatantId: null` (a ordem fica visível). `clear: true`: apaga o combate e faz broadcast de `null` |

`combat:roll` por escopo:
- `self` (jogador ou GM): rola **os combatentes do autor** que ainda não rolaram (token que ele possui,
  ou cuja ficha vinculada é dele). É o botão da faixa.
- `one` + `combatantId`: um específico (GM sempre; jogador só se for dele).
- `npcs` (GM): todos os que ainda não rolaram e **não têm dono** (`token.ownerId === null`).
- `missing` (GM): todos os que ainda não rolaram.

`visibility` é o modo de rolagem atual de quem clicou (`all | gm | self`), igual a `character:roll`. Cada
combatente rolado vira uma `ChatMessage{kind:"roll"}` normal (`createRollMessage`), com rótulo
`"<nome>: Iniciativa"` e `characterId` quando há ficha — ganha de graça o card, o "Revelar" do GM e a
rolagem às cegas. O broadcast de `combat:updated` sai **uma vez só**, no fim do lote.

> **Ponto a confirmar:** "rolagem do GM sai no modo de rolagem atual dele (padrão: secreta para NPC)".
> Implementei a regra simples e previsível: **o cliente manda o modo atual do GM**, seja qual for o botão.
> Se você quiser "NPC é sempre secreto, independente do modo", é uma linha no handler (forçar `gm` quando o
> token não tem dono) — me diga qual dos dois.

### Servidor → Cliente

| Evento | Payload |
|---|---|
| `combat:updated` | `Combat \| null` (estado completo, já ordenado e filtrado para quem recebe; `null` = não há combate na cena ativa) |

`RoomSnapshot.initiative: InitiativeState` vira `RoomSnapshot.combat: Combat | null` (o combate da cena ativa).

---

## 6. Servidor

Arquivos novos:
- **`services/combat.ts`**: `loadCombat(sceneId)`, `requireCombat`, `toCombat(row, viewer, tokens, fog)`
  (ordena + denormaliza + filtra), `emitCombat(io, roomId, sceneId)` e `persistOrder`.
  `emitCombat` carrega combate + tokens + névoa **uma vez**, manda o estado cheio para `rooms.gm(roomId)`
  e, para cada jogador conectado, o estado filtrado em `rooms.participant(id)` — mesmo padrão do token com
  névoa. Precisa da lista de conectados: `services/presence.ts` ganha
  `connectedParticipants(roomId): string[]` (o `Map` já tem essa informação).
- **`socket/combat.ts`**: os handlers da tabela acima, todos com `guarded` (Zod + `gmOnly` onde vale) e
  `HandlerError` nas recusas ("Você não controla este combatente", "Só é possível adiar no seu turno",
  "Este combate já foi encerrado").

Arquivos apagados: `socket/initiative.ts`, `services/initiativeState.ts`, `toInitiativeEntry` em
`serialize.ts`.

Alterados: `socket/index.ts` (registra os handlers de combate), `services/snapshot.ts` (combate da cena
ativa em vez da iniciativa), `socket/token.ts` (reemitir o combate nos casos do §4), `socket/fog.ts` (idem),
`socket/scene.ts` (trocar de cena ativa → o cliente já refaz `room:join`, nada a fazer além do snapshot).

Regras de permissão em um lugar só (`services/combat.ts`): `canControlCombatant(ctx, combatant, token)` =
GM, ou dono do token, ou dono da ficha vinculada.

---

## 7. Web (UI mínima e funcional nesta fase)

- **`store/combat.ts`** (substitui `store/initiative.ts`): `state: Combat | null`, ações que chamam
  `emitAck` para cada evento, e seletores puros `activeCombatant(state)`, `myPendingCombatants(state, me)`,
  `isMyTurn(state, me)`. Nenhuma mudança otimista: a lista sempre vem do servidor (é barata e a ordem é
  regra de sistema — quem manda é ele). `bindSocket.ts` liga `combat:updated`; `room.ts` lê `snap.combat`.
- **`components/InitiativeTab.tsx`** reescrita, sem enfeite:
  - Cabeçalho: rodada, status (`Rolando iniciativa` / `Turno de X` / `Encerrado`), e o checkbox
    **"Centralizar no token da vez"** (opção por usuário, `localStorage`).
  - Lista ordenada: cor + nome, badge `TURNO`, `ADIADO`, `SURPRESO`, `SEM INICIATIVA` (cinza).
    Valor à direita só para quem pode vê-lo.
  - GM: valor editável inline; arrastar para reordenar (HTML5 drag simples na `<li>`, sem biblioteca —
    solta e emite `combat:reorder` com a lista inteira); botões por linha (surpresa, remover, pular);
    barra de ações: `Iniciar combate` (com os tokens selecionados), `Adicionar selecionados`,
    `Rolar NPCs`, `Rolar todos que faltam`, `Anterior` / `Próximo`, `Encerrar`.
  - Jogador: só `Rolar iniciativa` (a sua) e `Adiar` / `Entrar agora` no próprio turno.
- **`components/CombatBanner.tsx`** (faixa discreta acima do canvas, dois estados):
  - "Combate iniciado — role sua iniciativa" + botão, quando o jogador tem combatente sem `rolled`;
  - "É o seu turno" + botão "Adiar", quando `isMyTurn`.
- **`lib/useTurnTitle.ts`**: põe `▶ Seu turno · ` no `document.title` enquanto for a vez do jogador,
  e restaura ao sair. (É o jeito de chamar atenção de quem está em outra aba, sem notificação do SO.)
- **`VttCanvas`**: nada muda no desenho — o anel dourado tracejado de `isActiveTurn` já existe; só a fonte
  do `activeTurnTokenId` passa a ser a store de combate. Como o jogador não recebe combatentes de tokens
  que não vê, o anel também não vaza.
- **`RoomPage.tsx`**: liga as stores, e quando o ativo muda e a opção "centralizar" está ligada, dispara o
  `focusRequest` que já existe para o token da vez.
- **`SidePanel.tsx`**: props novas (a aba continua chamando "Iniciativa"; o badge `R{round}` continua).

---

## 8. Preparar (sem implementar): duração de condição em rodadas

Em `schemas/token.ts`, ao lado de `conditions: string[]`, entra **só o tipo e o TODO**:

```ts
/**
 * TODO (duração de condições): `conditions` vai virar `(string | TokenConditionWithDuration)[]`,
 * onde a forma longa é { key, expiresRound } com `expiresRound` comparado a `Combat.round`.
 * Quando for implementado: (1) z.union + z.preprocess para ler as fichas antigas (string vira { key });
 * (2) o servidor limpa as vencidas em combat:next, quando a rodada muda; (3) a UI mostra "N rodadas".
 * Nada lê este tipo por enquanto.
 */
export const TokenConditionWithDurationSchema = z.object({ key: KeySchema, expiresRound: z.number().int().min(1) });
export type TokenConditionWithDuration = z.infer<typeof TokenConditionWithDurationSchema>;
```

---

## 9. Ordem de execução

Cada passo termina com `make typecheck && make test` verdes.

1. **Shared — regras e tipos.** `combat` no `SystemDefinitionSchema` (+ `CONTEXTUAL` e validação cruzada),
   `combat` no `tormenta20.json`, `rolls.initiative` removido, `schemas/combat.ts`, `rules/combat.ts` +
   `rules/combat.test.ts`, payloads e `events.ts`, `RoomSnapshot.combat`, apagar `schemas/initiative.ts`,
   TODO da duração de condições. Aqui o `typecheck` vai apontar todos os pontos que usavam iniciativa.
2. **Servidor — persistência.** Prisma (`Combat`, `Combatant`, remoção de `InitiativeEntry`) + `make db-migrate`.
3. **Servidor — lógica.** `services/combat.ts`, `socket/combat.ts`, snapshot, reemissões em token/fog,
   `connectedParticipants` na presença, remoção do código antigo.
4. **Web — dados.** `store/combat.ts`, `bindSocket`, `room.ts`, `main.tsx` (`window.__vtt`).
5. **Web — UI.** `InitiativeTab` reescrita, `CombatBanner`, `useTurnTitle`, opção de centralizar,
   ligação no `RoomPage`/`SidePanel`.
6. **SPEC.** §3.5 reescrita como "Modo de combate"; §4 (tabela de entidades: sai `InitiativeEntry`, entram
   `Combat`/`Combatant`; `SystemDefinition` ganha `combat`); §5 (eventos `combat:*`, saem os `initiative:*`);
   §7 (novos arquivos); §8 (limitações: lista do jogador só reavalia a névoa quando o token cruza a
   fronteira ou num evento de combate; uma rolagem de iniciativa = uma mensagem no chat; duração de
   condição só preparada). Tudo no mesmo commit da mudança.
7. **Teste manual** (dois navegadores, GM + jogador): iniciar combate com 3 tokens (1 do jogador, 2 NPCs),
   faixa aparece para o jogador, ele rola pela ficha, GM rola NPCs em modo secreto, GM digita um valor,
   `Próximo` até virar a rodada, marcar surpresa, adiar e entrar agora, esconder o token de um NPC e ver
   ele sumir/voltar na lista do jogador, adicionar reforço no meio, encerrar.

## 10. Riscos conhecidos

- **Reemissão em excesso**: `emitCombat` faz uma consulta ao banco por evento. Em combate, os eventos são
  esporádicos (clique do GM), então tudo bem; a única fonte frequente (arraste) só reemite ao cruzar a
  névoa.
- **Uma mensagem de chat por rolagem**: "Rolar todos que faltam" com 8 NPCs enche o chat com 8 cards.
  É o preço de reaproveitar `createRollMessage` inteiro (visibilidade, revelar, às cegas). Se incomodar,
  depois dá para agrupar num card só de iniciativa.
- **Perda dos dados atuais de iniciativa** na migration (estado efêmero, sem valor).
