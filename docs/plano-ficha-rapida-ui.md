# Plano: trocar NpcQuickCard pela UI do AI Studio

Pedido original:

> Em ~/projetos/tormenta-vtt-telas foi adicionado src/components/NpcQuickCard.tsx (ignore os outros
> arquivos alterados). Substitua a versão mínima do NpcQuickCard do tormenta-vtt por ele, adaptando aos
> tipos do shared (adapte a UI ao shared, nunca o contrário) e mantendo os callbacks já ligados
> (onHpChange, onRoll, onUseItem, onToggleCondition, onOpenFullSheet, onOpenTokenInspector, onClose).
> Nenhum cálculo na UI: tudo vem de computed e def. Commits pequenos; plano antes, espere aprovação.

## Contexto

`apps/web/src/components/NpcQuickCard.tsx` hoje é a versão MÍNIMA descrita em
`docs/tipos-ficha-rapida.md` (contrato pensado pro AI Studio desenhar a UI de verdade). O arquivo novo em
`tormenta-vtt-telas/src/components/NpcQuickCard.tsx` foi gerado no AI Studio contra uma **cópia à mão**
desses tipos (colada na ferramenta) — não contra `packages/shared` de verdade. Comparei os dois arquivos
com os schemas reais (`packages/shared/src/schemas/{system,character}.ts`, `rules/compute.ts`,
`rules/damageTypes.ts`) e achei divergências: umas são só a cópia ter ficado desatualizada (schema real
mudou depois que o bloco foi colado), outras são a UI inferindo/hardcodando coisa que devia vir do JSON —
o que a Regra nº 1 do `CLAUDE.md` proíbe.

A interface `NpcQuickCardProps` (nomes e tipos dos 7 callbacks) **não muda** — `VttCanvas.tsx` já chama o
componente com esses props e continua chamando do mesmo jeito depois da troca.

## Divergências: schema real diferente do que a UI nova assume (bug se não corrigir)

1. **Ícone de condição.** A UI nova tem um `CONDITION_ICONS: Record<string, LucideIcon>` e espera que
   `ConditionDef.icon` seja um nome do lucide ("HeartCrack", "Skull"...). O schema real
   (`ConditionDefSchema.icon`) é uma **string com um `<svg>...</svg>` completo embutido no JSON** — é
   assim que a versão mínima atual já renderiza (`dangerouslySetInnerHTML={{ __html: c.icon }}`), tanto no
   menu quanto (em outro componente) rasterizado pro token no mapa. Vou trocar o lookup por lucide por
   `dangerouslySetInnerHTML` com `cond.icon`, e remover os imports de ícone de condição (`HeartCrack`,
   `ArrowDown`, `ZapOff`, `EyeOff`, `ShieldAlert`, `Skull`, `Anchor`, `Moon`, `Droplets`, `AlertTriangle`,
   `ShieldOff`, `Flame`, `Snowflake`) que não têm mais função.

2. **PV do NPC nunca vem de `token.hp`.** A UI nova faz
   `token.hp ? token.hp.current : character.resources[barKey]?.current` (e o mesmo pro máximo). Mas
   `Token.hp` existe só pra token **sem ficha vinculada**; o próprio comentário do schema/contrato diz que
   é "ignorado quando characterId aponta pra uma ficha, que é sempre o caso do NpcQuickCard". Um NPC com
   ficha e com `token.hp` preenchido (herdado de um estado antigo, por exemplo) mostraria o PV errado. Vou
   ler current/max **só** de `character.resources[tokenBar]` / `computed.resources[tokenBar]`, como a
   versão mínima já faz.

3. **Formato de `damageResponses`.** A UI nova espera um array
   `{ type, response?: "resistance"|"immunity"|"vulnerability", mode?, value? }[]`. O schema real é
   ```ts
   damageResponses: { all: DamageResponse; byType: Record<Key, DamageResponse> }
   DamageResponse = { reduction: number; half: boolean; immune: boolean; vulnerable: boolean }
   ```
   (RD numérica + 3 flags booleanas, não um "modo" único). Vou reescrever a seção de resistências pra ler
   `byType` (um selo por tipo com pelo menos uma flag "ativa": `reduction > 0`, `half`, `immune` ou
   `vulnerable`) e `all` (RD/flags que valem pra qualquer tipo de dano — sem tipo específico, então sem
   selo de cor, só o texto). Um item com `immune` mostra "Imune"; com `vulnerable`, "Vulnerável"; senão,
   combina `RD <reduction>` e/ou "½" conforme o que estiver ativo.

## Divergências: UI hardcoda o que devia vir do JSON (Regra nº 1)

4. `def.creatures?.ndField || 'nd'` e `def.creatures?.typeField || 'tipo'` — chuta as chaves do JSON T20
   quando `def.creatures` não existe. Sem `def.creatures`, o sistema **não tem** bloco de criatura; a UI
   não deve inventar `nd`/`tipo`. Volta a ficar `creatures ? character.traits[creatures.ndField] :
   undefined` (como a versão mínima).

