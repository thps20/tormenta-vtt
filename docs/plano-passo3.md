# Plano: passo 3 — poderes e magias com ativação

> Implementa a fase 3 de `docs/modelo-personagem.md` §3.4: ativação de poderes/magias com custo de recurso,
> CD de resistência e card no chat. Escrito em 06/09/2026, antes da implementação.

**Princípio:** nada de `"pm"`, `"passive"` ou `"Conjurar"` no código. Tudo isso entra no `tormenta20.json`
e o código só lê.

## Commit 1. `shared`: regras de ativação no schema + JSON

Novos campos em `SystemDefinitionSchema` e no `tormenta20.json`:

- `activation.resource: "pm"`. Recurso que o custo desconta. O código desconta "do recurso apontado", sem saber que é PM.
- `activation.minCost: 1`. Piso do custo depois dos modificadores (regra de Tormenta: reduções não levam abaixo de 1 PM).
- `activation.saveDc: "10 + {halfLevel} + {saveAttr} + {saveBonus}"`. Fórmula da CD, com dois placeholders contextuais.
  `{saveAttr}` é o atributo do `save.attribute` do item, ou o atributo de conjuração da ficha se o item não sobrescrever.
  `{saveBonus}` é o `save.bonus` do item. Fica separada de `derived.dc` porque essa é a CD genérica exibida na ficha;
  a do item pode trocar o atributo.
- `activation.executions[].passive: true` na opção "Passiva". Assim o código sabe qual execução é passiva sem conhecer a chave.
- `itemKinds[].useLabel`: `"Conjurar"` em magia, `"Usar"` nos outros (default).
- `activation.spellcastingLabel: "Atributo de conjuração"`, rótulo do campo do cabeçalho.
- Gramática de modificador ganha `resource.<key>.cost` (`{ kind: "resourceCost" }`), listado no select de modificadores
  como "PM (custo)".
- `validateSystemDefinition` confere `resource` e os placeholders de `saveDc`. Testes de gramática e de JSON.

## Commit 2. `shared`: `rules/activation.ts` + testes

Funções puras, sem banco:

- `effectiveCost(def, data, item)`: custo base 0 continua 0 (modificador não cria custo em habilidade gratuita);
  senão `max(minCost, custo base + Σ modificadores resource.<res>.cost)`.
- `saveDcFor(def, computed, item)`: avalia `activation.saveDc`.
- `isPassiveItem(def, item)`: sem `activation` ou execução marcada `passive`.
- `buildItemUse(def, character, itemId)`: devolve `{ cost, resourceKey, available, saveDc, card }` ou lança `ItemUseError`
  ("PM insuficiente: precisa de 3, tem 1", com a abreviação do JSON). Também devolve a ficha com o recurso já descontado,
  para o servidor persistir.
- O **card** é dado denormalizado e agnóstico:
  `{ characterId, characterName, itemId, itemName, kindLabel, fields: [{label, value}], cost: {abbr, amount} | null,
  execution, range, duration, target, area, effect, save: {skillLabel, dc, text} | null, actions: [{id, label, kind}] }`.
  Rótulos ficam gravados na mensagem, então o histórico do chat continua legível se o item mudar.
- Testes: CD (nível 5, INT 2 → 14; `save.attribute` SAB 1 → 13; bônus +2 → 16), custo com modificador (3 → 2;
  piso `minCost` = 1; 0 fica 0), recurso insuficiente, item passivo recusado.

## Commit 3. `shared` + `server`: mensagem de chat "item" e evento `character:use-item`

- `ChatMessageSchema.kind` ganha `"item"` e o campo `item?: ItemCardSchema`.
- Prisma: coluna `item Json?` em `ChatMessage`, migration `chat_message_item_card` (`make db-migrate`).
- Evento `character:use-item { characterId, itemId }`, ack `ChatMessage`. Handler: permissão igual a `character:roll`
  (GM ou dono) → `buildItemUse` → se houver custo, grava a ficha com o recurso descontado e faz broadcast
  `character:updated` → grava e transmite `chat:message` kind `item`. Erro de recurso: ack `{ ok: false }` e nada é publicado.
- Desconto tira primeiro dos pontos temporários e depois do atual, para recursos com `hasTemp`.

## Commit 4. `web`: card no chat com botões

- `useCharacters.useItem(characterId, itemId)`: sem otimismo (igual `roll`); ack de erro vira toast.
- `ChatTab` renderiza `kind: "item"`: nome, tipo/círculo/escola (dos `fields`), custo, execução, alcance, duração,
  alvo/área, efeito, CD. Botões "Dano"/"Cura" chamam `useCharacters.roll(characterId, { type: "action", itemId, actionId })`.
  Habilitados só para GM ou dono da ficha, e só se a ficha ainda existir na store.

## Commit 5. `web`: abas Magias/Poderes

- `ItemsSection`: em tipos com `hasActivation`, item ativo ganha botão `useLabel` com o custo efetivo ao lado. Se o recurso
  atual for menor que o custo, botão fica vermelho com tooltip, e o clique ainda vai ao servidor (que recusa e o toast avisa).
- Passivos: sem botão e sem bloco de ativação. Só descrição.
- Ações de dano/cura continuam no card do item como hoje.

## Commit 6. `web`: atributo de conjuração no cabeçalho

Select com os atributos do sistema (rótulo `spellcastingLabel`), editável em modo edição e exibido em visualização.
Só aparece se o sistema declarar `activation.saveDc`.

## Commit 7. Docs

`SPEC.md` §3.6, tabela de eventos, §8; `docs/modelo-personagem.md` §3.6 fase 3 → feito.

## Decisão (06/09/2026)

Piso do custo após modificadores vem do JSON (`activation.minCost`, 1 em Tormenta), aprovado pelo dono do projeto.
