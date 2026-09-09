# Plano: duração de condições em rodadas

> Implementa o TODO deixado em `packages/shared/src/schemas/token.ts` (preparado no plano do modo de
> combate, `docs/plano-combate.md` §8, nunca implementado): `Token.conditions` ganha duração opcional
> em rodadas, comparada a `Combat.round`. Escrito em 09/09/2026, **antes** da implementação.

**Fora deste plano:** automação de regra a partir de `conditions[].modifiers` (continua só estrutura,
sem leitura por código nenhum), condição com duração em algo que não seja rodada (turnos, minutos),
expiração em `combat:delay`/`combat:prev` (só `combat:next` expira, ver §3).

---

## 1. `packages/shared`

### Schema (`schemas/token.ts`)

Troca `conditions: KeySchema[]` por um array de `TokenConditionEntrySchema`:

```ts
export const TokenConditionSchema = z.object({
  key: KeySchema,
  /** Rodada em que a condição expira (comparado a Combat.round no combat:next). Ausente = permanente. */
  expiresRound: z.number().int().min(1).optional(),
});
export type TokenCondition = z.infer<typeof TokenConditionSchema>;

/**
 * Aceita a forma antiga (string = chave, condição permanente) e a nova ({ key, expiresRound? }).
 * z.preprocess normaliza string -> { key } antes de validar: uma ficha salva antes desta mudança
 * (Token.conditions: string[], no banco ou em qualquer lugar que ainda mande a forma antiga) continua
 * válida sem migration de dado no JSON. Depois do parse, `Token.conditions` é sempre TokenCondition[].
 */
export const TokenConditionEntrySchema = z.preprocess(
  (val) => (typeof val === "string" ? { key: val } : val),
  TokenConditionSchema,
);
```

`TokenSchema.conditions` passa a ser `z.array(TokenConditionEntrySchema).default([])`. Remove o
bloco de TODO (vira código de verdade).

### `schemas/system.ts`

`ConditionDefSchema` ganha `defaultDuration: z.number().int().min(1).optional()` — valor inicial
sugerido no campo de duração do menu (ex.: Surpreendido = 1). Não é regra automática, só um default
de UI: o GM ainda pode digitar outro valor ou deixar permanente.

### `rules/conditions.ts` (novo)

Funções puras, mesmo padrão de `rules/combat.ts` (o código não conhece nenhuma condição específica):

```ts
export interface ConditionExpiry {
  remaining: TokenCondition[];
  expired: TokenCondition[];
}

/** Condições que expiram ao virar para `round` (expiresRound <= round). Permanente nunca expira.
 *  Usada em combat:next, quando a rodada avança. */
export function expireConditions(conditions: TokenCondition[], round: number): ConditionExpiry;

/** Ao encerrar o combate com clear:true: toda condição com duração (expiresRound, não importa
 *  o valor) é removida — não vira permanente. Permanente fica. */
export function stripTimedConditions(conditions: TokenCondition[]): ConditionExpiry;

/**
 * Rodada "efetiva" pra contar duração: combate ainda rolando iniciativa (round 0, status
 * "rolling") conta como se já estivesse na rodada 1 — senão uma condição marcada antes do
 * primeiro "Próximo" teria expiresRound = 0 + N e expiraria na PRÓPRIA virada pra rodada 1
 * (combat:next de rolling pra active também dispara expireConditions), sem nunca ter valido.
 */
export function effectiveCombatRound(round: number): number {
  return Math.max(1, round);
}

/** expiresRound a partir da rodada atual do combate + duração em rodadas (N). Único ponto que
 *  deriva expiresRound — usado pelo ConditionMenu (marcar e editar duração), pra rolling nunca
 *  divergir daqui. */
export function deriveExpiresRound(round: number, durationRounds: number): number {
  return effectiveCombatRound(round) + durationRounds;
}
```

### Testes

