# Plano: passo 4 — classes e raças como itens

> Implementa a fase 4 de `docs/modelo-personagem.md` §3.4: classes e raças viram itens que alimentam
> nível, PV/PM e atributos. Escrito em 06/09/2026, antes da implementação.

**Princípio:** nada de `"con"`, `"hpPerLevel"` ou `"Guerreiro"` no código. Tudo isso entra no `tormenta20.json`
e o código só lê.

## Decisões de modelagem (e por quê)

1. **Como o código acha "classe" e "nível" sem conhecer chaves.** O JSON aponta:
   `level.classes = { kind: "class", levelsField: "levels", initialField: "initial" }` e
   `resources[].perLevel = { classField: "hpPerLevel", firstLevelField: "hpInitial", attribute: "con", minPerLevel: 1 }`.
   É o mesmo padrão que já existe em `perLevel.classField` e `damageAttribute.field`. `firstLevelMultiplier`
   (declarado, nunca usado) sai, porque o 1º nível usa `hpInitial` em vez de "×4".

2. **Campos estruturados de item.** `attributeBonuses`, `flexibleBonuses` e `skillsGranted` não cabem em
   `enum | number | boolean | text`. Quatro tipos novos em `ItemFieldDef.type`, com valor validado por Zod:
   - `attributeBonuses`: `{ con: 2, sab: 1, des: -1 }`.
   - `attributeChoice`: `{ amount: 1, count: 3, exclude: [], chosen: [] }`.
   - `skillGrants`: `{ fixed: ["fortitude"], choices: [{ count: 1, from: ["luta", "pontaria"], chosen: [] }, { count: 4, from: [...], chosen: [] }] }`.
     `from` vazio significa "qualquer perícia" (Humano). Cobre "Luta ou Pontaria" e "mais 4 de [lista]" do Guerreiro.
   - `size`: chave de `sizes[]`, para não duplicar a lista de tamanhos no JSON.

   **Diferença em relação ao pedido original:** a escolha fica dentro do próprio campo (`chosen`) em vez de
   `item.fields.choices`. Motivo: um item pode ter mais de uma escolha (Humano tem atributos flexíveis e perícias),
   e um campo com seu tipo se valida e se renderiza sozinho.

3. **Bônus e perícias concedidas são calculados, não gravados.** `computeCharacter` gera os modificadores
   (`attr.con +2`, origem = id do item) e marca as perícias treinadas (`grantedBy` = id do item) a partir dos itens
   ativos, do mesmo jeito que `statBonuses` só contam enquanto o item está equipado. Nada entra em
   `character.modifiers` nem em `skills[].trained`. Motivo: o servidor aplica patches rasos; se os modificadores
   fossem gravados, remover o item exigiria um gancho para limpá-los e os dois poderiam desalinhar. Remover a raça
   remove os bônus por construção. Regra genérica: qualquer item com esses campos aplica, se for não físico ou
   estiver equipado (um "Cinto da Força" funciona de graça).

4. **Fonte do nível por ficha.** No JSON, `level.source` vira `"classes"`. Por ficha, `computed.levelSource` é
   `"classes"` só quando há ao menos um item de classe e a ficha não está em modo manual; senão `"manual"` e tudo
   segue como hoje. Fichas antigas não mudam.

5. **Modo manual** = flag nova `data.manualProgression` (default `false`). Ligada, o nível volta a ser `data.level`
   e PV/PM voltam a usar `maxOverride`. Ao ligar, a UI copia o nível e os máximos calculados para os campos, para
   nada pular de valor. Quando classes mandam, `perLevel` vence `maxOverride` (senão uma ficha antiga com PV
   digitado não mudaria ao ganhar classe).

6. **PV/PM.** Para cada classe: 1º nível da classe inicial = `hpInitial + CON`; cada outro nível =
   `hpPerLevel + CON`, com piso `minPerLevel` por nível; PM = `mpPerLevel` por nível. Multiclasse soma. Usa o
   atributo já com modificadores. Se nenhuma classe estiver marcada como inicial, a primeira da lista faz esse papel.
   `resource.<key>.max` continua somando depois. `computed.resources[key].detail` guarda a conta em texto para o tooltip.

7. **Raça: no máximo 1** via `itemKinds[].maxCount: 1`, conferido no servidor em `character:update` (fonte da
   verdade) e escondendo o botão na UI. Os campos `size`, `movement` e `senses` entram na raça. `size` é aplicado
   ao tamanho da ficha quando o campo muda. `movement` e `senses` ficam só informativos, porque `derived.movement`
   ainda é a fórmula fixa "9" e regras de deslocamento não estão no escopo. O traço livre "Raça" sai de
   `traitFields`, já que a raça vira item (o texto antigo fica gravado, só não aparece).

## Commits

1. **shared: schema e JSON.** Tipos de campo novos e seus schemas de valor; `level.classes`;
   `perLevel.firstLevelField`; `itemKinds[].maxCount`; `validateSystemDefinition` confere os ponteiros.
   No `tormenta20.json`: kinds `class` e `race`, `level.source: "classes"`, `perLevel` em PV e PM.
   Este documento.
2. **shared: regras.** `rules/progression.ts` (leitores dos campos, classes, nível, PV/PM por nível, escolhas
   pendentes, `describeClasses` que devolve "Guerreiro 3 / Arcanista 2", `validateCharacterItems`);
   `computeCharacter` ganha `levelSource`, `classes`, `itemModifiers`, `skills[].grantedBy`, `resources[].detail`;
   `manualProgression` no schema da ficha; `createDefaultItem` para os tipos novos.
   Testes: Guerreiro 3 CON 2 → 36 PV e 9 PM; multiclasse Guerreiro 3 + Arcanista 2; piso de 1 PV por nível;
   raça com bônus fixos e flexíveis, remoção zera; perícias concedidas com escolha; ficha antiga sem classe
   inalterada; modo manual; limite de raça.
3. **server:** `character:update` rejeita ficha que viola `maxCount` ou usa tipo de item desconhecido.
4. **web: editor de itens.** Grade de atributos, chips de escolha (funcionam fora do modo edição, como os
   modificadores), seletor de perícias compacto, select de tamanho; badge "faltam N escolhas"; ícones para as abas
   novas; modificadores vindos de itens aparecem somente leitura na seção Modificadores.
5. **web: cabeçalho, recursos e perícias.** "Guerreiro 3 / Arcanista 2" e nível total com tooltip da soma; nível e
   PV/PM máximos somente leitura com tooltip da conta quando classes mandam; botão "Modo manual"; perícia
   concedida com checkbox travado e "Treinada por Guerreiro".
6. **docs:** SPEC §3.6 e `modelo-personagem.md` §3.6.

Cada commit passa por `make typecheck && make test`. Sem migration de banco: tudo mora no `data Json` da ficha.

## Fora do escopo

- Deslocamento e sentidos da raça alimentando `derived[]` (esperam regras de movimento).
- Poderes de classe/raça por nível, compêndios de classes e raças (Product Identity e automação pesada, ver
  `modelo-personagem.md` §3.4).
