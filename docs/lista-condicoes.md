# Lista de condições — revisão

Comparação entre a lista original do plano (feita de memória) e a lista revisada, conferida contra a fonte
real: `~/projetos/foundry-tormenta20/module/conditions/conditions.mjs` (sistema oficial do Foundry, a mesma
fonte que `scripts/import-foundry-compendium.ts` já usa pro compêndio). Cada uma das 38 entradas de lá tem
`condition: true` e um ícone SVG próprio em `icons/conditions/*.svg`.

## Lista anterior (de memória, com erros) — 29 itens

Abalado, Agarrado, Alquebrado, **Amedrontado**, Apavorado, Atordoado, Caído, Cego, Confuso, Desprevenido,
Enfeitiçado, Enjoado, Envenenado, Esmorecido, Exausto, Fascinado, Fatigado, **Frágil**, Imóvel, Inconsciente,
Indefeso, Lento, Ofuscado, Paralisado, Pasmo, Petrificado, Sangrando, Surdo, Vulnerável.

## Lista revisada (conferida na fonte) — 35 itens

Abalado, Agarrado, Alquebrado, Apavorado, Atordoado, Caído, Cego, Confuso, **Debilitado**, Desprevenido,
**Doente**, Enfeitiçado, Enjoado, **Enredado**, Envenenado, Esmorecido, Exausto, Fascinado, Fatigado,
**Fraco**, **Frustrado**, Imóvel, Inconsciente, Indefeso, **Invisível**, Lento, **Morto**, Ofuscado,
Paralisado, Pasmo, Petrificado, Sangrando, Surdo, **Surpreendido**, Vulnerável.

(negrito = mudou em relação à lista anterior)

## Diferenças

**Removidas (não existem como condição própria):**
| Nome | Motivo |
|---|---|
| Amedrontado | Não existe na fonte. Provável confusão com "Apavorado", que já estava na lista. |
| Frágil | Não existe na fonte. O nome correto da condição de fraqueza é "Fraco". |

**Adicionadas (condições reais que faltavam):**
| Nome |
|---|
| Debilitado |
| Doente |
| Enredado |
| Fraco |
| Frustrado |
| Invisível |
| Morto |
| Surpreendido |

**Sem mudança:** Abalado, Agarrado, Alquebrado, Apavorado, Atordoado, Caído, Cego, Confuso, Desprevenido,
Enfeitiçado, Enjoado, Envenenado, Esmorecido, Exausto, Fascinado, Fatigado, Imóvel, Inconsciente, Indefeso,
Lento, Ofuscado, Paralisado, Pasmo, Petrificado, Sangrando, Surdo, Vulnerável (27 itens).

**Resumo:** 29 → 35 (2 removidas, 8 adicionadas, 27 mantidas).

## Pendente de decisão: as 3 borderline

O arquivo-fonte tem 38 entradas com `condition: true`, não 35. As 3 de fora da lista revisada são mecânicas
de outros capítulos do livro, não do capítulo "Condições":

| Nome | De onde vem |
|---|---|
| Sustentando | Concentração em magia (capítulo de magias) |
| Sobrecarregado | Carga/equipamento (capítulo de equipamento) |
| Em Chamas | Perigo ambiental |

Incluí-las ou não na lista final de `conditions[]` fica a critério do dono do projeto — levaria o total a
36–38. Ver `docs/plano-condicoes.md` para o resto do plano.
