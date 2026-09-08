# Análise: "Aplicar" não aparece no card de ataque com arma

> Investigado em 07/09/2026, a pedido do dono do projeto, depois do card de "Aplicar" (dano/cura em
> tokens, ver `docs/SPEC.md` §3.3) ter entrado. Escrito antes de qualquer mudança de código.

## O relato

"O botão 'Aplicar' funciona nos cards de magia e poder, mas não aparece no card de ataque com arma."

## O que a investigação encontrou

**Não existe um caminho de código diferente para arma vs. magia/poder.** Todo item — arma, magia ou
poder — usa exatamente o mesmo fluxo pra virar card no chat:

1. Clique num botão de ação do item (`ItemsSection.tsx`) → `onRoll(actionId)`.
2. `characters.roll()` (store) → evento `character:roll` → servidor.
3. `buildCharacterRoll` (`packages/shared/src/rules/rolls.ts:117-155`) monta a fórmula.
4. `createRollMessage` (`apps/server/src/services/rolls.ts`) publica `ChatMessage{kind:"roll"}`.
5. `ChatTab.tsx` renderiza o card; `ApplyDamageButton` aparece só quando `roll.damage` tem parcelas.

O que muda de um item pro outro não é "arma vs. magia", é o **tipo da ação** (`action.kind`,
`packages/shared/src/schemas/character.ts:35-70`), em `buildCharacterRoll`
(`packages/shared/src/rules/rolls.ts:128-156`):

| `action.kind` | preenche `roll.damage[]`? | "Aplicar" aparece? |
|---|---|---|
| `attack` (rolar pra acertar) | não | não |
| `damage` (rolar o dano) | sim | **sim** |
| `check` (teste) | não | não (esperado — é só um teste) |
| `formula` (fórmula livre) | não | não |

Toda arma ganha **automaticamente duas ações** (`createDefaultItem`,
`packages/shared/src/rules/defaults.ts:29-35`): "Ataque" (`attack`, só o d20 pra acertar — sem dano
nenhum pra aplicar) e "Dano" (`damage`, com `damage[]` preenchido). O card de "Dano" da arma já mostra
"Aplicar" hoje, do mesmo jeito que o de uma magia — testado e confirmado.

Magias quase nunca têm uma ação `attack` separada (`spells.json` não tem nenhuma); toda rolagem de
magia que causa dano já sai com `damage[]` de cara. Por isso o padrão "duplo botão, um deles sem
Aplicar" fica muito mais visível em arma (que sempre tem os dois) do que em magia — mas o mesmo
aconteceria com um poder que tivesse uma ação de ataque (`powers.json` tem 4 dessas).

**Confirmado com o dono do projeto:** o clique que não mostrou "Aplicar" foi no botão "Ataque", não no
"Dano". Isso é o comportamento esperado — acertar e causar dano são rolagens separadas no T20, por
design, e não há dano nenhum pra aplicar antes da rolagem de dano acontecer.

## Decisão

**Não mexer.** "Ataque" e "Dano" continuam duas rolagens separadas, como hoje; "Aplicar" continua só no
card que efetivamente tem `damage[]`. Nenhum código muda por causa deste relato — não é um bug.

## Outros lugares com a mesma lacuna (levantados, nada implementado ainda)

A causa de fundo por trás de qualquer lacuna real é sempre a mesma: só a ação `damage` carrega
`damageType` e vira `roll.damage[]`. A ação `formula` (fórmula livre, `packages/shared/src/schemas/character.ts:63-67`)
nunca carrega isso, mesmo quando na prática é um dano ou cura escrito à mão pelo autor do item. Isso
aparece em três pedidos do dono do projeto:

1. **Ação "Fórmula" livre em qualquer item.** É o tipo mais genérico do editor da ficha
   (`ItemsSection.tsx`); se o autor escreve ali algo como "1d6 de dano refletido", a rolagem sai sem
   `damage[]` — sem Aplicar — porque `formula` nunca teve como declarar um tipo de dano.
2. **Dano de item consumível.** `createDefaultItem` só cria as ações automáticas "Ataque"+"Dano" pra
   itens "arma-like" (que têm o campo de atributo de dano, `damageAttribute`); um consumível comum só
   ganha uma ação `damage` se alguém adicionar manualmente no editor. Montado como `formula` (o tipo
   mais flexível, e por isso o mais tentador pra quem está criando o item), cai na mesma lacuna do
   item 1.
3. **Dano/cura de reação.** Não existe um tipo de ação "reação" à parte — reações usam as mesmas 4
   ações de sempre, só com um rótulo de execução diferente (`activation.execution`). Já funcionam se a
   ação for `damage`; mesma lacuna se for `formula`.

## Plano proposto (aguardando aprovação)

Deixar a ação `formula` aceitar um `damageType` **opcional**. Quando presente, a rolagem passa a
preencher `roll.damage[]` (uma parcela só, com a fórmula exatamente como o autor escreveu) — igual o
suficiente pra ligar o "Aplicar", sem herdar o resto do comportamento de `damage` (soma de atributo,
bônus, aprimoramentos). Fórmulas livres sem tipo continuam exatamente como estão hoje: nada quebra.

**Por que não replicar `damage` inteiro em `formula`:** o propósito de `formula` é ser a via de escape
pra qualquer coisa que não caiba nos outros três tipos (`attack`/`damage`/`check`) — ela não soma
atributo automaticamente, não tem bônus próprio e não passa pelos aprimoramentos
(`applyDamageEnhancements`). Só ligar `damage[]`/Aplicar não muda esse contrato; herdar atributo+bônus+
aprimoramentos mudaria, e aí o tipo deixaria de servir pro que serve hoje (fórmula exatamente como
escrita).

### Commits

1. **shared** — `FormulaActionBody` ganha `damageType: KeySchema.nullable().default(null)`
   (`packages/shared/src/schemas/character.ts`); `buildCharacterRoll` (case `"formula"`,
   `packages/shared/src/rules/rolls.ts`) preenche `damage: [{ formula, damageType: action.damageType }]`
   quando `damageType` não é `null`. Teste em `rules.test.ts` cobrindo os dois casos (com e sem tipo).
2. **web** — `ItemsSection.tsx`: o editor da ação "Fórmula" ganha o mesmo seletor de tipo de dano que a
   ação "Dano" já usa (`damageType`, opcional). O preview do botão (`built.damage ? <DamageFormula/> :
   built.formula`) já é genérico — não precisa mudar.
3. **docs** — atualiza `SPEC.md` (tabela de ações do item, §3.6) com o novo campo.

### Fora do escopo deste plano (fica só registrado)

- **Auditar o compêndio** (`consumables.json`, `powers.json`, itens homebrew salvos) por ações `formula`
  que deveriam ser `damage` ou `formula`+`damageType` — decisão de conteúdo, item por item, não uma
  mudança de código. Só faz sentido depois do plano acima existir.
- **Unificar Ataque+Dano na UI** (ex.: o card de "Ataque" oferecer um atalho pra rolar/aplicar o "Dano"
  companheiro da mesma arma) — considerado e descartado nesta rodada; o dono do projeto preferiu manter
  os dois botões separados como estão.