5. `def.tokenBar || 'pv'` e `barDef?.abbr || barDef?.label || 'PV'` — mesmo problema: sem `tokenBar`
   definido, o sistema não tem barra de PV no token (`tokenBar` é opcional no schema exatamente pra isso).
   A seção inteira de PV (barra, botões ±1/±5, delta) só renderiza se `def.tokenBar` existir; sem fallback
   pra `'pv'`/`'PV'`.

6. `computed.resources[key]?.max ?? character.resources[key]?.maxOverride ?? 10` — `computeCharacter` já
   resolve `maxOverride` (e fórmula, e modificadores) dentro de `computed.resources[key].max`; reconsultar
   `character.resources[key]?.maxOverride` por cima é redundante, e o `?? 10` é um número mágico sem
   origem no JSON. Fica só `computed.resources[key]?.max ?? 0`. Mesmo ajuste nos recursos secundários (PM
   etc.).

7. `isMovement = d.key === 'movement' || d.key.includes('desl')` pra decidir se aparece um sufixo "m" no
   stat derivado — `DerivedDef` não tem campo de unidade nenhum; a UI estaria adivinhando semântica pelo
   texto da chave. Removo o sufixo: o valor aparece cru, como a versão mínima já mostra (se algum dia
   precisar de unidade, isso é uma extensão do schema — `DerivedDef.abbr`/um campo novo —, não uma
   inferência no componente).

8. Separação ataques vs. poderes usando `item.kind === 'power' || item.kind === 'ability'` — `kind` é uma
   chave livre de `itemKinds[]` do JSON do sistema, o código não pode comparar com valores fixos. Volto ao
   critério já usado na versão mínima, que não depende do texto de `kind`: **ataque** = item com
   `actions.length > 0` e `activation === null`; **poder/habilidade** = `activation !== null` (qualquer
   `kind`).

9. "Passivo" decidido por `item.activation.execution === 'passive'` — `execution` é uma chave de
   `def.activation.executions[]`, escolhida por quem escreveu o JSON do sistema; o schema já tem o dado
   certo pra isso: `ExecutionDef.passive: boolean`. Troco pra
   `def.activation.executions.find(e => e.key === item.activation.execution)?.passive`.

10. Custo de ativação: `def.resources?.find(r => r.key === 'pm')?.abbr || 'PM'` — hardcoda a chave `pm` e
    o texto `PM`. O schema já tem o ponteiro genérico pra isso: `ActivationDef.resource` ("Recurso
    (resources[].key) descontado por activation.cost"). Troco pra achar o recurso via
    `def.resources.find(r => r.key === def.activation.resource)` e usar `abbr`/`label` dele; sem
    `def.activation.resource`, mostra só o número (custo "só informativo", como o próprio schema
    documenta).

## Limpeza (reaproveitar o que já existe, não duplicar)

11. O selo de tipo de dano nas ações (cor própria, senão a do grupo, senão cinza neutro) já existe pronto
    em `components/DamageTypeBadge.tsx` (`<DamageTypeBadge def={def} type={...} />`, usa
    `rules/damageTypes.ts#damageTypeInfo`) — inclusive é o que a própria versão mínima atual usa. A UI
    nova reimplementou essa lógica à mão (`def.damageTypes?.find(...)` + estilo inline). Vou trocar pelo
    componente existente em vez de duplicar.

## O que fica igual (design novo, sem problema de schema)

- Interface `NpcQuickCardProps` (mesmos 7 callbacks, mesmos tipos) — zero mudança em `VttCanvas.tsx`.
- Layout/visual novo: cabeçalho com badge de ND, barra de PV com botões −5/−1/+1/+5 e campo de delta
  manual, recursos secundários (PM etc.) ao lado do PV, lista de ataques e de poderes com tooltip de
  descrição nos passivos, dropdown de condições com busca visual por ícone, chips de condição ativa com
  botão de remover e rodadas restantes.
- Nenhum cálculo novo na UI: todo número exibido continua saindo de `computed`/`def`, nunca calculado no
  componente (a troca acima é só "de onde" ele lê dentro de `computed`/`def`/`character`, não introduz
  fórmula nova).

## Commits

Um commit só: `Substitui NpcQuickCard pela versão do AI Studio, adaptada ao shared`. Arquivo antigo e novo
não coexistem — não tem como fatiar em passos intermediários que compilem sozinhos. Depois,
`make typecheck && make test`. Sem mudança de escopo/SPEC: é troca de implementação de UI sobre um
contrato que já existia (`docs/tipos-ficha-rapida.md`); os pontos 2 e 3 acima são correção de bug (voltar
ao que o contrato já previa), não comportamento novo.
