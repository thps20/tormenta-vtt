# Plano: compêndio (biblioteca de itens pré-definidos)

> Biblioteca de classes, raças, armas, armaduras, magias e poderes que o jogador puxa para a ficha.
> Escrito em 06/09/2026, antes da implementação. Status: **implementado** (7 commits, mesmo dia). Resumo em `docs/SPEC.md` §9.4.

**Princípio:** uma entrada do compêndio é apenas um `CharacterItem` pré-preenchido, sem `id`. Inserir na ficha
faz uma **cópia** (nunca um vínculo): gera ids novos para o item e suas ações e manda `character:update` com a
lista de itens, exatamente como o botão "Adicionar" faz hoje. A ficha, o cálculo (`computeCharacter`) e o servidor
não ganham nenhuma regra nova; só passa a existir uma fonte de itens prontos.

Regra de conteúdo: só dados mecânicos. `description` fica vazia por enquanto.

## Decisões de modelagem (e por quê)

1. **Formato da entrada.** `CompendiumEntry = { id, name, kind, tags[], fields, actions?, activation?, save?,
   description?, page? }`, validado por `CompendiumEntrySchema` (`packages/shared/src/schemas/compendium.ts`).
   As ações vêm **sem `id`** (`ActionSchema.omit({ id })`), porque o id nasce na inserção.
   - Mais três campos opcionais, aprovados pelo dono: `statBonuses`, `slots`, `price`. Sem `statBonuses` uma
     armadura não dá Defesa nenhuma; espaços e preço são dados mecânicos do livro.

2. **Validação contra o sistema, não só contra o Zod.** `validateCompendiumEntry(def, entry)`
   (`packages/shared/src/rules/compendium.ts`) confere que `kind` existe em `itemKinds`, que cada chave de
   `fields` é um campo declarado daquele tipo com valor do tipo certo (opção de enum existe; estruturados batem
   com `AttributeChoiceValueSchema` etc.), que `activation`/`save` só aparecem em tipos com
   `hasActivation`/`hasSave`, que `statBonuses` só usa stats permitidos pelo tipo e que ações de ataque usam
   perícias de `attackSkills`. Nenhuma chave concreta ("class", "for") aparece no código.

3. **Cópia, não vínculo.** `entryToItem(def, entry, newId)` monta o `CharacterItem` completo. Editar o item na
   ficha depois não altera o compêndio, e mudar o compêndio não altera fichas existentes.

4. **Onde os JSONs moram e quem os carrega.** `packages/shared/systems/tormenta20/compendium/{classes,races,
   weapons,armor,spells,powers}.json`. O registro por sistema (`packages/shared/src/compendium/index.ts`) é
   exposto pelo subpath `@tormenta-vtt/shared/compendium`, **não** pelo `index.ts` do pacote. Motivo: o web
   importa o barrel inteiro; se o compêndio estivesse lá, o Vite empacotaria os JSONs no navegador e o socket
   seria inútil. Só o servidor importa o subpath.

5. **Servido via socket (`compendium:list`), não no `RoomSnapshot`.** Mantém o snapshot leve e deixa o cliente
   carregar sob demanda, na primeira abertura da paleta. É também o ponto único onde, no futuro, o compêndio da
   sala se mistura ao do sistema.

6. **Compêndio da sala (homebrew do GM): só a interface.** `CompendiumSource = { id, label, priority, entries }`
   e `mergeCompendium(sources)`: id repetido vence pela fonte de maior prioridade. O servidor já chama
   `mergeCompendium([sistema, sala])`, com a fonte da sala sendo um stub que devolve `[]`. Sem tela, sem tabela
   no banco, sem evento de edição.

7. **Uma única função de inserção.** Enter, botão "+" e soltar chamam
   `useCharacters.insertFromCompendium(characterId, entryId, { replace? })`, que passa pelo `update` existente
   (otimista + ack + reversão de graça). As regras ficam em `apps/web/src/lib/compendium.ts` (puro, testável):
   - `checkInsert(def, character, entry)` devolve `ok` ou o motivo ("A ficha já tem Raça: Anão") e o item a
     substituir, lendo `itemKinds[].maxCount`.
   - `buildInsertPatch(def, character, entry, ids)`: classe marca `initial` (via `level.classes.initialField`) se
     for a primeira; raça substitui a atual e ajusta o `size` da ficha, como o editor de raça já faz.
   - Escolhas pendentes (Humano, perícias de classe) ficam como hoje: `pendingChoices` e o badge
     "faltam N escolhas".

8. **Arrastar e soltar com pointer events e alvos registrados.** Nada de HTML5 drag (não conversa bem com o
   Konva). `apps/web/src/lib/dropTargets.ts` mantém um registro `{ id, accepts(entry), onDrop(entry) }` casado
   com `data-drop-target` no DOM; ao soltar, `document.elementFromPoint` acha o alvo. Hoje só a ficha se registra;
   depois o `VttCanvas` registra "mapa" aceitando monstros (monstro vira token) sem mudar a paleta.

## Usabilidade (o que o jogador vê)

- Paleta de comandos flutuante **por cima da ficha** (posição absoluta dentro do drawer), não uma tela separada.
- Abre pelo botão **"Do compêndio"** ao lado de "Adicionar" (modo edição) ou por **Ctrl+Espaço**. Abrir a partir
  de uma aba de itens já filtra por aquele tipo.
