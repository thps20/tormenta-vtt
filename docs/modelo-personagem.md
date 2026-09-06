# Modelo de personagem e itens — análise e proposta

> Documento de referência. Analisa o sistema não oficial de Tormenta20 para Foundry VTT
> (`~/projetos/foundry-tormenta20`, versão 1.5.015) **apenas como referência de modelagem de dados**
> e propõe como estender `packages/shared` para cobrir ficha de personagem e itens.
> As fases 1, 2 e 3 da proposta estão implementadas (ver §3.6); o comportamento atual está em `SPEC.md` §3.6.
> As seções 2 e 3 permanecem como registro da análise e da proposta original.

Escopo da leitura no repositório do Foundry:

- `system.json`: tipos de documento (Actor: `character`, `npc`, `simple`, `bases`, `hazard`; Item: `arma`, `equipamento`, `classe`, `consumivel`, `magia`, `poder`, `race`, `tesouro`, `comodo`, `mobilia`).
- `json/`: contém **apenas** a configuração do calendário de Arton para o módulo Simple Calendar. Não é modelo de dados.
- `module/dataModel/`: schemas dos atores e itens (`actor/templates/creature.mjs`, `actor/character.mjs`, `actor/menace.mjs`, `item/*`, `helpers.mjs`).
- `module/dataModel/actor/templates/attributes.mjs` e `module/documents/actor.mjs` / `item.mjs`: cálculo de valores derivados (defesa, perícias, PV, PM, carga, deslocamento, ataque, dano, CD).
- `module/config/T20.js`: enumerações (atributos, perícias, tipos de dano, escolas, etc.).

---

## 1. Licenças

| Arquivo | O que é | O que permite |
|---|---|---|
| `LICENSE` | BSD 3-Clause, Victor Hugo Paiva, 2021. Cobre o **código** do sistema. | Usar, modificar e redistribuir, desde que se mantenha o aviso de copyright e não se use o nome do autor para promover derivados. Usar apenas como referência de modelagem, sem copiar código, não gera obrigação nenhuma. |
| `OGL.txt` | Open Game License 1.0a. Cobre o **conteúdo de jogo**. A seção 15 lista Tormenta20, Tormenta RPG e Império de Jade como Open Game Content da Jambô Editora. | Usar as **mecânicas** (fórmulas, procedimentos, tabelas de regra) livremente, exigindo incluir a OGL e o aviso de copyright em qualquer distribuição de Open Game Content. **Proíbe** usar Product Identity: nomes de personagens, lugares, divindades, descrições de magias, artes, logos. Os compêndios em `packs/` misturam os dois; por isso não copiamos compêndio. |
| `README.md` | Créditos | Partes do código vêm de dnd5e (MIT), pf2e (Apache 2) e SWADE (MIT). Irrelevante para nós, já que não copiamos código. |

Resumo prático: nosso `tormenta20.json` usa nomes de atributos e perícias, que são mecânica, não Product Identity. Se um dia distribuirmos o projeto com esse JSON, o correto é incluir uma cópia da OGL com a seção 15 apontando a Jambô. Isso não é parecer jurídico, é leitura dos textos.

---

## 2. Modelo de dados do Foundry

Ordem de cálculo do ator (`character.mjs`): nível a partir das classes → treino e CD → atributos sem bônus → **PV/PM** (usam atributo sem bônus) → atributos com bônus → **Defesa** (gera a penalidade de armadura) → **perícias** → carga → deslocamento → resistências a dano.

### 2.1 Personagem (ator `character`)

