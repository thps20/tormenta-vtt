# Plano: múltiplos mapas por sala

> Criar, renomear, duplicar, apagar, listar e reordenar **mapas** numa sala; escolher o mapa ativo; o
> GM navegar e editar qualquer mapa sem ativar; levar tokens de um mapa para outro ao ativar; combate
> por mapa. Escrito em 09/09/2026, **antes** da implementação. **Aguardando aprovação.**

**Fora deste plano** (registrado no backlog quando fizer sentido): "Encerrar cena" (a unidade de tempo
de jogo — ver §1), gabaritos de área (não existem ainda; quando existirem já nascem por mapa),
mapas em camadas/níveis, importar mapa de outra sala, permissões de mapa por jogador, iluminação,
e desfazer as ações de mapa que **não** são apagar (§10.3).

---

## 1. Nomenclatura: "Mapa" na UI, `Scene` no código

Em Tormenta20 **cena** é uma unidade de tempo de jogo ("dura uma cena", "até o fim da cena"). Usar a
mesma palavra para "a imagem com grid e tokens" confunde as duas coisas — e vamos precisar da palavra
livre quando existir o botão "Encerrar cena".

Decisão:

- **Nada visível ao usuário diz "cena"**: UI, toasts, tooltips, mensagens de erro do servidor que
  chegam ao cliente e textos de ajuda passam a dizer **"mapa"**.
- **O nome interno continua `Scene`**: modelo Prisma, `SceneSchema`, `sceneId`, eventos `scene:*`,
  arquivos `socket/scene.ts`. Renomear tudo isso seria um diff gigante, arriscado e sem ganho para
  quem joga. O código já fala inglês por convenção (`cellSize`, `ownerId`), então `Scene` é só mais
  um identificador em inglês.
- **Nos docs** (SPEC, planos): usar "mapa" na prosa e reservar `Scene`/`sceneId` para quando o texto
  fala da entidade/coluna. O SPEC ganha uma nota curta explicando isso (§18).

Inventário do que muda de texto (achado por `grep -niE "cena"` em `apps/web/src` e nas mensagens de
erro do servidor):

| Arquivo | Hoje | Vira |
|---|---|---|
| `TopBar.tsx:56` | "Sem cena" | "Sem mapa" |
| `CombatPanel.tsx:143` | "Nenhuma cena ativa." | "Nenhum mapa ativo." |
| `RoomPage.tsx:414` | "Nenhuma cena ativa." | "Nenhum mapa ativo." |
| `MapConfigModal.tsx:220` | "Cena: {nome}" | "Mapa: {nome}" |
| `FogToolbar.tsx:84,95` | "névoa ativa nesta cena" | "...neste mapa" |
| `socket/scene.ts:10` | "Cena não encontrada" | "Mapa não encontrado" |
| `socket/combat.ts:67` | "Token não encontrado nesta cena" | "...neste mapa" |
| `services/combat.ts:61,68,74` | "Não há combate nesta cena" / "Só é possível ter combate na cena ativa" / "Nenhuma cena ativa" | "...neste mapa" (a segunda some, §7) |

Comentários de código em português que dizem "cena" podem ficar como estão, mas os que forem tocados
por este trabalho passam a dizer "mapa" — sem virar um commit de renomear comentário à toa.

---

## 2. O que já existe hoje (e o que falta)

Vale registrar porque muda o tamanho do trabalho: **a maior parte do modelo já é por mapa**.

Já pronto:

- `Scene` no Prisma com `mapUrl/mapWidth/mapHeight`, `grid` (Json) e `fog` (Json) — cada mapa já tem
  o seu grid e a sua névoa.
- `Token.sceneId`: todo token já pertence a um mapa. A store do web guarda os tokens num mapa achatado
  por id (`tokens.byId`) e filtra por mapa na leitura (`sceneTokens(byId, sceneId)`).
- `Combat.sceneId` **único**: o banco já suporta um combate por mapa, vários mapas com combate.
- `RoomSnapshot.scenes: Scene[]` já manda **todos** os mapas da sala (com grid e névoa de cada um).
- Eventos `scene:create`, `scene:activate`, `scene:setMap`, `scene:updateGrid` já existem e funcionam
  no servidor; `ruler:update` já carrega `sceneId`.
- `findFreeCells`/`numberedNames` (`packages/shared/src/rules/placement.ts`) já resolvem
  "posicionar N tokens em espiral sem sobrepor", usados pelo spawn de criaturas.