- `schemas/token.test.ts` (novo): preprocess de string antiga vira `{ key }` sem `expiresRound`;
  forma nova passa direto; `expiresRound` inválido (0, negativo, não-inteiro) rejeita.
- `rules/conditions.test.ts` (novo): `expireConditions` remove exatamente as `expiresRound <= round`
  e mantém as demais; condição permanente nunca some, em rodada nenhuma; `stripTimedConditions` remove
  toda condição com duração independente do valor e preserva as permanentes; marcar Surpreendido
  (`defaultDuration` 1) com o combate em `"rolling"` (`round` 0) via `deriveExpiresRound(0, 1)` dá
  `expiresRound = 2` — a condição continua em `expireConditions(_, 1).remaining` (ativa durante a
  rodada 1, criada pelo primeiro `combat:next`) e só some em `expireConditions(_, 2).expired`
  (expira na virada pra rodada 2).

### `systems/tormenta20.json`

`surpreendido` ganha `"defaultDuration": 1`.

---

## 2. `apps/server`

### Prisma

`Token.conditions` sai de `String[]` (array nativo do Postgres — não guarda objeto) para `Json`,
igual a outros campos flexíveis do projeto (`grid`, `fog`, `hp`). A migration gerada automaticamente
pelo `prisma migrate dev` dropa e recria a coluna (perde dado); em vez disso a migration é **escrita
à mão**, com backfill:

```sql
ALTER TABLE "Token" ADD COLUMN "conditions_new" JSONB NOT NULL DEFAULT '[]';
UPDATE "Token" SET "conditions_new" = to_jsonb("conditions");
ALTER TABLE "Token" DROP COLUMN "conditions";
ALTER TABLE "Token" RENAME COLUMN "conditions_new" TO "conditions";
```

`to_jsonb` num `text[]` vira um array JSON de strings — o preprocess do Zod aceita cada item como
condição permanente antiga, sem perda de dado. Nome da migration: `token_conditions_duration`.

### `services/serialize.ts`

`toToken`: `conditions: TokenConditionEntrySchema.array().parse(t.conditions)` em vez de repassar
cru (o campo virou `Json`, sem tipo garantido pelo Prisma).

### `socket/token.ts`

`token:update`: `fields.conditions.some((c) => !known.has(c.key))` (antes comparava a própria
string).

### Mensagem de chat "system"

Primeiro uso de verdade de `ChatMessage{kind:"system"}` (schema já existe, `ChatTab` já renderiza,
mas nada no servidor cria uma ainda). `participantId`/`nickname` = quem disparou o evento (o GM da
sessão que chamou `combat:next`/`combat:end`) — o `ChatTab` já ignora os dois pra esse `kind` e
sempre mostra "SISTEMA", então não precisa de author nulo nem mudança de schema. `tokenId` setado
pro token afetado, pra reaproveitar o gate que já existe em `emitChatMessage`/`chatVisibility.ts`
("só quem vê o token").

### `socket/combat.ts`

- **`combat:next`**: depois de persistir o novo `round` (`startTurns`/`advanceTurn`), se ele é maior
  que o `round` de antes, carrega os tokens da cena, roda `expireConditions` em cada um. Token com
  condição expirada leva **um só** `token:updated` (mesmo se várias condições dele expiraram juntas).
  Cada condição removida vira **uma** mensagem de chat: `"Goblin: Atordoado terminou"`.
- **`combat:prev`**: sem mudança de comportamento. Comentário no código documentando que não
  restaura condição nenhuma (decisão deliberada, não esquecimento).
- **`combat:end { clear: true }`**: antes de apagar a linha do `Combat`, roda `stripTimedConditions`
  nos tokens da cena, persiste, broadcast, lista no chat (mesmo formato de mensagem das duas
  situações acima).
- **`combat:end { clear: false }`**: sem mudança — condições ficam como estão (o combate só pausa,
  visível).

---

## 3. `apps/web`

### `ConditionMenu.tsx`