| Campo | Tipo | Como é calculado |
|---|---|---|
| `atributos.<for,des,con,int,sab,car>.{base, racial, bonus}` | int cada | Entrada. `value = base + racial + bonus`. PV/PM usam só `base + racial`. |
| `attributes.nivel.value` | int 0..20 | **Derivado**: soma de `niveis` dos itens `classe`. |
| `attributes.nivel.xp.{value, proximo, pct}` | int | `proximo` vem de uma tabela de XP por nível; `pct` é o progresso até o próximo. |
| `attributes.treino` | int | **Derivado**: nível ≥ 15 → 6, ≥ 7 → 4, senão 2. |
| `attributes.cd` | int | **Derivado**: `10 + floor(nível/2)`. A CD de cada item soma o atributo e um bônus (ver itens). |
| `attributes.conjuracao` | chave de atributo | Entrada. Atributo-chave de conjuração (padrão `int`). |
| `attributes.defesa.{atributo, base, outros, condi, bonus[], value, pda}` | int / lista de fórmulas | **Derivado**: `base(10) + [meio nível, se opção ativa] + acessórios + bonus[] + atributo + armadura + escudo + outros + condi`. Com armadura pesada o atributo é limitado a `maxAtr` da armadura. `pda` = soma das penalidades de armadura, escudo e acessórios equipados. |
| `attributes.pv` e `attributes.pm` `.{value, temp, min, max, atributos{}, bonus{nivel[], nivelPar[], nivelImpar[], total[]}}` | int / listas de fórmulas | **Derivado** `max`: para cada nível de cada classe soma `pvPorNivel` (×4 no 1º nível da classe inicial) + CON (só PV, mínimo 1 por nível) + bônus por nível; depois soma os atributos marcados em `atributos{}` e `bonus.total[]`. `pv.min = -floor(max/2)`. Uma flag `lvlconfig.manual` desliga o cálculo. |
| `attributes.carga.{atributo, base, bonus[], value, limit, max, pct, encumbered}` | int | **Derivado**: `limit = base(10) + (FOR > 0 ? FOR×2 : FOR)`, `max = limit×2`, `value` = Σ `qtd × espacos` dos itens carregados (+ moedas/1000), `encumbered = value > limit`. |
| `attributes.movement.<walk,climb,burrow,swim,fly>.{base, bonus[], value}` + `hover`, `unit`, `tags` | int / m | **Derivado**: `base + bonus[] − 3 (armadura pesada) − 3 (sobrecarregado)`; condição *lento* divide por 2, *caído* limita a 1,5 m. |
| `attributes.sentidos.{value: set, custom}` | enum set | Entrada (penumbra, escuro, cegas, faro). |
| `pericias.<key>.{atributo, treinado, st, pda, size, outros, condi, bonus[], custom, label, value}` | mapa | **Derivado** `value`: `meio nível + atributo + [treino se treinado] + bonus[] + [pda se marca armadura] + [mod. de tamanho se marca size] + outros + condi + modificadores globais (geral, resistência, ataque/semataque, por atributo)`. Ofícios são 6 perícias separadas, todas INT e treinadas. |
| `detalhes.{raca, origem, divindade, tipo, info, biography{value, public}, diario..diario5}` | texto / enum | Entrada. `tipo` é o tipo de criatura. |
| `dinheiro.{tc, tp, to, tl}` | int ≥ 0 | Entrada. Cobre, prata, ouro, platina. |
| `modificadores.{custoPM, atributos{for..car, fisicos, mentais, geral}, ataque{geral, cac, ad}, dano{geral, cac, ad, mag, alq}, cura{geral, mag}, pericias{geral, resistencia, semataque, ataque, atr{for..car}}}` | listas de fórmulas | Entrada via Active Effects. São os "bônus globais" somados nas fórmulas acima e nas rolagens de item. |
| `resources.<primary, secondary, tertiary, deathsave, shadow, catarse>.{value, max, label}` | int | Entrada. Contadores livres; `deathsave` tem `max 3`. |
| `tracos.tamanho` | enum min/peq/med/gra/eno/col | Entrada. Tamanho dá modificador de perícia (+5, +2, 0, −2, −5, −10) e tamanho de token (0.5, 1, 1, 2, 3, 6 células). |
| `tracos.resistencias.<tipoDeDano>.{base, bonus[], value, excecao, imunidade, vulnerabilidade, danoPorDado}` | mapa | **Derivado** `value = base + bonus[]`. 13 tipos de dano. |
| `tracos.{ic, idiomas, profArmas, profArmaduras}.{value[], custom}` | listas | Entrada. Imunidades a condição, idiomas, proficiências. |
| `equipamentos.{limiteEmpunhado, limiteVestido}` | int | Entrada. Slots de mão (2) e corpo (4). |