- Pilha de desfazer por sala (`services/history.ts`) com `pushEntry` e o padrão de soft delete
  (`Token.deletedAt`).

Falta:

1. Ordem, soft delete e ponto de chegada em `Scene` (§3).
2. Eventos de renomear, duplicar, apagar, reordenar e listar (§6).
3. O cliente carregar o estado de **um mapa** sem `room:join`/F5 (§5) e reagir ao broadcast de troca.
4. `viewingSceneId` por cliente: o GM olhando um mapa que não é o ativo (§4).
5. Combate deixar de exigir "cena ativa" (§7) — hoje `requireActiveScene`/`requireActiveCombat`
   travam tudo na ativa.
6. Diálogo "Levar para o mapa" ao ativar (§8) e o ponto de chegada (§9).
7. Painel "Mapas" com miniaturas (§13, §14).
8. Snapshot, `requireScene` e todo `findMany` de mapa filtrando `deletedAt: null`.

---

## 3. Modelo de dados

### Prisma (`Scene`) — uma migration, `scene_order_soft_delete_arrival`

```prisma
model Scene {
  // ... campos atuais ...
  /// Ordem no painel "Mapas" (arrastar reordena). Renumerado 0..n-1 a cada scene:reorder.
  order     Int       @default(0)
  /// Soft delete (mesmo padrão de Token.deletedAt): a linha fica pra desfazer; a limpeza
  /// definitiva apaga depois de 30 dias (services/cleanup.ts).
  deletedAt DateTime?
  /// Ponto de chegada { x, y } em pixels do mapa: onde os tokens levados de outro mapa
  /// aparecem (espiral a partir daí). null = sem marcador definido.
  arrival   Json?
}
```

`order`: a migration faz o backfill por `createdAt` (`row_number() over (partition by roomId order by
createdAt)`), então salas existentes já nascem ordenadas como estão hoje.

`arrival` é `Json?` (e não duas colunas `Float?`) pela mesma regra do projeto para campos que vão
evoluir: um dia isso pode virar vários pontos nomeados ("porta norte", "escada"), e aí não precisa de
migration.

### Shared (`packages/shared/src/schemas/scene.ts`)

```ts
export const ArrivalPointSchema = z.object({ x: z.number(), y: z.number() });
export type ArrivalPoint = z.infer<typeof ArrivalPointSchema>;

export const SceneSchema = z.object({
  // ... campos atuais ...
  order: z.number().int().default(0),
  arrival: ArrivalPointSchema.nullable().default(null),
});
```

`deletedAt` **não** entra no `SceneSchema` — é coluna só do banco, igual a `Token.deletedAt`: um mapa
apagado simplesmente não é serializado para ninguém.

### Item de lista do painel (dados que o cliente não tem)

O painel precisa de "quantos tokens tem o mapa X" e "tem combate lá?" — informação de mapas que o
cliente nunca carregou. Em vez de desnormalizar contadores em `Scene` (recalcular a cada
criar/apagar/mover token seria chato e fácil de errar), um tipo leve só para o painel:

```ts
export const SceneListItemSchema = z.object({
  sceneId: IdSchema,
  tokenCount: z.number().int(),        // tokens não apagados
  playerTokenCount: z.number().int(),  // tokens com ownerId != null (o "pede confirmação" de §10)
  combatStatus: CombatStatusSchema.nullable(), // null = sem combate no mapa
});
```

---

## 4. Estado por cliente: `viewingSceneId`

- **Jogador**: sempre vê o mapa ativo. `viewingSceneId` é derivado (`= room.activeSceneId`), sem UI
  para mudar.
- **GM**: `viewingSceneId` é estado **do cliente**, não do servidor — dois GMs (ou duas abas) podem
  olhar mapas diferentes ao mesmo tempo, e isso não é estado de jogo.

Onde mora: `store/room.ts`, campo `viewingSceneId: string | null`, com um seletor
`selectViewedScene(state)` que **substitui** o `selectActiveScene` atual em quase todo lugar do web
(canvas, névoa, régua, combate, seletor de alvos do "Aplicar", `MapConfigModal`, spawn de criatura).
`selectActiveScene` continua existindo só para a faixa de aviso e o painel.

Persistência: `sessionStorage` por sala (`vtt:viewing:<roomId>`), então um F5 no meio da preparação
volta para o mapa que o GM estava editando. Se o id salvo não existir mais (mapa apagado), cai para o
ativo.

Regra ao receber `room:activeSceneChanged`:

- **Jogador**: sempre segue.
- **GM**: segue **se estava vendo o mapa que era ativo** (o caso normal); se estava visitando outro,
  fica onde está e a faixa muda para "o ativo agora é Z". Quem clicou em "Ativar" segue sempre (é o
  que ele quis fazer).

Faixa de aviso (só GM, só quando `viewingSceneId !== activeSceneId`), acima do canvas:

> **Você está em _Caverna dos Goblins_.** O mapa ativo é _Taverna_. **[Ir para o ativo]** **[Ativar este]**

Sem isso o GM edita um mapa achando que os jogadores estão vendo — o erro mais provável desta feature.

---

## 5. A decisão pedida: snapshot por mapa **ou** `room:join` com `sceneId`?

**Proposta: nenhum dos dois exatamente — um evento novo, `scene:enter`.**

```ts
"scene:enter": (payload: { sceneId: string }, ack: Ack<{ tokens: Token[]; combat: Combat | null }>) => void;
```

Por quê não `room:join { sceneId? }`:

- `room:join` **tem efeitos colaterais**: cria/reconecta participante, resolve `sessionToken`, marca
  presença e faz broadcast de `room:participantJoined`. Trocar de mapa não é entrar na sala; reusar o
  join significa disparar tudo isso a cada clique no painel.
- O snapshot é **caro e redundante**: participantes, 100 mensagens de chat, todas as fichas e todos os
  mapas — nada disso muda quando eu só quero olhar outro mapa.
- É exatamente o "F5 disfarçado" que o pedido quer eliminar.

Por quê o payload é só `{ tokens, combat }`:

- `mapUrl`, `grid`, `fog` e `arrival` **já chegam** em `RoomSnapshot.scenes[]` e continuam chegando ao
  vivo por `scene:updated`/`fog:updated` para todos. Só tokens e combate são carregados por mapa.

Permissão: GM pode entrar em qualquer mapa não apagado da sala; **jogador só no mapa ativo** (ack de
erro caso contrário) — a filtragem de visibilidade (token invisível/névoa) é a mesma de sempre.

Quem chama `scene:enter`:

1. GM clicando num mapa no painel (ou na faixa "Ir para o ativo").
2. Qualquer cliente ao receber `room:activeSceneChanged` e decidir seguir (§4).
3. O cliente ao restaurar `viewingSceneId` do `sessionStorage` depois do `room:join`.

`room:join` continua devolvendo `tokens`/`combat` do **mapa ativo** (é o que 100% dos jogadores
querem no primeiro frame); o GM que estava visitando outro mapa faz um `scene:enter` logo depois.

### Consequência no cliente: as stores passam a guardar mais de um mapa

- `tokens.byId` já é achatado e filtrado por `sceneId` na leitura — **não muda de forma**. O que muda:
  `scene:enter` faz um **replace** dos tokens daquele mapa (remove os que a store tem daquele
  `sceneId` e insere os que vieram), nunca um merge — senão um token apagado enquanto eu estava fora
  ficaria fantasma.
- `combat.state: Combat | null` vira **`combat.byScene: Record<string, Combat | null>`**, e o painel
  lê o do mapa visitado. Isso obriga uma mudança de contrato:

```ts
// hoje
"combat:updated": (combat: Combat | null) => void;
// proposto — `null` sozinho não diz de qual mapa é
"combat:updated": (p: { sceneId: string; combat: Combat | null }) => void;
```

### Consequência no servidor: para quem vai cada broadcast

Regra simples, sem inventar salas do Socket.io por mapa (que brigariam com as salas de visibilidade
`gm`/`players`/`participant` que já existem):

> **Broadcast de coisa de mapa (`token:*`, `fog:updated`, `combat:updated`, `ruler:updated`): o GM
> sempre recebe; jogadores só se for o mapa ATIVO.**

- É correto: jogador nunca vê mapa não-ativo, então nem os ids dos tokens de um mapa que o GM está
  preparando vazam para a aba dele.
- É barato: um `if` no caminho que já existe (`services/visibility.ts#emitTokenToPlayers` e o
  `emitCombat`), com o `activeSceneId` da sala em mãos.
- O GM recebe eco de mapas que não está vendo — inofensivo (ele pode ver tudo) e o cliente filtra por
  `sceneId` na renderização, que já é como o canvas funciona.

---

## 6. Eventos socket

### Novos (cliente → servidor)

