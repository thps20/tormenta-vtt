# Revisão: criaturas do compêndio para o mapa

> Passada de revisão depois de implementar os 12 passos de `docs/plano-criaturas.md` (aprovado sem
> alterações em 08/09/2026). Branch `feat/criaturas-compendio`, 12 commits (`32aafb3`..`5beac0a`),
> `make typecheck && make test` limpos a cada passo. Este documento compara implementação vs. plano
> e cobre os casos de borda pedidos.

## 1. Implementação vs. plano

Tudo saiu como planejado; nenhuma parte ficou de fora. As únicas diferenças em relação ao texto do
plano são acréscimos pequenos, sinalizados abaixo — nenhuma mudou o desenho aprovado.

| # | Passo do plano | Como saiu |
|---|---|---|
| 1 | Bloco `creatures` + `traitFields` `nd`/`deslocamentos` + `damageResponses` | Igual ao plano. Único cuidado extra: a primeira tentativa de editar `tormenta20.json` usou um script Python que reformatou o arquivo inteiro (indentação diferente da existente); revertido e refeito com edições cirúrgicas para não gerar um diff de 1200+ linhas por 6 linhas de conteúdo. |
| 2 | União `CompendiumEntry`, `CreatureSheetSchema`, `validateCreatureEntry`, `entryToCharacter` | Igual ao plano. Efeito colateral (esperado pelo próprio plano): `Partial<CompendiumEntry>` no importador colapsou para os campos comuns da união (`kind`, `fields`, `actions`... sumiram do tipo) — TypeScript sinalizou ~60 erros; corrigido trocando para `Partial<CompendiumItemEntry>` (tipo concreto, não união) no `Draft` do importador. |
| 3 | `findFreeCells`/`numberedNames` + `VttCanvas` usando | Igual ao plano, incluindo a refatoração do `findFreeSpot` antigo (1×1, só pixels) para um caso particular da função nova. |
| 4 | Importador `ameacas` → `creatures.json` | Igual ao plano. 83 criaturas, mapeamento e truque do "outros" na perícia conferidos individualmente (ex.: "Aparição" ND 5, 0 divergência em 28 perícias). Só 3 TODOs (variante "ofi1" de ofício). `convocacoes` deixado de fora, como decidido antes do plano (`docs/backlog.md`). |
| 5 | `compendium:list` com `{ entries, roomIds }` + filtro por papel | Igual ao plano. |
| 6 | `compendium:spawn-creature`: handler, transação, broadcast | Igual ao plano. **Bug pego e corrigido em teste ao vivo**: o fallback de mapa sem imagem usava `cellSize` em vez de um tamanho de mapa (ver §2.3) — token sempre nascia em (0,0). Corrigido com `DEFAULT_MAP_SIZE` compartilhado em `packages/shared`. |
| 7 | Paleta contextual: contexto na store, modo `"map"`, chips, atalho | Igual ao plano. |
| 8 | `CreaturePreview` (quantidade + invisível) e soltura por Enter | Igual ao plano. |
| 9 | Alvo de soltura "mapa" + fantasma das células | Igual ao plano. |
| 10 | `suggestDamage` + pré-seleção/aviso no `ApplyDamageButton` | Igual ao plano (Opção 1 da sua resposta: só sugere, servidor não muda). |
| 11 | Contrato `docs/tipos-ficha-rapida.md` + `NpcQuickCard` mínimo | Igual ao plano (card no lugar do `TokenInspector`, conforme sua resposta). **Acréscimo não previsto no contrato**: `onOpenTokenInspector` — o card precisa de alguma forma de voltar para o `TokenInspector` (botão "Token"); é implementação, não faz parte do contrato que vai para o AI Studio (documentado como tal no próprio arquivo). |
| 12 | `docs/SPEC.md`: §9.5 nova, §3.3/§5/§8 atualizadas | Igual ao plano. |

## 2. Casos de borda

### 2.1 Soltar com quantidade maior que as células livres no raio

**Cenário**: GM pede 10 cópias, mas só há espaço para 4 dentro do raio de busca (`maxRadius = 12`
anéis, ~625 células candidatas) — mapa pequeno, muitos tokens já colocados, ou os dois.