**Diferenças do NPC (`npc`)**: tem `attributes.nd` (string, aceita frações e "S"/"S+"); nível deriva do ND; XP de recompensa = `ND × 1000`; defesa é só `base + outros + condi`; CD e PV/PM são manuais; `detalhes` ganha campos de texto livre (equipamento, resistências, movimento, ataques corpo a corpo e à distância, tesouro, papel). Útil para nós: o mesmo schema com `kind: "npc"` e cálculo desligado.

### 2.2 Campos comuns a todo item

| Campo | Tipo | Notas |
|---|---|---|
| `description.{value, unidentified}`, `source`, `origin`, `chatFlavor`, `chatGif` | texto | Entrada. |
| `tags[]`, `rolltags[]`, `automationtags[]` | string[] | `rolltags` contam poderes por tag para fórmulas (ex.: quantos poderes de uma linha o personagem tem). |
| `rolls[]` | `{key, name, type: ataque \| dano \| formula, parts: [string, string, string][], adaptavel}` | O coração da automação. **Ataque**: `parts[1] = [perícia, atributo?]` → `1d20 + pericias[perícia].value`; se houver atributo alternativo, troca o atributo da perícia pelo escolhido; soma `modificadores.ataque` e bônus de munição. **Dano**: cada parte é `[fórmula, tipoDeDano, extra]`; a fórmula especial `"padrao"` vira FOR (corpo a corpo, arremesso), nada (disparo) ou DES (arma leve com acuidade); soma `modificadores.dano`; crítico multiplica por `criticoX` quando o d20 ≥ `criticoM`. Cura e perda de PV são tipos de dano especiais (`curapv`, `curatpv`, `curapm`, `curatpm`, `perda`). |
| **Físico** (arma, equipamento, consumível, tesouro): `carregado`, `espacos`, `peso`, `qtd`, `preco`, `pv{value, max}`, `rd` | bool / número | Entrada. `espacos` alimenta a carga. |
| **Ativação** (poder, magia, consumível; arma só tem `custo` e `alcance`): `ativacao{custo (PM), condicao, execucao, qtd, special}`, `consume{amount, mpMultiplier, target, type}`, `duracao{units, value, special}`, `range{units, value}`, `alcance`, `alvo`, `area`, `efeito` | número / enums / texto | Entrada. `execucao` ∈ passiva, padrão, movimento, completa, reação, livre, minuto, hora, dia, especial. `duracao.units` ∈ instantânea, cena, turno, rodada, sustentada, minuto, hora, dia, mês, ano, permanente, especial. `range.units` ∈ nenhum, pessoal, toque, curto, médio, longo, especial, qualquer, m, km. `consume.type` ∈ munição, atributo, material. |
| **Resistência** (poder, magia, consumível): `resistencia{txt, pericia, atributo, bonus, cd}` | texto / enum / int | `cd` **derivada**: `10 + floor(nível/2) + atributo + bonus`; em NPC usa `attributes.cd`. |
| **Melhorias** (físicos): `upgrades{melhoria1..4, material, encanto1..3}`, `enableAutoUpgrades` | enums | Entrada. |

### 2.3 Campos por tipo de item