| Evento | Payload | Quem | Efeito / broadcast |
|---|---|---|---|
| `scene:enter` | `{ sceneId }` | GM (qualquer mapa), jogador (só o ativo) | ack `{ tokens, combat }`; sem broadcast |
| `scene:rename` | `{ sceneId, name }` | GM | `scene:updated` |
| `scene:duplicate` | `{ sceneId, name? }` | GM | `scene:created` (a cópia) |
| `scene:delete` | `{ sceneId, confirmMovePlayerTokens? }` | GM | `scene:deleted { sceneId }` + `token:updated` dos tokens de jogador movidos (§10) |
| `scene:reorder` | `{ sceneIds: string[] }` (lista completa) | GM | `scene:reordered { order: [{ sceneId, order }] }` |
| `scene:setArrival` | `{ sceneId, arrival: {x,y} \| null }` | GM | `scene:updated` |
| `scene:list` | `{}` | GM | ack `{ items: SceneListItem[] }`; sem broadcast |

### Alterados

| Evento | Mudança |
|---|---|
| `scene:create` | ganha `{ name, mapUrl?, mapWidth?, mapHeight? }` — "criar por upload" vira uma chamada só (hoje seria `create` + `setMap`, com um mapa vazio piscando na lista) e já grava `order` no fim da lista |
| `scene:activate` | ganha `{ sceneId, moveTokenIds?: string[], dropPoint?: {x,y} }` (§8) |
| `combat:*` (todos) | ganham `sceneId` no payload (§7) |
| `combat:updated` | vira `{ sceneId, combat }` (§5) |

### Novos (servidor → cliente)

| Evento | Payload |
|---|---|
| `scene:deleted` | `{ sceneId }` (cliente tira da lista e, se estava vendo, vai para o ativo) |
| `scene:reordered` | `{ order: [{ sceneId, order }] }` (só os pares, não a lista de `Scene` inteira) |

`room:activeSceneChanged { sceneId }` continua igual — o que muda é o que o cliente faz com ele (§4):
em vez de reemitir `room:join`, chama `scene:enter`.

---

## 7. Combate por mapa (tirar o acoplamento com "mapa ativo")

Hoje o banco já permite um combate por mapa, mas os handlers não: `combat:start` chama
`requireActiveScene` e todo o resto (`next`, `prev`, `roll`, `end`, ...) chama `requireActiveCombat`,
que busca `room.activeSceneId`. Ou seja: ativar outro mapa hoje deixa o combate do mapa anterior
inacessível (ele não é encerrado, só fica órfão até voltar).

Mudanças:

1. **`requireActiveScene` some.** `combat:start` passa a exigir só que o mapa seja da sala e não esteja
   apagado (`requireScene`, que já existe).
2. **`requireActiveCombat(roomId)` vira `requireCombatOfScene(roomId, sceneId)`.** Todo payload de
   `combat:*` ganha `sceneId` — o cliente manda o mapa que está vendo. É explícito, valida igual aos
   outros campos e ainda corrige um problema latente de hoje (dois GMs, cliente com estado velho).
3. **Permissão de jogador**: `combat:roll`/`delay`/`resume` de jogador só valem no mapa ativo (ele não
   deveria nem saber dos outros). Mesma checagem do §11.
4. **`services/combat.ts#emitCombat`** (linha ~143, que hoje carrega o combate da cena ativa) passa a
   receber o `sceneId` de quem chamou; a filtragem por visibilidade/névoa continua idêntica.
5. **Painel de combate**: mostra o combate do **mapa visitado**. Se não há combate aqui mas há em
   outro mapa (`scene:list` → `combatStatus != null`), mostra a linha:
   > _Combate em andamento em **Caverna dos Goblins**._ **[Ir para lá]**
6. Nada de encerrar combate automaticamente ao trocar de mapa — é justamente o comportamento pedido
   ("ativar outro não encerra o anterior"). A expiração de condição por rodada já usa
   `combat.sceneId`, então continua certa sem tocar nela.

---

## 8. Ativar um mapa: o diálogo "Levar para o mapa"

Clicar em **Ativar** (no painel ou na faixa) abre um diálogo antes de qualquer coisa acontecer:

```
Levar para o mapa "Caverna dos Goblins"

[x] Thalia (jogador: Ana)        ← ficha de jogador: pré-marcado
[x] Rurik (jogador: Bruno)       ← idem
[x] Mula de carga                ← estava selecionado no mapa
[ ] Goblin 1
[ ] Goblin 2
[ ] Taverneiro

3 de 6 tokens serão movidos. Eles saem deste mapa (não é cópia) e mantêm PV, condições e ficha.
⚠ Thalia e Rurik estão no combate deste mapa e sairão dele.

[Cancelar]  [Ativar e levar]   [Ativar sem levar ninguém]
```

