# Plano: importador do compêndio a partir dos packs do Foundry

Setembro/2026. Objetivo: gerar `packages/shared/systems/tormenta20/compendium/*.json` a partir dos packs do sistema Tormenta20 para Foundry (`~/projetos/foundry-tormenta20/packs`), com um script idempotente que só traz mecânica para o repositório e deixa as descrições fora dele.

## 1. Formato dos packs

- Os packs **não estão em LevelDB**: `packs/_source/` guarda a fonte em **YAML, um arquivo por documento** (o LevelDB só é gerado no build do Foundry, `npm run build:packs`).
- Cada arquivo tem `name`, `type`, `img`, `system{...}` (a mecânica), `effects[]` (efeitos ativos), `_id`, `folder`, `_stats`, `_key`.
- Arquivos `_folder.yml` (87) são pastas do Foundry: ignorar.
- Descrições em `system.description.value`: HTML com entidades (`&ccedil;`), links `@UUID[...]{rótulo}` e `<a class="content-link">rótulo</a>`, alguns `<ul>`, `<strong>`, `<em>`, `<br>`, 2 `<table>` e 9 rolagens inline `[[/r ...]]`.
- Página em `system.source`, texto livre. Formatos encontrados: `Tormenta20 — Edição Jogo do Ano, p. N` (1150), `Tormenta20 — Distinções, p. N` ou `p. N-N` (99), `p. N e N` (7), `Guia de NPCs, p. N (1.1)` (5), vazio (136), mais uns poucos irregulares.

## 2. Entradas por tipo

Total: 1.523 documentos.

| Tipo Foundry | Qtd | Vai para o nosso `kind` |
|---|---|---|
| `magia` | 203 | `spell` |
| `poder` | 812 | `power`: 646 do pack `poderes` + 99 de `poderes-distincao`; 67 de `habilidades-de-criaturas` e `parceiros` ficam fora |
| `arma` | 77 | `weapon`: 69; 8 armas "naturais" de criaturas ficam fora |
| `equipamento` | 131 | `armor` (25: `tipo` leve/pesada/escudo) e `gear` (106: acessório, traje, ferramenta, esotérico) |
| `consumivel` | 95 | `consumable` |
| `tesouro` | 54 | `gear` (tag "tesouro") |
| `race` | 18 | `race` |
| `classe` | 14 | `class` |
| `npc` (83), `simple` (18), `script` (5), tabelas (18), journals (2) | 126 | fora do escopo (criaturas, convocações, macros, tabelas de tesouro, condições/perícias) |

Valores distintos relevantes (para o mapeamento):

- magia: `tipo` arc/div/uni; `escola` abj/adv/con/enc/evo/ilu/nec/tra; `circulo` "1".."5"; `ativacao.execucao` action/full/reaction/special/free/move/minute/hour; `alcance` short/self/touch/medium/long/any/spec/km; `duracao.units` scene/inst/sust/day/special/round/perm/turn; `resistencia.txt` texto livre ("Vontade parcial", "Reflexos reduz à metade", "veja texto", typos "Relfexos", "Vontade anual"); `resistencia.atributo` sab/int/car; `alvo` e `area` texto livre; `rolls` só tipo `dano` (54 magias).
- poder: `tipo` classe/ability/geral/distincao/concedido/racial/origem; `subtipo` = classe, raça, divindade ou grupo (Combate, Tormenta, Destino, Magia); `ativacao.execucao` ''/passive/move/reaction/full/action/free/special/none/day/hour; `custo` 0..15 ou null; `alcance` quase sempre none; `rolls` só `dano` (61 poderes); 406 têm `effects` com `changes`.
- arma: `proficiencia` marcial/simples/exotica/natural/fogo; `proposito` corpo-a-corpo/disparo/arremesso/corpo-a-corpo-arremesso; `empunhadura` uma/duas/leve; `criticoM`/`criticoX`; `rolls` = um `ataque` (`1d20`, perícia `luta`/`pont`/'' , bônus) e um `dano` (fórmula, tipo, `@for`, bônus "+2" em armas mágicas); `propriedades` booleanas (agil, leve, duasMaos, versatil, dupla, alongada, arremesso, municao, adaptavel).
- equipamento: `tipo` acessorio/traje/ferramenta/leve/pesada/esoterico/escudo; `armadura {value, penalidade, maxAtr}` (maxAtr sempre 0).
- consumivel: `tipo` potion/alchemy/material/food/ammo; execução ''/action/full; alcance none/touch/short/self/medium; `rolls` só `dano`.
- race: `atributos` fixos; `atributosDinamicos.value` lista de atributos permitidos (vazia em 14; Humano e Sereia/Tritão todos; Osteon sem `con`; Lefou sem `car`); `tamanho` med/peq/min; `movement.walk` 6/9/12; `grants` = uuids dos poderes raciais. Sem `source`, sem sentidos, sem perícias, descrição vazia em todas.
- classe: `pvPorNivel`, `pmPorNivel`, `pericias.inatas` (texto: "Luta (For) ou Pontaria (Des), Fortitude (Con), mais 2 a sua escolha entre ..."), `pericias.numero`. Sem PV inicial, sem proficiências, sem `source`, descrição vazia em todas.