Troca `active: string[]` + `onToggle(key)` por `active: TokenCondition[]` + `combatRound: number |
null` + `onChange(next: TokenCondition[])` (o menu decide a lista nova, o chamador só aplica o
patch). Com `combatRound !== null`, cada condição marcada mostra um campo numérico "duração
(rodadas)": vazio = permanente; preenchido grava `expiresRound = combatRound + N` (pré-preenchido
com `defaultDuration` ao marcar, se o JSON tiver um). Sem combate ativo, o campo some. Condição já
marcada pode ganhar, editar ou remover a duração pelo mesmo campo (mostra o restante atual,
`expiresRound - combatRound`). A conversão N → `expiresRound` usa sempre `deriveExpiresRound` do
`shared` (nunca `combatRound + N` direto no componente), pra rolling (round 0) cair no mesmo ajuste
que o teste do `shared` cobre.

**"Combate ativo"** = existe `Combat` na cena e `status !== "ended"` (inclui `"rolling"`, onde
`round` é 0 — `expiresRound` vira só `N`, sem problema).

### `VttCanvas.tsx`

Ganha prop `combat: Combat | null`. Os pontos que tratavam `token.conditions` como `string[]`
passam a usar `.key` (tooltip por geometria, toggle do menu, resolução de `ConditionDef`). O badge
do token (`ConditionBadge`/`ConditionMarkers`) desenha um número pequeno no canto quando a condição
tem `expiresRound` (rodadas restantes = `expiresRound - combat.round`, no mínimo 0), e o tooltip
ganha o sufixo "· N rodadas".

### `CombatPanel.tsx`

Novas props `tokens: Token[]` e `conditions: ConditionDef[]` (as `ConditionDef[]` do sistema, pra
resolver ícone/cor a partir da chave). Cada linha de combatente ganha os ícones das condições do
token dele (mesmo estilo pequeno do `ConditionMenu`, DOM em vez de Konva), com o número de rodadas
restantes ao lado/sobreposto e tooltip "Atordoado · 2 rodadas".

### `SidePanel.tsx` / `RoomPage.tsx`

Repassam `tokens` e `systemDef.conditions` pro `CombatPanel`, e `combat` pro `VttCanvas`.

### `TokenInspector.tsx`

Sem mudança — só lê `token.conditions.length`, que continua funcionando com o array de objetos.

---

## 4. Decisões tomadas (avisar se for pra mudar)

- Duração conta em **rodadas do combate da cena**, nunca em "turnos" ou tempo real.
- Só `combat:next` expira condição, mesmo `combat:delay` também podendo empurrar a rodada
  internamente — como pedido.
- Badge de rodadas restantes usa `combat.round` mesmo com combate `"ended"` sem `clear` (fica
  congelado no valor de quando encerrou); se já passou do previsto, mostra 0 em vez de negativo.
- Mensagem de chat: uma por par (token, condição) expirada, não uma agregada por token.
- **Ajuste do dono do projeto (09/09):** `expiresRound` derivado com o combate em `"rolling"`
  (`round` 0) trata a rodada atual como 1, não como 0 — `deriveExpiresRound`/`effectiveCombatRound`
  em `rules/conditions.ts` centralizam essa regra pra todo lugar que derive `expiresRound` usar a
  mesma conta.

---

## 5. Commits (pequenos, nesta ordem)

1. shared: schema (`TokenCondition` + preprocess) + `rules/conditions.ts` + testes + `defaultDuration`
   no JSON do sistema
2. server: migration Prisma (`token_conditions_duration`) + `serialize.ts` + validação em
   `token:update`
3. server: expiração em `combat:next` (+ mensagem de chat)
4. server: limpeza em `combat:end { clear: true }` (+ mensagem de chat)
5. web: `ConditionMenu` com campo de duração
6. web: badge de rodadas restantes no token (`VttCanvas`)
7. web: ícones de condição no painel de combate (`CombatPanel`)
8. `docs/SPEC.md` (§3.3 Token, §3.5 combat:next/end)
