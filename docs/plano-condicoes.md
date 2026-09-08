# Plano: condições nos tokens

Marcadores de condição nos tokens, lidos do JSON do sistema. Pedido original:

> Marcadores de condição nos tokens, lidos do JSON do sistema.
> - tormenta20.json ganha conditions[]: { key, label, icon, color, description? } (ícones de um set embutido
>   ou SVG simples; nada de arte externa). Cadastre as condições do livro que couberem como mecânica;
>   descrição fica vazia ou vem do arquivo local (mesmo padrão de descriptions.local.json já usado no compêndio).
> - Token ganha conditions: string[] (migration). Menu de contexto no token (botão direito ou botão na seleção):
>   lista de condições com toggle. GM em qualquer token; jogador nos próprios.
> - Render: ícones pequenos na borda do token (máx. 6 visíveis, "+N" depois). Tooltip com nome e descrição.
> - Sincronizado por socket, persistido. Sem automação de regra por enquanto (deixe a estrutura pronta para
>   condições virarem modificadores na ficha depois: cada condição pode ter modifiers[] no JSON, ainda ignorado).

Commits pequenos. Mostrar o plano antes e esperar aprovação.

## Decisões

**1. Armazenamento no Prisma:** `Token.conditions` como coluna nativa `String[] @default([])`, não `Json`. A
regra do projeto reserva `Json` para campos que vão evoluir de forma imprevisível (grid, resultado de
rolagem); aqui é sempre uma lista de chaves (`string[]`), igual em espírito a `width`/`height` — mais simples
de migrar e não precisa do tratamento especial que `hp` (Json) exige (`Prisma.JsonNull` etc.).

**2. Formato do ícone:** guardar em cada condição um **SVG simples inline** (`icon: "<svg>...</svg>"`, um só
path monocromático). Cobre os dois lugares que precisam desenhar o ícone com a mesma fonte de verdade:
- No **menu** (React/DOM): `<span dangerouslySetInnerHTML>`.
- No **canvas** (Konva, que não renderiza componentes React): converter o SVG numa `data:image/svg+xml` e
  carregar com o hook `useImage` que já existe (mesmo usado pra imagem do token), desenhando como
  `Konva.Image` pequeno na borda.

Alternativa mais simples seria emoji (Konva desenha texto unicode de graça), mas destoa da estética do resto
da UI — preferência por SVG. Emoji fica como opção B se quiser economizar o trabalho de desenhar ~20 ícones.

**3. Descrição das condições — atenção:** o padrão de `descriptions.local.json` do compêndio funciona porque
o compêndio é **só do servidor** (`packages/shared/compendium`, lido do disco, mandado por socket). O JSON de
sistema (`systems/tormenta20.json`) é diferente: é importado estaticamente e **compilado dentro do bundle do
web** (`systems.ts` faz `import ... with { type: "json" }`). Não dá pra ter um arquivo git-ignorado
complementando isso no navegador sem reestruturar como o cliente recebe a definição do sistema (ex.: mandar
por socket em vez de bundlar) — mais invasivo que o pedido original.

Proposta para este MVP: `description` fica **vazia** (a opção já dada como aceitável) em todas as condições.
Se um dia for necessário o texto oficial do livro nas condições, aí sim vale discutir mover a entrega do
`SystemDefinition` pro socket.

## Commits propostos (pequenos, shared → server → web)

1. **shared**: `ConditionDefSchema` em `system.ts` (`key, label, icon, color, description default "",
   modifiers[] default []` reaproveitando `ModifierTargetSchema` já usado nos modificadores de ficha) + campo
   `conditions: []` no `SystemDefinitionSchema` + validação de chave única (padrão dos outros
   `assertUnique`).
2. **shared**: preencher `conditions[]` no `tormenta20.json` com as condições do livro que são só "etiqueta"
   (sem automação ainda). Lista conferida contra a fonte real (ver "Lista de condições" abaixo), não de
   memória: **35** condições, Abalado a Vulnerável.

### Lista de condições (fonte: Foundry, não memória)

A primeira versão deste plano tinha uma lista de cabeça, com dois nomes errados ("Amedrontado", que não
existe — provável confusão com "Apavorado"; e "Frágil", que devia ser "Fraco") e 8 condições reais faltando.
Corrigido conferindo `~/projetos/foundry-tormenta20/module/conditions/conditions.mjs` (sistema oficial do
Foundry, a mesma fonte que `scripts/import-foundry-compendium.ts` já usa pro compêndio) — ele marca
`condition: true` em cada uma e tem ícone SVG próprio em `icons/conditions/*.svg` para todas.