| Tipo | Campos próprios | Tipo / valores |
|---|---|---|
| `arma` | `proficiencia` | simples, marcial, exótica, fogo, natural, improvisada |
| | `proposito` | corpo-a-corpo, corpo-a-corpo-arremesso, disparo, arremesso |
| | `empunhadura` | leve, uma, duas |
| | `criticoM`, `criticoX` | int, padrão 20 e 2 |
| | `propriedades{ada, agi, alo, des, dup, ver, hib}` | bool (adaptável, ágil, alongada, desbalanceada, dupla, versátil, híbrida) |
| | `size`, `ataques`, `equipado` (0, 1 ou 2 mãos), `equipado2{slot, type}` | enum (reduzida, normal, aumentada, gigante) / int / slot (hand, body, both) |
| | `rolls` iniciais | ataque `[[], ["luta", ""], [""]]` e dano `[["1d6", "dano"], ["padrao"]]` |
| `equipamento` | `tipo` | leve, pesada, escudo, acessório, traje, … |
| | `armadura{value, maxAtr, penalidade ≤ 0}` | int. Entram na Defesa e na penalidade de armadura |
| | `equipado`, `equipado2{slot, type}` | bool / slot |
| `consumivel` | `tipo`, `subtipo` (ex.: `ammo`, `alchemy`), `atqBns` (munição) | texto / int |
| `poder` | `tipo` | ability, classe, concedido, geral, origem, racial, distinção, complicação |
| | `subtipo` | combate, concedido, destino, magia, tormenta |
| `magia` | `circulo` | 1..5 |
| | `escola` | abj, adv, con, enc, evo, ilu, nec, tra |
| | `tipo` | arcana, divina, universal, engenhoca, símbolo |
| | `preparada`, `equipado2` | bool / slot (engenhocas ocupam slot) |
| `classe` | `niveis`, `pvPorNivel`, `pmPorNivel`, `inicial`, `pericias{inatas, numero}` | int / bool / texto. Define nível e PV/PM |
| `race` | `atributos{for..car}`, `atributosDinamicos{value, description}`, `grants[]`, `skills[]` | int / set / escolhas de poderes e perícias |

---

## 3. Proposta para o `shared`

O princípio: o Foundry mistura regra e código (`"luta"`, `"pont"`, `"con"`, `switch (proposito)` aparecem no JS). Nós movemos cada uma dessas decisões para o JSON e deixamos o código só somar coisas que o JSON aponta. Em vez de copiar a estrutura do Foundry, três conceitos genéricos cobrem tudo acima:

- **Modificador** `{ label, target, value, source? }`: substitui `bonus[]`, `outros`, `condi` e `modificadores.*` do Foundry. `target` é um seletor textual que o código interpreta sem conhecer chaves: `attr.for`, `skill.luta`, `skill[tag=ataque]`, `derived.defense`, `resource.pv.max`.
- **Stat derivado**: declarado no JSON com fórmula e placeholders. Defesa, CD, carga e deslocamento viram entradas de uma lista `derived[]`.
- **Ação de item** `{ kind: attack | damage | check | formula, ... }`: substitui `rolls[].parts`. Uma arma tem uma ação `attack` com `skill` e `attributeOverride?` e uma `damage` com fórmula e `damageType`.

### 3.1 Extensão do `SystemDefinitionSchema` e do `tormenta20.json`

Subir para `schemaVersion: 2`.