## 3. Script

`scripts/import-foundry-compendium.ts`, rodado por `pnpm import:compendium [--with-descriptions] [--source <dir>]`. Dependências novas na raiz: `tsx` e `yaml` (devDependencies). Fonte padrão: `~/projetos/foundry-tormenta20/packs/_source`.

Passos:

1. Ler todos os `.yml` (exceto `_folder.yml`), agrupar por `type`, descartar packs fora do escopo.
2. Mapear cada documento para `CompendiumEntry` (seção 4).
3. Validar com `CompendiumEntrySchema` + `validateCompendiumEntry` do `shared`. Qualquer entrada inválida faz o script falhar com o id e o motivo.
4. Gravar os JSONs gerados, `scripts/import-report.md` e, com `--with-descriptions`, `descriptions.local.json`.

Idempotência: ids derivados do nome (slug sem acento), ordem de saída estável (por id), sem timestamps no arquivo. Rodar duas vezes gera o mesmo diff zero.

## 4. Arquivos e precedência

Gerados em `packages/shared/systems/tormenta20/compendium/`: `classes.json`, `races.json`, `weapons.json`, `armor.json`, `gear.json` (novo), `consumables.json` (novo), `spells.json`, `powers.json`. Formato:

```json
{ "$generated": "Gerado por scripts/import-foundry-compendium.ts. Não edite à mão; use custom.json.", "entries": [ ... ] }
```

Cada entrada leva `$source` com o uuid do Foundry (`Compendium.tormenta20.<pack>.Item.<id>`) para rastrear. O Zod descarta chaves `$...` ao parsear.

- `custom.json` (array simples, editado à mão, o importador nunca toca): recebe o seed atual confirmado no livro (Anão, Humano, Guerreiro, Arcanista, Espada longa, Arco curto, Couro batido).
- Precedência por id: `custom.json` vence o gerado. Dois mecanismos: o importador **pula** ids que existam em `custom.json` (e lista no relatório) e o loader (`packages/shared/src/compendium/index.ts`) filtra de novo, para uma edição posterior em `custom.json` não gerar id duplicado.
- O loader passa a aceitar tanto arrays quanto `{ entries }`.

Ids: slug do nome. Nomes duplicados (6 poderes, ex. "Ataque Furtivo" em duas classes, "Comandar", "Bote") ganham sufixo do subtipo (`ataque-furtivo-ladino`); colisão restante usa o `_id` do Foundry em minúsculas. Todas as colisões vão para o relatório.

## 5. Mapeamento