- Foco já no campo de busca. Resultados agrupados por tipo, com chips de filtro vindos de `def.itemKinds`.
- Teclado: setas navegam, **Enter** insere e fecha, **Ctrl+Enter** insere e mantém aberto, **Esc** fecha.
- Painel de preview à direita com o resumo mecânico da entrada selecionada (reaproveita `summarizeField` e
  `describeActivation`).
- Entradas não inseríveis ficam cinza com o motivo no preview. Para 2ª raça, o preview mostra o botão
  "Substituir <raça atual>"; o clique é a confirmação.
- Botão **"+"** em cada resultado (hover e item focado): clique insere e o painel fica aberto.
- **Arrastar**: fantasma do item segue o cursor; a paleta fica semitransparente para não tampar a ficha; a ficha
  ganha borda/halo enquanto o fantasma está sobre ela; a aba certa é definida pelo `kind` e a ficha troca para ela
  ao soltar; soltar fora cancela.
- Após inserir: item aparece na aba certa com destaque breve (animação curta) e badge de escolhas pendentes quando
  houver.

## Commits, na ordem

1. **`shared`: schema e regras puras do compêndio.** `CompendiumEntrySchema`, `validateCompendiumEntry`,
   `entryToItem`, `CompendiumSource` + `mergeCompendium`. Testes unitários.
2. **`shared`: seed do Tormenta20 e registro.** Os seis JSONs (magias e poderes nascem `[]`), o registro por
   sistema no subpath `@tormenta-vtt/shared/compendium` e um teste que valida todo arquivo de `compendium/` de
   todo sistema contra o JSON do sistema (ids únicos, entradas válidas), ao lado de `systems.test.ts`.
3. **Evento `compendium:list`.** `events.ts` + handler no servidor (`guarded`), lendo o `systemId` da sala e
   passando por `mergeCompendium` com o stub da sala.
4. **Web: store e `insertFromCompendium`.** `store/compendium.ts` (entradas, `load`, `open({ kind? })`,
   `close`, estado do arrasto, `lastInserted`), `lib/compendium.ts` com teste, e a ação na store de fichas.
5. **Web: paleta de comandos.** `components/compendium/CompendiumPalette.tsx`, botão "Do compêndio" em
   `ItemsSection`, Ctrl+Espaço no drawer, troca de aba e destaque após inserir.
6. **Web: arrastar e soltar.** Pointer events, fantasma, registro de alvos, feedback da zona de soltura.
7. **Docs.** SPEC §3.6 e §8 (a limitação "sem compêndio" sai), e este arquivo passa a "implementado".

Cada commit termina com `make typecheck && make test` passando.

## Decisões tomadas durante a implementação

- Soltar na ficha **fecha** a paleta (como Enter), para o jogador ver o item chegar com destaque; "+" e Ctrl+Enter
  mantêm aberta para inserir vários.
- Chips de tipo são multi-seleção; "todos" limpa. Abrir pela aba já deixa o chip daquele tipo marcado.
- Linhas não inseríveis não são arrastáveis (cursor `not-allowed`); a troca de raça só acontece pelo botão
  "Substituir" do preview, nunca por Enter ou arrasto.
- A busca ignora acento e caixa e casa por nome, tags e id ("anao" acha "Anão").
- Raça sem bônus à escolha precisa de `flexibleBonuses.count = 0` no JSON: o valor vazio do sistema é
  `count: 1`, o que deixaria uma escolha pendente falsa.
- `compendium:list` carrega sob demanda (primeira abertura da paleta) e o resultado fica em memória até sair
  da sala.
- Validado com o cenário CDP `C:\Temp\vtt-compendium.ps1` (botão, Ctrl+Espaço, Enter, Ctrl+Enter, 2ª raça +
  Substituir, "+", Esc, arrasto para a ficha e para fora).

## Seed inicial

O dono corrigiu o Anão (CON +2, SAB +1, DES -1). Perícias à escolha de Guerreiro e Arcanista e preço/espaços
das armas e da armadura ficaram com `TODO` no `$comment` do JSON, à espera do livro.

| Entrada | Valores propostos | Certeza |
|---|---|---|
| Guerreiro | PV 20 no 1º nível, +5/nível, PM +3/nível. Perícias: Fortitude fixa; escolha 1 entre Luta/Pontaria; escolha 2 entre Adestramento, Atletismo, Cavalgar, Guerra, Iniciativa, Intimidação, Ofício, Percepção, Reflexos | alta nos números; lista de opções TODO |
| Arcanista | PV 8, +2/nível, PM +6/nível. Misticismo e Vontade fixas; escolha 2 entre Atuação, Conhecimento, Diplomacia, Enganação, Guerra, Iniciativa, Intuição, Investigação, Nobreza, Ofício, Percepção | alta nos números; lista TODO |
| Anão | CON +2, SAB +1, DES -1; tamanho Médio; deslocamento 6 m | confirmado pelo dono |
| Humano | +1 em 3 atributos à escolha; 2 perícias à escolha | alta |
| Espada longa | marcial, corpo a corpo, uma mão, dano 1d8 corte, crítico 19/×2, 1 espaço, T$ 15 | média (preço e espaços TODO) |
| Arco curto | marcial, disparo, duas mãos, dano 1d6 perfuração, crítico ×3, 1 espaço, T$ 30 | média (preço TODO) |
| Couro batido | leve, Defesa +2, penalidade 0, 2 espaços, T$ 20 | baixa no preço e espaços (TODO) |

## Fora deste plano

- Tela de edição do compêndio da sala (homebrew): só a interface/tipo fica pronta.
- Soltar no mapa (monstro vira token): só o registro de alvos fica pronto.
- Descrições em texto das entradas.