| Bloco | Adição | Exemplo no `tormenta20.json` |
|---|---|---|
| `attributes[]` | nada novo | valor do personagem = `base + Σ modificadores` |
| `skills[]` | `sizeModifier: boolean`, `tags: string[]`, `variants: boolean` | `fortitude/reflexos/vontade` → `tags: ["resistencia"]`; `luta/pontaria` → `tags: ["ataque"]`; `oficio` → `variants: true` (uma instância por especialidade, substitui as 6 perícias fixas do Foundry) |
| `resources[]` | `hasTemp`, `minFormula`, `perLevel?: { classField, attribute?, firstLevelMultiplier, minPerLevel }` | `pv`: `perLevel: { classField: "hpPerLevel", attribute: "con", firstLevelMultiplier: 4, minPerLevel: 1 }`, `minFormula: "-floor({max}/2)"`; `pm`: `perLevel: { classField: "mpPerLevel" }` |
| `derived[]` (novo) | `{ key, label, formula, editable }` | `defense: "10 + min({attr.des}, {equip.maxAttr}) + {equip.defense}"`, `dc: "10 + {halfLevel} + {attr.spellcasting}"`, `carryLimit: "10 + {attr.for} * 2"`, `armorPenalty: "{equip.armorPenalty}"` |
| `level` (novo) | `{ max, source: "manual" \| "classes", xpTable?: number[] }` | `{ max: 20, source: "classes", xpTable: [0, 1000, 3000, …] }` |
| `sizes[]` (novo) | `{ key, label, skillModifier, tokenCells }` | `med: 0, 1`; `gra: −2, 2`; … |
| `damageTypes[]` (novo) | `{ key, label }` | 13 tipos |
| `currencies[]` (novo) | `{ key, label, ratio }` | TC, TP, T$, TL |
| `traitFields[]` (novo) | `{ key, label, type: text \| enum, options? }` | raça, origem, divindade, tipo de criatura, idiomas |
| `itemKinds[]` (novo) | `{ key, label, physical, hasActivation, hasSave, fields: [{ key, label, type: enum \| number \| boolean \| text, options?, default? }], statBonuses?: string[] }` | `weapon` com `purpose`, `wield`, `proficiency`, `critRange`, `critMult`, `properties`; `armor` com `type` e `statBonuses: ["defense", "maxAttr", "armorPenalty"]`; `spell` com `circle`, `school`, `type`; `power` com `type`, `subtype`; `class` com `hpPerLevel`, `mpPerLevel`, `levels`, `initial` |
| `rolls` | `attack`, `damageAttribute` | `attack: "1d20 + {action.skill}"`; `damageAttribute` como regras por `purpose` → `{ "melee": "for", "thrown": "for", "ranged": null }` e `{ "finesse": { "wield": "light", "attribute": "des" } }`. Isso tira o `switch (proposito)` do código |
| `activation` (novo) | enums de `execution`, `durationUnits`, `rangeUnits`, `targetTypes` | os valores listados na seção 2.2 |

Consequências no parser de dados (`packages/shared/src/dice`):

- aceitar `floor()`, `min()`, `max()` sobre constantes;
- o resolvedor de placeholders ganha `{equip.<stat>}` (soma de `statBonuses` dos itens equipados), `{action.skill}`, `{attr.spellcasting}` (atributo apontado por um campo do personagem) e `{max}` dentro de `minFormula`.

### 3.2 Tipo `Character` (novo arquivo `packages/shared/src/schemas/character.ts`)

Hoje não existe nenhum tipo `Character` no `shared`. Proposta:

```ts
CharacterSchema = {
  id, roomId, ownerId: Id | null, systemId, name, imageUrl,
  kind: "pc" | "npc",              // npc: cálculos desligados, tudo editável
  level: number, xp: number,        // ignorado se level.source = "classes"
  attributes: Record<key, { base: number }>,
  skills: Record<key, { trained, other: number, attribute?: key, specialty?: string }>,
  resources: Record<key, { current, temp, maxOverride: number | null }>,
  derivedOverrides: Record<key, number>,   // GM força Defesa 18 num NPC
  modifiers: Modifier[],
  traits: Record<key, string>,             // definidos por traitFields
  currency: Record<key, number>,
  size: key,
  spellcastingAttribute?: key,
  bio: string,
  items: CharacterItem[],
}

CharacterItemSchema = {
  id, kind: key, name, description, quantity, equipped,
  slots: number, price: number,
  fields: Record<key, string | number | boolean>,   // validados contra itemKinds[].fields
  statBonuses: Record<key, number>,                 // { defense: 5, armorPenalty: -2 }
  actions: Action[],
  activation?: { cost, execution, duration{units, value}, range{units, value}, target, area, effect },
  save?: { skill: key, attribute?: key, bonus: number, text },
}

ActionSchema = {
  key, label, kind: "attack" | "damage" | "check" | "formula",
  formula?, skill?, attributeOverride?, damageType?, critRange?, critMult?,
}

ModifierSchema = { id, label, target: string, value: number, source?: Id }
```

Uma função pura `computeCharacter(def, character)` no `shared` devolve `{ attributes, skills, resources{max, min}, derived }`. Servidor e cliente rodam a mesma função; o servidor continua fonte da verdade para rolagens e persistência. Os placeholders do chat (`{attr.for}`, `{skill.percepcao}`) passam a ser resolvidos a partir desse resultado.