| Foundry | Nosso |
|---|---|
| magia `tipo` arc/div/uni | `spell.type` arcana/divina/universal |
| magia `escola` abj/adv/con/enc/evo/ilu/nec/tra | `spell.school` abjuracao/adivinhacao/convocacao/encantamento/evocacao/ilusao/necromancia/transmutacao |
| magia `circulo` "1" | `spell.circle` 1 |
| `ativacao.execucao` action/full/reaction/free/move/special/passive | `activation.execution` standard/full/reaction/free/move/special/passive; `''`/`none` → `""` |
| `ativacao.custo` (null → 0) | `activation.cost` |
| `alcance` short/self/touch/medium/long | `activation.range.units` igual; `none`/`''` → `""` |
| `duracao.units` scene/inst/sust/day/special/round/perm/turn/hour | `activation.duration.units` scene/instant/sustained/day/special/round/permanent/turn/hour; `value` copiado |
| `alvo`, `area`, `efeito` | `activation.target`, `activation.area`, `activation.effect` |
| `resistencia.txt` começando com Fortitude/Reflexos/Vontade (sem acento, tolerando "Relfexos") | `save.skill` fortitude/reflexos/vontade, `save.text` = texto original, `save.attribute` = `resistencia.atributo` (só magias) |
| `rolls[type=dano]` | ação `damage` por parte: `formula`, `damageType` (mapa: dano→normal, curapv→cura, demais iguais), `attribute` = "auto" se a fórmula tem `@for`, senão null; `@for` removido da fórmula |
| arma `rolls[type=ataque]` | ação `attack`: skill `luta`/`pont`→`pontaria`, `bonus` = terceira parte; `critRange` = `criticoM`, `critMult` = `criticoX` |
| arma `proficiencia` simples/marcial/exotica/fogo | `weapon.proficiency` igual |
| arma `proposito` corpo-a-corpo/disparo/arremesso/corpo-a-corpo-arremesso | `weapon.purpose` melee/ranged/thrown/melee_thrown |
| arma `empunhadura` uma/duas/leve | `weapon.wield` one_hand/two_hands/light |
| arma `propriedades` true | `weapon.properties` texto ("ágil, leve, duas mãos, versátil, dupla, alongada, arremesso, munição, adaptável") + alcance da arma quando houver |
| equipamento `tipo` leve/pesada/escudo | `armor.type` light/heavy/shield; `statBonuses.defense` = `armadura.value`, `statBonuses.armorPenalty` = `armadura.penalidade`; `maxAttr` omitido (sempre 0 no Foundry, sem limite em T20) |
| equipamento outros `tipo`, tesouro | `gear`, tag com o tipo ("acessório", "traje", "ferramenta", "esotérico", "tesouro", "item de origem", "veículo", "animal") |
| consumivel `tipo` potion/alchemy/ammo/material/food | `consumable.type` pocao/alquimico/municao/outro/outro (tag "material"/"alimentação") |
| poder `tipo` classe/geral/concedido/racial/origem | `power.type` igual; `subtipo` vira tag |
| race `atributos` ≠ 0 | `race.attributeBonuses` |
| race `atributosDinamicos.value` | `race.flexibleBonuses` `{ amount: 1, count: 3, exclude: <complemento da lista> }`; lista vazia → `count: 0` |
| race `tamanho` med/peq/min | `race.size` medio/pequeno/minusculo |
| race `movement.walk` | `race.movement` |
| classe `pvPorNivel`, `pmPorNivel` | `class.hpPerLevel`, `class.mpPerLevel` |
| classe `pericias.inatas` (texto) | `class.skillsGranted`: antes de "mais N a sua escolha entre" → fixas e grupos "X ou Y" (count 1); depois → grupo count N; rótulos casados sem acento/hífen de quebra ("Sobre- vivência") com `skills[].label` do sistema |
| `preco`, `espacos` | `price`, `slots` |
| `source` com "p. N" | `page` = N (primeiro número após "p."); sem página → null |
| pasta do pack | tags extras: "mágico" (equipamentos-magicos), "distinção", nome da classe/raça/divindade |

Ignorado de propósito: `img`, `effects[]` (efeitos ativos; só contados no relatório), `equipado`, `upgrades`, `melhorias`, `encantos`, `_stats`, `folder`.

## 6. Vira TODO no relatório (nunca inventado)