**Pré-marcação** (função pura em shared, testável — §15):

```ts
pickTokensToCarry({ tokens, selectedIds, characters }): { tokenId, reason: "player" | "selected" }[]
```

Marca por padrão: (a) token com `ownerId != null` (é de um jogador), (b) token com `characterId` de
uma ficha `kind: "pc"` (personagem de jogador mesmo sem dono no token), (c) token em `selectedIds` (o
que o GM tinha selecionado no mapa quando clicou em Ativar). O GM ajusta livremente.

**O que o servidor faz** (`scene:activate { sceneId, moveTokenIds, dropPoint? }`), tudo numa
`prisma.$transaction`:

1. Valida: mapa existe, é da sala, não está apagado; cada `moveTokenIds` pertence ao mapa **ativo
   atual** e não está apagado (mover token de um terceiro mapa não faz sentido aqui).
2. Calcula as posições no destino com `findFreeCells` — a **mesma** espiral do spawn de criaturas —
   a partir de `scene.arrival ?? payload.dropPoint ?? centro do mapa` (§9), pulando células ocupadas
   e presa às bordas.
3. Tira cada token movido do combate do mapa de origem, reusando
   `prepareTokenRemovalFromCombat` (que já ajusta `round`/`activeCombatantId`/`order` quando o
   removido era o da vez) — o mesmo caminho de apagar token.
4. `update` de cada token: `sceneId` novo + `x`/`y` novos. **Nada mais muda** — `hp`, `conditions`,
   `characterId`, `ownerId`, tamanho e imagem vão junto de graça, que é o "mantendo PV, condições e
   ficha" do pedido.
5. `room.activeSceneId = sceneId`.

Broadcasts, na ordem: `token:updated` de cada token movido (o cliente tem a store achatada por id, e o
`sceneId` novo no próprio payload já faz o token sumir do mapa velho e aparecer no novo — sem evento
novo), `combat:updated` do mapa de origem se ele tinha combate, e por fim
`room:activeSceneChanged { sceneId }`.

O cliente que ativou já muda `viewingSceneId` otimisticamente e chama `scene:enter` do destino.

**Aviso de combate** no diálogo: se algum marcado é combatente do combate deste mapa, a linha ⚠
aparece. Não bloqueia — só avisa, como pedido.

---

## 9. Ponto de chegada

- `Scene.arrival: {x, y} | null`, em **pixels do mapa** (convenção do projeto para tudo que é posição).
- Definido pelo GM: botão "Definir ponto de chegada" no menu do card do mapa (ou no painel do mapa
  aberto) → o próximo clique no canvas grava (`scene:setArrival`); "Remover" limpa.
- Desenho: um pino/bandeira pequeno no canvas, **só para o GM**, na camada dos tokens que ele
  controla. Não é um token, não entra em nenhuma lista.
- Sem ponto de chegada: o cliente manda `dropPoint` = centro da área visível **do mapa de destino** se
  ele já esteve lá nesta sessão (o caso comum: o GM preparou o mapa e clicou em Ativar); se não tiver
  essa informação, omite e o servidor usa o centro do mapa (`mapWidth/2, mapHeight/2`, com
  `DEFAULT_MAP_SIZE` quando não há imagem).
- O servidor **nunca** confia nas posições do cliente: recebe no máximo um ponto e roda a espiral ele
  mesmo, exatamente como em `compendium:spawn-creature`.

---

## 10. Apagar mapa

### 10.1 Regras

- **Mapa ativo: bloqueado.** Ack de erro "Ative outro mapa antes de apagar este." (a alternativa —
  eleger outro mapa automaticamente — teleportaria a mesa inteira sem o GM pedir).
- **Último mapa da sala: bloqueado** pelo mesmo motivo (é sempre o ativo, mas vale a mensagem própria:
  "A sala precisa de pelo menos um mapa.").
- **Mapa com token de jogador**: primeira chamada devolve
  `{ ok: false, error: "needs-confirm", playerTokens: [...] }`; a UI pergunta
  _"Este mapa tem 2 tokens de jogador. Apagar move Thalia e Rurik para o mapa ativo (Taverna). Continuar?"_;
  o cliente reenvia com `confirmMovePlayerTokens: true` e o servidor **move** esses tokens para o mapa
  ativo (mesma mecânica de §8: espiral no ponto de chegada do ativo, saem do combate do mapa apagado)
  antes de marcar o mapa como apagado. Ninguém perde um personagem dentro de um mapa apagado.