### 3.3 Persistência e eventos

- Tabela Prisma `Character` com colunas `id, roomId, ownerId, name, kind` e uma coluna `data Json` com o resto, validada pelo Zod na fronteira. Decisão: a ficha vai evoluir muito e é agnóstica de sistema; colunas fixas seriam Tormenta disfarçada. Uma migration só.
- `Token` ganha `characterId` opcional para o token apontar para a ficha.
- Eventos `character:create`, `character:update`, `character:delete` seguindo o padrão ack + broadcast de `SPEC.md` §6.

### 3.4 Ordem sugerida de implementação

1. Schema v2 + JSON + `computeCharacter` com atributos, perícias, PV/PM por nível manual, derivados simples e modificadores. Testes no `shared`.
2. Itens físicos com `statBonuses` e ações de ataque e dano, ligando com o chat de dados.
3. Poderes e magias com ativação, custo de PM e CD de resistência.
4. Classes e raças como itens que alimentam nível e PV/PM automáticos.

Fica de fora de propósito, por ser automação pesada ou Product Identity: Active Effects, melhorias e encantos de item, progressão por nível com escolhas, compêndios.

### 3.5 Decisões tomadas (06/09/2026)

- `Character` no banco = colunas `id, roomId, ownerId, name, kind` + `data Json`, validado por Zod na entrada e na saída.
- `target` dos modificadores = seletor textual validado por regex (`rules/modifierTarget.ts`).
- Fases 1 e 2 implementadas juntas; 3 e 4 ficam para depois.
- O tipo `Character` já cobre poderes, magias e ativação (`activation`, `save`), mesmo sem lógica.
- O servidor continua a única fonte de rolagens; o cliente roda `computeCharacter` só para exibir.

### 3.6 Estado da implementação

| Fase | Estado | Onde |
|---|---|---|
| 1. Schema v2 + JSON + `computeCharacter` + modificadores | **feito** | `packages/shared/src/schemas/system.ts`, `systems/tormenta20.json`, `src/rules/` |
| 2. Itens físicos com `statBonuses` e ações de ataque/dano ligadas ao chat | **feito** | `rules/rolls.ts`, `apps/server/src/socket/character.ts`, `apps/web/src/components/sheet/` |
| 3. Poderes e magias com ativação, custo de PM e CD de resistência | **feito** | `rules/activation.ts`, `activation.*` no JSON, `character:use-item`, `ItemCardMessage` no chat; plano em `plano-passo3.md` |
| 4. Classes e raças como itens alimentando nível e PV/PM | pendente | `ResourceDef.perLevel` e `level.source = "classes"` já existem no schema, ignorados por enquanto |

Diferenças em relação à proposta original, todas para manter o código sem chave de Tormenta:
- `equipStats[]` ganhou `aggregate` (`sum`/`min`/`max`) e `default`, para o limite de atributo da armadura pesada ser "sem limite" quando não há armadura.
- `attackSkills[]` no JSON diz quais perícias servem para ataque (antes a UI teria de conhecer a tag `ataque`).
- Os placeholders contextuais (`{attr}`, `{trained}`, `{sizeMod}`, `{armorPenalty}`, `{skill}`, `{max}`) ficaram documentados no cabeçalho de `system.ts`; `validateSystemDefinition` confere todos os placeholders do JSON.
- Sem `systemId` na ficha: a sala já tem o sistema.
- Moedas: os valores de `ratio` em `currencies[]` foram preenchidos de memória e **precisam ser conferidos no livro**; hoje são só informativos.
- Fase 3: em vez de `derived.dc` servir de CD para itens, o JSON tem `activation.saveDc` com `{saveAttr}`/`{saveBonus}`, porque o item pode trocar o atributo. O custo usa modificadores `resource.<key>.cost` (equivalente ao `custoPM` do Foundry) com piso `activation.minCost`. Execuções passivas são marcadas no JSON (`executions[].passive`), não por chave no código.