O arquivo tem 38 entradas com `condition: true`, mas 3 são mecânicas de outros capítulos do livro (não do
capítulo "Condições"), então ficam de fora da lista principal, sujeitas a confirmação:
- **Sustentando** (concentração em magia, capítulo de magias)
- **Sobrecarregado** (carga/equipamento, capítulo de equipamento)
- **Em Chamas** (perigo ambiental)

Lista final proposta (35, alfabética):

Abalado, Agarrado, Alquebrado, Apavorado, Atordoado, Caído, Cego, Confuso, Debilitado, Desprevenido, Doente,
Enfeitiçado, Enjoado, Enredado, Envenenado, Esmorecido, Exausto, Fascinado, Fatigado, Fraco, Frustrado,
Imóvel, Inconsciente, Indefeso, Invisível, Lento, Morto, Ofuscado, Paralisado, Pasmo, Petrificado, Sangrando,
Surdo, Surpreendido, Vulnerável.

Pendente de decisão: incluir ou não Sustentando/Sobrecarregado/Em Chamas junto (levaria a lista a 36–38).
3. **shared**: `conditions: string[]` no `TokenSchema` (propaga sozinho pro `TokenCreateSchema`/
   `TokenPatchSchema`, que derivam dele).
4. **server**: migration `token_conditions` (`make db-migrate`) + `serialize.ts` (mapear a coluna) +
   `permissions.ts` (adicionar `"conditions"` em `PLAYER_EDITABLE`, pra jogador poder alternar condição no
   próprio token via `token:update` normal — não precisa de evento novo).
5. **web**: componente `ConditionMenu` (popover com a lista de `systemDef.conditions`, checkbox/toggle por
   condição) + botão de gatilho quando há um token selecionado (perto do `TokenInspector`).
6. **web**: gatilho por botão direito no token (Konva `onContextMenu`, com `preventDefault` do menu nativo)
   abrindo o mesmo popover na posição do cursor.
7. **web**: badges na borda do `TokenNode` (máx. 6 + "+N"), com tooltip (Konva `Label`/`Tag`, mostra no
   hover) trazendo nome + descrição.
8. **docs**: atualizar `docs/SPEC.md` §3.3 descrevendo o campo e o menu (regra do projeto: mudou
   comportamento do SPEC, atualiza no mesmo commit).

No final: `make typecheck && make test` (adicionar um teste rápido em `systems.test.ts` pra chave de condição
duplicada, seguindo o padrão que já existe lá).

## Referências levantadas na exploração

- `packages/shared/src/schemas/system.ts` — `SystemDefinitionSchema`, `validateSystemDefinition` (padrão de
  `assertUnique` e checagem de placeholders).
- `packages/shared/src/schemas/token.ts` — `TokenSchema`/`TokenCreateSchema`/`TokenPatchSchema`.
- `packages/shared/src/rules/modifierTarget.ts` — `ModifierTargetSchema` (reaproveitável pros `modifiers[]`
  ignorados da condição).
- `packages/shared/src/schemas/character.ts` — `ModifierSchema` (formato `{ target, value }` usado na ficha).
- `packages/shared/src/systems.ts` — import estático do JSON do sistema (por isso a descrição não pode vir
  de arquivo local do jeito do compêndio).
- `packages/shared/src/compendium/index.ts` — padrão `descriptions.local.json` (server-only).
- `apps/server/prisma/schema.prisma` — modelo `Token` (campos simples vs. `Json`).
- `apps/server/src/socket/token.ts` — handlers `token:create`/`token:update`/etc., `hpJson` (tratamento
  especial de `Json?` que `conditions` não precisa).
- `apps/server/src/services/permissions.ts` — `PLAYER_EDITABLE`, `canEditToken`.
- `apps/web/src/store/tokens.ts` — store Zustand de tokens (patch otimista com ack/reversão).
- `apps/web/src/components/TokenInspector.tsx` — painel lateral do token selecionado (candidato a botão de
  gatilho do menu de condições).
- `apps/web/src/components/VttCanvas.tsx` — `TokenNode` (renderização Konva do token, sem DOM: ícones de
  condição precisam ser `Konva.Image`/shapes, não componentes React).
- `apps/web/src/lib/useImage.ts` — hook de carregar imagem pro Konva (aceita `data:` URI, reaproveitável pro
  ícone SVG rasterizado).
- `docs/SPEC.md` §3.3, §3.6 — escopo de tokens e modificadores (`Modificador = { target, value }`).