- Tokens de NPC/monstro **vão junto** com o mapa (ficam com ele, soft-deletados por tabela — ver
  abaixo) e voltam se o GM desfizer.

### 10.2 Soft delete, igual a token

`Scene.deletedAt = new Date()`. A linha e tudo que pende dela (tokens, combate, combatentes) continuam
no banco, então desfazer é só limpar o campo. Quem passa a filtrar `deletedAt: null`:

- `services/snapshot.ts` (lista de mapas);
- `socket/scene.ts#requireScene` (vale para `setMap`, `updateGrid`, `rename`, `duplicate`, `activate`,
  `enter`, `setArrival`);
- `socket/fog.ts`, `socket/combat.ts`, `socket/compendium.ts`, `socket/ruler.ts` — todos passam pelo
  `requireScene`, então ganham de graça se a filtragem estiver lá dentro;
- `scene:list` e a limpeza de 30 dias (`services/cleanup.ts` ganha o hard delete de mapa; os tokens
  caem por `onDelete: Cascade`).

### 10.3 Entrada no histórico de desfazer

Só **apagar mapa** entra na pilha (§9.6 do SPEC), como pedido. A entrada guarda o que precisa para
voltar:

```ts
{
  summary: 'apagar o mapa "Caverna dos Goblins"',
  revert: // deletedAt = null + devolve os tokens de jogador movidos (sceneId/x/y antigos,
          // e o combate do mapa apagado se eles saíram dele)
  apply:  // refaz: move de novo + deletedAt = agora
}
```

Como as premissas são reconferidas antes de escrever (padrão do `history.ts`), se o mapa ativo mudou
ou um token movido foi apagado no meio, a entrada é descartada com ack de erro — igual ao resto.

**Não entram na pilha**: criar, renomear, duplicar, reordenar e ativar. Justificativa: as quatro
primeiras são triviais de desfazer à mão (renomear de volta, apagar a cópia) e ativar tem efeito
colateral de mover tokens — um Ctrl+Z que teleporta a mesa de volta no meio da sessão é mais assustador
que útil. Fica anotado no backlog se incomodar na prática.

---

## 11. Permissões (resumo)

| Ação | GM | Jogador |
|---|---|---|
| `scene:enter` | qualquer mapa da sala | só o ativo |
| `scene:create/rename/duplicate/delete/reorder/setArrival/activate/setMap/updateGrid` | sim | não |
| `token:*`, `fog:*`, `combat:*`, `ruler:update` | no mapa que estiver vendo | **só no mapa ativo** |