**O que acontece**: `findFreeCells` (`packages/shared/src/rules/placement.ts`) simplesmente para de
achar posições e devolve um array **menor** que `count` — não lança erro, não trava a transação.
O handler (`apps/server/src/socket/compendium.ts`) usa `positions.length` (não `data.count`) para
`numberedNames` e para o laço de criação: `// Pode devolver menos que count (espiral estourou o raio
máximo): cria só o que coube.`. Resultado: o GM pediu 10, recebe as 4 que couberam, sem mensagem de
erro nem aviso na UI de que fechou por baixo do pedido.

**Avaliação**: comportamento seguro (nunca empilha, nunca sai do mapa, nunca derruba a transação),
mas **silencioso** — o GM pode não perceber que só 4 de 10 caíram. Não é regressão de nada existente
(o botão "novo token" de hoje não tem esse problema porque só cria 1 de cada vez) e não estava no
escopo pedido mudar a UI para avisar; fica anotado aqui e é candidato a `docs/backlog.md` ("avisar no
toast quando `spawn-creature` cria menos cópias que o pedido") em vez de mudança de última hora fora
do plano aprovado.

**Verificado**: teste unitário (`placement.test.ts`, espiral com poucas células livres) e teste ao
vivo (Edge + CDP): soltar múltiplas cópias perto de um token já ocupando a célula-alvo — as cópias
desviaram da célula ocupada, nenhuma sobreposição.

### 2.2 Criatura Enorme (ou maior) num mapa pequeno

**Cenário**: `sizes[].tokenCells` de Enorme = 3, Colossal = 6 (`tormenta20.json`); um mapa sem
imagem tem `bounds = { cols: 1, rows: 1 }` no mínimo (`Math.max(1, Math.ceil(...))`) — ou qualquer
mapa menor que o próprio token.

**O que acontece**: em `findFreeCells`, `maxCol = Math.max(0, bounds.cols - cells)` e o mesmo para
`maxRow`. Quando o token não cabe (`cells > bounds.cols` ou `> bounds.rows`), `maxCol`/`maxRow` viram
`0` e **toda** posição candidata é grudada em `(0, 0)` — a espiral inteira colapsa num único ponto,
porque `clamp` não distingue mais deslocamentos diferentes. Efeito prático: `findFreeCells` só
consegue devolver **1** posição livre (a segunda candidata cai exatamente sobre a primeira e é
descartada por `overlaps`), não importa o `count` pedido. O token nasce em `(0,0)` — pixels do mapa —
com o tamanho cheio em pixels (`cellsPerSide * cellSize`), então ele **extrapola visualmente** os
limites do mapa (fica maior que a área jogável).

**Avaliação**: não é um crash nem um estado inválido — é o mesmo compromisso que já existe hoje ao
colocar manualmente um token grande num mapa pequeno (nada no app impede um token maior que o mapa).
Mas é uma limitação real da espiral que o plano não previu explicitamente: pedir 5 Colossais num
mapa 1×1 não dá 5 sobrepostos por acidente — dá exatamente **1**, silenciosamente, pelo mesmo motivo
do caso 2.1. Nenhuma mudança de código fora do plano: registrado aqui e o item do backlog do §2.1
cobre também este caso (mesma causa raiz — devolver menos que o pedido sem avisar).

**Verificado**: leitura de código + teste unitário equivalente (`findFreeCells` com `bounds` menor
que `cells`, cobrindo o clamp em 0) em `placement.test.ts`.

### 2.3 Soltar em cena sem grid (`grid.type === "none"`)

**Cenário**: cena nova (grid `"none"` é o padrão) ou GM desativou o grid.

**O que acontece**: `effectiveCellSize` (cliente `lib/grid.ts` e servidor `services/grid.ts`, mesma
conta nos dois) devolve **70 px** como "célula virtual" — o mesmo valor que o botão "novo token" já
usa hoje para não deixar `grid.type === "none"` sem noção de tamanho. `cellAt`/`cellToPoint` também
ignoram o offset do grid nesse caso (`effectiveOffset` retorna `{0,0}`). A espiral funciona
normalmente sobre essa grade invisível de 70 px.

**Bug real encontrado e corrigido durante a implementação (passo 9), próximo deste caso**: uma cena
recém-criada não só tem `grid.type === "none"` como também **não tem mapa** (`mapWidth`/`mapHeight`
`null` — nenhuma imagem foi carregada ainda, que é o estado de **toda** sala nova). O handler usava
`sceneRow.mapWidth ?? cellSize` como fallback de largura do mapa — ou seja, com `cellSize = 70` isso
virava um mapa de **70×70 px = 1 célula**, e todo spawn colapsava em `(0,0)` (mesmo efeito do §2.2,
por uma causa diferente: bounds errado, não token grande). Corrigido trocando o fallback para
`DEFAULT_MAP_SIZE` (`1600×1100`, a mesma constante que o `VttCanvas` já desenhava) — agora
compartilhada em `packages/shared/src/schemas/scene.ts` exatamente para impedir cliente e servidor
de divergirem de novo sobre "onde cabe um token" quando não há mapa.

**Verificado ao vivo** (Edge + CDP, sala nova sem mapa e sem grid): soltura caiu no centro da
viewport calculado pelo cliente, não em `(0,0)`; sem esse teste ponta-a-ponta o bug teria ido para
produção (os testes unitários de `placement.ts` não pegam esse caso, porque `bounds` é passado
pronto — o bug estava em como o servidor calculava `bounds`, não na espiral).

### 2.4 Spawn durante combate ativo

**Cenário**: GM solta uma criatura nova com um combate em andamento na cena (`Combat.status !==
"ended"`).

**O que acontece**: `compendium:spawn-creature` não toca em `Combat`/`Combatant` — cria só
`Character` + `Token`. Um token novo nunca entra sozinho num combate: isso sempre foi manual
(`combat:add`), token criado por qualquer via (botão "novo token" ou spawn de criatura) fica de fora
até o GM adicionar. `combat:next`/`prev`/estado ativo não são recalculados.

**Avaliação**: não é um caso de borda no sentido de "puxa um comportamento inesperado" — é
simplesmente inerte, por desenho (o mesmo motivo pelo qual o botão "novo token" também não mexe no
combate). Nenhum código novo foi necessário.

**Verificado ao vivo**: criado um token, iniciado combate com ele (`combat:start`), depois soltada
uma criatura do compêndio — `combat:updated` não disparou, `useCombat.getState().state.combatants`
ficou byte-a-byte igual antes/depois (só a contagem de tokens da cena mudou, 1→2).

## 3. Testes

- **Unitários** (`shared`): `placement.test.ts` (12, espiral com 1×1/2×2, `bounds` menor que o
  token, `numberedNames`), `compendium.test.ts` (`validateCreatureEntry`, `entryToCharacter`),
  `damageResponse.test.ts` (10, `suggestDamage`/`describeDamageResponse`), `systems.test.ts` (bloco
  `creatures` inválido). `server`: `compendium.test.ts` (filtro de criatura por papel),
  `grid.test.ts` (conversões célula/pixel do servidor). `web`: `grid.test.ts`, `compendium.test.ts`.
  239 testes em `shared`, 39 em `server`, 32 em `web` — todos passando a cada um dos 12 commits.
- **Ao vivo** (Edge headless + CDP, já que o Chrome DevTools MCP não roda no WSL deste ambiente):
  soltar 1 e N criaturas (visível e invisível), arrastar do compêndio até o mapa com fantasma,
  Enter no preview, cena sem mapa/sem grid, spawn durante combate ativo, e o `NpcQuickCard` completo
  (PV por botão e por delta manual, condição, rolagem de ataque, uso de poder, troca com
  `TokenInspector` e abertura da ficha completa) — zero erros de console em todas as rodadas.

## 4. Limitações conhecidas (não corrigidas agora, fora do escopo aprovado)

- §2.1/§2.2: `compendium:spawn-creature` não avisa o GM quando cria menos cópias que o pedido
  (espiral estourou o raio, ou o token não cabe no mapa). Candidato a `docs/backlog.md`.
- `token:apply-damage` continua sem aplicar `damageResponses` sozinho — só sugere e avisa (decisão
  sua de 08/09/2026, já no backlog).
- Pack `convocacoes` do Foundry fica fora do importador (já no backlog).
- `NpcQuickCard` é a versão mínima do contrato; a UI definitiva vem do AI Studio depois.