- Classes: PV inicial (`hpInitial`) e proficiências não existem no Foundry. Ficam `0` e `""`. Todas sem página.
- Raças: sentidos, perícias e página não existem no Foundry. Vínculo raça → poderes raciais (`grants`) não é modelado; os poderes entram em `powers.json` com tag da raça.
- Execução `minute`/`hour` (magias) e alcance `any`/`spec`/`km`: fora dos nossos enums, gravado `special` e listado.
- `duracao.special` com texto ("veja texto", "1d4 rodadas"): unidade `special`, texto listado.
- Resistência "veja texto", "nenhuma", "varia" ou combinada ("Vontade anula, Fortitude parcial"): `save` null, texto listado.
- 4 armas de origem (Ferramenta pesada, Ferramenta agrícola, Martelo de carne, Rolo de macarrão) e 3 armas mágicas sem perícia de ataque no Foundry: ação de ataque omitida, listadas.
- Poderes com `ativacao.execucao` `day`/`hour`: listado.
- Fórmulas de dano não parseáveis pelo nosso parser: entrada falha a validação (script para) ou, se for só texto, listada.
- Colisões de id e entradas puladas por existirem em `custom.json`.
- Contagem de `effects` com `changes` por tipo (406 poderes, 59 equipamentos, 23 consumíveis, 8 tesouros, 3 armas), sem detalhe por entrada.

## 7. Descrições (fora do repositório)

- `--with-descriptions` grava `compendium/descriptions.local.json` como `{ "<id>": "texto" }`. `*.local.json` entra no `.gitignore`.
- Conversor HTML → texto/markdown leve: `<p>` vira parágrafo (linha em branco), `<strong>/<b>` → `**x**`, `<em>/<i>` → `*x*`, `<ul><li>` → `- x`, `<br>` → quebra, `<h*>` → linha própria, `<table>` → linhas separadas por " | ", links (`@UUID[...]{x}`, `content-link`) viram só o rótulo, `[[/r 2d6]]` vira `2d6`, entidades decodificadas, espaços colapsados.
- Aprimoramentos das magias (guardados como `effects[]` com `flags.tormenta20.custo`) entram no fim da descrição como lista "Aprimoramentos:" com "+N PM: texto". São texto de regra, não automação.
- Maior descrição: 3.814 caracteres (poder Engenhoqueiro), dentro do limite de 4.000 do schema. 12 passam de 2.000.
- Raças e classes chegam sem descrição: nelas aparece "ver livro" mesmo com o arquivo.

App:

- O servidor (`packages/shared/src/compendium/index.ts`, que já é só servidor) lê `descriptions.local.json` se existir e preenche `description` das entradas ao montar o compêndio.
- `CharacterItem` ganha `page: number | null` (default null), copiado em `entryToItem`, para a ficha saber a página sem vínculo com o compêndio.
- Preview do compêndio (`EntryPreview.tsx`) e item da ficha (`ItemsSection.tsx`): mostram a descrição se houver; senão "ver livro, pág. X" (ou "ver livro" sem página).

## 8. Decisões (aprovadas pelo dono do projeto em 7/9/2026)

1. Aprimoramentos das magias entram na descrição (só com `--with-descriptions`). **Aprovado.**
2. Poderes `ability` (93 habilidades automáticas de classe) e `distincao` (99) não existiam em `power.type`. **Aprovado:** o JSON do sistema ganhou as opções `habilidade` e `distincao`.
3. PV inicial das classes = **4 × PV por nível** (confirmado no livro para Guerreiro, Arcanista, Bárbaro e Ladino). A regra está documentada no relatório.
4. Armadura pesada e limite de Destreza (`maxAttr`): fica **sem limite** por enquanto; as pesadas aparecem como TODO no relatório para conferir no livro.

## 9. Ordem de implementação

1. `shared`: `page` em `CharacterItem` + `entryToItem`; loader aceita `{ entries }` e `custom.json` com precedência; leitura de `descriptions.local.json`; opções novas em `power.type` (se aprovado).
2. Mover o seed para `custom.json`.
3. Script + relatório; `pnpm import:compendium`; `.gitignore`.
4. Web: "ver livro, pág. X" no preview e na ficha.
5. `make typecheck && make test`; atualizar SPEC §9.4.