A última linha é nova e vale a pena: hoje "o mapa" era único, então não existia a pergunta. O servidor
passa a recusar `token:update` de jogador cujo token está num mapa não-ativo ("Este token não está no
mapa atual"). É defesa em profundidade — o cliente honesto nem tem esses ids.

---

## 12. Ordem dos mapas

- `Scene.order`, ordenação `order asc, createdAt asc` (o `createdAt` desempata mapas criados no mesmo
  milissegundo/backfill).
- Criar: `order` = (maior `order` da sala) + 1. Duplicar: a cópia entra **logo depois** do original e
  os seguintes são renumerados.
- `scene:reorder { sceneIds }` recebe a **lista completa** (mesmo contrato de `combat:reorder`, que já
  existe e o GM já conhece): o servidor confere que o conjunto bate exatamente com os mapas não
  apagados da sala e renumera `0..n-1` num `$transaction`. Lista incompleta ou com id estranho → ack de
  erro, nada é escrito (evita que dois GMs arrastando ao mesmo tempo embaralhem a lista).

---

## 13. Painel "Mapas" (GM)

**Onde**: quarta aba do `SidePanel` (`'chat' | 'initiative' | 'characters' | 'maps'`), visível só para
o GM. Coerente com o resto da UI e não rouba espaço do canvas como um modal.

**Cabeçalho**: `[+ Novo mapa]` (cria vazio, nome "Mapa N") e `[↑ Novo por upload]` (abre o seletor de
arquivo → `POST /api/upload` → `scene:create` com `mapUrl/mapWidth/mapHeight` já preenchidos).

**Card de cada mapa** (arrastável para reordenar):

```
┌──────────────────────────────────────┐
│ [miniatura 160×90]  Taverna          │
│                     8 tokens  ⚔ ativo│
│                     ● ATIVO   ◉ vendo│
│                              [Ativar]│  ← "Ativar" some no mapa já ativo
└──────────────────────────────────────┘   menu ⋯: Renomear · Duplicar ·
                                            Definir ponto de chegada · Apagar
```

- **Badge "Ativo"**: o mapa que a mesa está vendo. **Badge "Vendo"**: onde este GM está (some quando
  coincide com o ativo).
- **Contagem de tokens** e o ícone de combate (⚔ com a cor pelo `combatStatus`) vêm do `scene:list`
  (§3), buscado quando a aba abre e reatualizado em `scene:created/updated/deleted/reordered`,
  `room:activeSceneChanged` e num debounce (~1 s) depois de eventos de token/combate.
- **Clique no card** = `scene:enter` (navegar sem ativar). **Ativar** = diálogo do §8.
- **Renomear** inline (input no lugar do nome, commit no blur/Enter — mesmo padrão dos campos da
  ficha).
- **Arrastar para reordenar**: reordena otimisticamente e emite `scene:reorder`; ack de erro reverte
  (regra geral do §6 do SPEC).

---

## 14. Miniaturas (geradas no cliente, cacheadas)

O servidor não vai virar processador de imagem por causa de uma listinha — a imagem do mapa já está no
navegador (ou é baixável de `/uploads/`).

- **Geração**: ao renderizar um card cuja miniatura não está em cache, carrega `scene.mapUrl` (mesmo
  `lib/useImage.ts` de sempre), desenha num `<canvas>` fora da tela em ~160 px de largura mantendo a
  proporção e exporta `toDataURL("image/jpeg", 0.6)` (~8–20 KB). Uma por vez, sob demanda — nada de
  gerar 20 de uma vez ao abrir a aba.
- **Sem imagem** (`mapUrl = null`): não gera nada; o card mostra um placeholder com o ícone de grid e
  as dimensões.
- **Cache**: `localStorage`, chave `vtt:thumb:<sceneId>` guardando `{ mapUrl, dataUrl, at }` — a
  `mapUrl` na chave/valor é o que invalida quando o GM troca a imagem do mapa. Limite de ~40 entradas
  com descarte do mais antigo (LRU simples), e **tudo dentro de `try/catch`**: estourar a cota do
  `localStorage` não pode derrubar o painel, só faz a miniatura ser gerada de novo depois.
- **Por que não IndexedDB**: mais código e mais conceitos (transações, versões) para guardar algumas
  dezenas de KB descartáveis. Se um dia as miniaturas ficarem grandes ou numerosas, migrar é local a
  um arquivo (`lib/thumbnails.ts`).

---

## 15. Testes (lógica pura, shared/server)

Novo módulo `packages/shared/src/rules/scenes.ts` + `scenes.test.ts`:

| Função | Casos testados |
|---|---|
| `orderScenes(scenes)` | ordena por `order` e desempata por `createdAt`; estável com `order` repetido (dados legados) |
| `nextSceneOrder(scenes)` | lista vazia → 0; ignora apagados; sempre maior que todos |
| `reorderScenes(current, requestedIds)` | renumera 0..n-1; rejeita id faltando, id sobrando e id de outra sala; não muda nada em caso de erro |
| `duplicateScene(scene, { id, name, order })` | copia `mapUrl/mapWidth/mapHeight`, `grid`, `fog` (todas as shapes) e `arrival`; **não** copia tokens nem combate (não existem no tipo — o teste garante que a assinatura é só de `Scene`); `deletedAt`/`id` novos |
| `duplicateSceneName(existing, original)` | "Taverna" → "Cópia de Taverna"; de novo → "Cópia de Taverna (2)"; respeita o limite de 80 chars do schema |
| `pickTokensToCarry({ tokens, selectedIds, characters })` | pré-marca token com `ownerId`; pré-marca token de ficha `kind: "pc"` sem dono; pré-marca selecionado; não duplica quando os dois valem; não marca NPC não selecionado; token invisível de jogador continua marcado |
| `canDeleteScene({ scene, room, tokens })` | mapa ativo → `{ blocked: "active" }`; último mapa → `{ blocked: "last" }`; com token de jogador → `{ needsConfirm, playerTokenIds }`; caso simples → `{ ok: true }` |

No servidor (`apps/server/src/services/*.test.ts`, seguindo `history.test.ts`/`applyDamage.test.ts`,
que testam helpers puros sem banco):

- `sceneVisibility`/regra de broadcast do §5: "GM sempre; jogador só no mapa ativo" — tabela de casos.
- Invariante do mapa ativo: `activeSceneId` sempre aponta para um mapa não apagado da sala (função de
  checagem usada por `scene:delete` e `scene:activate`).
- Entrada de histórico de apagar mapa: `revert` devolve `deletedAt` e os tokens movidos às posições
  antigas (mesmo estilo dos testes de `history.test.ts`).

E o teste que já existe (`packages/shared/src/test/systems.test.ts`) continua passando sem mudança —
nada aqui toca JSON de sistema.

---

## 16. Ordem de implementação (um passo = um commit)

1. **shared**: `rules/scenes.ts` + testes, campos novos em `SceneSchema`, `SceneListItemSchema`,
   payloads e assinaturas em `events.ts` (inclusive `combat:updated` virando `{ sceneId, combat }`).
2. **server (banco + CRUD)**: migration `scene_order_soft_delete_arrival`; `scene:rename/duplicate/
   delete/reorder/setArrival/list`; `scene:create` com mapa; filtro `deletedAt: null` em tudo;
   histórico de apagar.
3. **server (por mapa)**: `scene:enter`; regra de broadcast do §5; `sceneId` em todo `combat:*` e
   morte de `requireActiveScene`/`requireActiveCombat`; permissão de jogador (§11).
4. **server (ativar)**: `scene:activate` com `moveTokenIds`/`dropPoint`, espiral e saída do combate.
5. **web (estado)**: `viewingSceneId` + `selectViewedScene` em todo lugar, `combat.byScene`,
   `scene:enter` no lugar do re-`room:join`, reação a `activeSceneChanged` sem F5.
6. **web (painel)**: aba "Mapas", cards, criar/renomear/duplicar/apagar/reordenar, miniaturas, faixa
   "Você está em X".
7. **web (ativar)**: diálogo "Levar para o mapa" + ponto de chegada no canvas.
8. **textos + docs**: renomeação para "mapa" (§1), SPEC atualizado (§18), backlog.

Cada passo termina com `make typecheck && make test` verdes, como sempre.

---

## 17. Riscos e pontos que podem mudar na implementação

- **Tamanho da store de tokens**: o GM que visita 10 mapas acumula os tokens dos 10 na memória. Não é
  problema real (tokens são pequenos), mas se virar, dá para descartar mapas não visitados há um tempo.
- **`combat:updated` mudando de assinatura** toca `bindSocket.ts` e a `CombatPanel` — é o ponto de
  maior chance de erro de digitação; o `typecheck` pega tudo.
- **Dois GMs** em mapas diferentes: funciona por construção (o estado é do cliente), mas a faixa de
  aviso só fala do mapa ativo, não de "o outro GM está no mapa Y". Aceitável.
- **Miniatura de mapa grande** (imagem de 8000 px): desenhar num canvas de 160 px é rápido, mas baixar
  a imagem inteira só para a miniatura é caro na primeira vez. Como o cache resolve a partir da
  segunda, fica assim; se incomodar, o servidor pode gerar uma miniatura no upload (backlog).
- **`dropPoint` do cliente**: é só uma sugestão; o servidor sempre valida e reposiciona. Sem risco de
  token fora do mapa.

---

## 18. SPEC e backlog

No **mesmo commit** da implementação (regra do CLAUDE.md), o SPEC muda em:

- **§1**: tirar "múltiplos mapas simultâneos" da lista de "fora do MVP" (vira §9.7) e acrescentar a
  nota de nomenclatura do §1 deste plano ("na UI é **mapa**; `Scene` é o nome interno; **cena** é a
  unidade de tempo de jogo").
- **§3.2**: o mapa deixa de ser único; "Renomear cena está fora do MVP" sai.
- **§3.5**: combate por mapa deixa de exigir mapa ativo; `combat:*` ganha `sceneId`.
- **§4**: `Scene` com `order`, `deletedAt`, `arrival`; nota de que `activeSceneId` sempre aponta para
  um mapa vivo.
- **§5**: eventos novos/alterados (§6 deste plano), incluindo `combat:updated` com `sceneId`.
- **§7**: `components/MapsPanel.tsx`, `components/CarryTokensDialog.tsx`, `lib/thumbnails.ts`,
  `rules/scenes.ts`.
- **§8**: cai a limitação "só existe UI para uma cena por sala" e "combate só existe na cena ativa".
- **§9.6**: apagar mapa entra na lista de ações desfazíveis.
- **§9.7 (novo)**: seção descrevendo múltiplos mapas, apontando para este plano.

No **backlog** (já adicionado, independente da aprovação deste plano):

- "Encerrar cena": expira durações "até o fim da cena" de magias/poderes/condições.
