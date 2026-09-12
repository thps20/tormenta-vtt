# Plano: Homebrew da sala (compêndio da sala editável pelo GM)

> Escrito em 12/09/2026, antes de qualquer código. Status: **implementado** (mesmo dia). Resumo em
> `docs/SPEC.md` §9.18. Fecha o TODO de §9.4 ("a sala ainda é um stub") e de `docs/plano-compendio.md`
> ("Fora deste plano: tela de edição do compêndio da sala").

Escopo: o GM cria e edita conteúdo próprio (armas, armaduras, magias, poderes, itens, criaturas) no
compêndio **da sala**, que já tem prioridade sobre o do sistema quando o id bate (`mergeCompendium`,
implementado desde `docs/plano-compendio.md`). Hoje `roomCompendiumSource` é um stub que devolve `[]`
— este plano é só sobre fazer essa fonte ler/gravar num banco de verdade, e dar ao GM uma tela pra
mexer nela. **Nada muda** em como uma entrada é usada depois de existir (inserir na ficha, soltar no
mapa): ela já passa pelo mesmo `entryToItem`/`entryToCharacter` de sempre.

**Fora deste plano** (ver "Perguntas" abaixo): editor de `SavedEncounter`/handouts/notas — já têm tela
própria; exportar/importar cobre só as entradas do compêndio da sala, não a sala inteira (mapas,
tokens, handouts...).

## Decisões confirmadas com o dono do projeto

- **Exportar/importar é só o compêndio da sala** (armas, magias, criaturas homebrew...), não a sala
  inteira (mapas/tokens/handouts ficam de fora — teriam outras dependências, como imagem hospedada, e
  virariam um plano à parte).
- **O id de uma entrada da sala é fixo, gerado só na criação** (slug do nome, com desempate por
  sufixo). Sem campo pra editar depois — sobrepor de propósito uma entrada do sistema fica pra uma
  versão futura, se sentir falta.
- **Importar**: por padrão **pula e avisa** quando o id já existe na sala; um checkbox "sobrescrever
  conflitos" no diálogo de importação (desmarcado) muda esse comportamento para sobrescrever. Ao
  final, um resumo: quantas foram importadas, quantas puladas (com os nomes) e quantas sobrescritas.
  Modo "substituir tudo" (apagar o que não veio no arquivo) fica fora deste plano.

## Decisões de modelagem

1. **Tabela nova, chave composta pelo id legível.** `RoomCompendiumEntry` (não `CompendiumEntry`:
   esse nome já é o tipo do `shared`, e chamar a tabela igual forçaria um alias tipo
   `CompendiumEntry as DbCompendiumEntry` em todo arquivo que usa os dois — mais confuso que só dar
   um nome diferente à tabela). Chave primária **composta** `@@id([roomId, entryId])`, com `entryId`
   sendo o mesmo id legível (`goblin-veterano`) que entra no `CompendiumEntry.id` do shared e decide
   quem vence em `mergeCompendium`. Nada de cuid extra: como o id só precisa ser único **dentro da
   sala** (é o que `mergeCompendium` compara), e todo acesso já passa por `ctx.roomId`, um cuid a
   mais só duplicaria a chave sem servir pra nada.
   ```prisma
   model RoomCompendiumEntry {
     roomId      String
     entryId     String    // slug, ex.: "goblin-veterano" — CompendiumEntry.id depois de montado
     type        String    // "item" | "creature"
     kind        String?   // só "item": chave de itemKinds[] (arma, magia...). null em "creature"
     name        String
     tags        String[]  @default([])
     description String    @default("")
     page        Int?
     /// Resto do corpo mecânico: CompendiumItemBody (menos description/page, já colunas) se type
     /// "item"; { sheet: CreatureSheet } se type "creature". Confirmado por validateCompendiumEntry
     /// (rules/compendium.ts) ANTES de gravar — a coluna Json não valida sozinha.
     data        Json
     /// Soft delete (mesmo padrão de Handout.deletedAt): apagar entra no desfazer do GM.
     deletedAt   DateTime?
     createdAt   DateTime  @default(now())
     updatedAt   DateTime  @updatedAt

     room Room @relation(fields: [roomId], references: [id], onDelete: Cascade)

     @@id([roomId, entryId])
   }
   ```
   Colisão de `entryId` na criação (nome vira o mesmo slug de uma entrada já existente, **inclusive
   apagada** — a chave primária não distingue apagado de vivo) ganha sufixo numérico, mesma regra do
   importador (`scripts/import-foundry-compendium.ts#slug`, que viraria uma função só em
   `packages/shared` reaproveitada pelos dois lugares).

2. **Cópia, nunca vínculo — reaproveita as regras que já existem.** `characterItemToCompendiumBody`
   e `creatureSheetFromCharacterData` (novas, `rules/compendium.ts`) são o **caminho inverso** de
   `entryToItem`/`entryToCharacter`: tiram os `id` de item/ações e (na criatura) os campos que
   `CreatureSheet` não tem (`imageUrl`, `bio`). O editor web trabalha o tempo todo com
   `CharacterItem`/`CharacterData` (as mesmas seções da ficha, ver decisão 4) e só na hora de salvar
   converte pra `CompendiumItemBody`/`CreatureSheet`. `validateCompendiumEntry` roda nos dois lados:
   no servidor sempre (fronteira = Zod + regra de sistema), no cliente também, cedo, pra mostrar o
   erro ("perícia desconhecida") antes de gastar uma emissão de socket.

3. **Eventos novos, mesmo desenho de `handout:*`/`encounter:*` (gmOnly, broadcast só pra `rooms.gm`).**
   Ficam no domínio `compendium:` (já existe `compendium:list`/`compendium:spawn-creature`) em vez de
   um recurso novo:
   - `compendium:room-create` `{ entry }` → valida contra o sistema, gera `entryId` do nome (com
     desempate), grava, devolve o `CompendiumEntry` completo. Broadcast `compendium:room-created`.
   - `compendium:room-update` `{ entryId, entry }` → mesma validação, substitui o corpo inteiro (o
     editor sempre manda a entrada completa, não um patch parcial — é como a ficha já funciona:
     `ItemsSection` sempre reescreve o array de itens inteiro). `entryId` não muda (Q2). Broadcast
     `compendium:room-updated`.
   - `compendium:room-delete` `{ entryId }` → soft delete + entrada no desfazer (`pushEntry`, mesmo
     padrão de `buildHandoutDeleteHistoryEntry`: `revert` volta `deletedAt: null` e reemite
     `compendium:room-created`; `apply` marca `deletedAt` e emite `compendium:room-deleted`).
     Broadcast imediato + a entrada de desfazer pra quando o GM apertar Ctrl+Z depois.
   - `compendium:room-export` `{}` → devolve `{ entries: CompendiumEntry[] }` com tudo que não está
     apagado. O cliente vira isso num arquivo (`Blob` + link, sem rota HTTP nova: é só texto, cabe
     tranquilo numa resposta de socket, igual todo o resto do app já faz).
   - `compendium:room-import` `{ entries: CompendiumEntry[], overwriteConflicts: boolean }` → valida
     CADA entrada; a que falhar é **pulada e reportada**, não derruba o lote inteiro (diferente do
     importador offline, que aborta tudo — aqui é uma ação do GM em produção, melhor ele ver "12
     importadas, 1 pulada: perícia desconhecida" do que perder as 12 boas por causa de 1 ruim). Id que
     já existe na sala: pulada (`reason: "já existe na sala"`) se `overwriteConflicts` for `false`
     (padrão, checkbox desmarcado no diálogo), sobrescrita se for `true`. Ack
     `{ imported: number, overwritten: number, skipped: { id: string; name: string; reason: string }[] }`
     — a tela mostra os três números e a lista de puladas por nome.
   - `listCompendium`/`roomCompendiumSource` (`services/compendium.ts`) deixa de devolver `[]`: lê
     `RoomCompendiumEntry` da sala (`deletedAt: null`), monta cada linha num `CompendiumEntry` (junta
     as colunas com o `data`) e valida com `validateCompendiumEntry` antes de entrar no merge — uma
     linha corrompida (não deveria acontecer, já que validamos na gravação) fica de fora com um aviso
     no log, não derruba a sala inteira.

4. **Editor reaproveita a ficha, não um formulário novo.** A pedra angular do pedido ("nada de
   formulário novo do zero") já é viável porque as seções da ficha (`ItemsSection`, `SkillsSection`,
   `AttributesGrid`...) recebem `character`/`computed`/`onPatch` como props simples — nenhuma delas
   fala com o socket diretamente (quem faz isso é `CharacterSheetDrawer`, por fora). Então:
   - **Item novo/editar item** (`RoomEntryEditor`, novo, `components/compendium/`): monta uma ficha
     de mentira em memória (`Character` local, nunca salva como personagem) com **um item só**, e usa
     `<ItemsSection>` de verdade — só que com uma cópia do `SystemDefinition` cujo `itemKinds` tem
     **um item só** (o tipo escolhido em "Novo <tipo>"), então a seção nem mostra abas de outros
     tipos nem deixa adicionar um segundo item. `onPatch` não emite socket: só atualiza o estado local
     do editor. Um campo a mais fora da seção pra `tags` (o único campo que `CompendiumItemBody` tem
     e `CharacterItem` não).
   - **Criatura nova/editar criatura**: mesma ideia, mas com a ficha inteira — `AttributesGrid`,
     `ResourcesBlock`, `DerivedStatsBar`, `SkillsSection`, `ItemsSection` (agora sem filtrar
     `itemKinds`, porque uma criatura carrega itens de qualquer tipo) e `ModifiersSection`, todas
     against um `Character` `kind: "npc"` de mentira. Duplicar uma criatura do sistema pré-popula esse
     rascunho com `entryToCharacter(def, entry, idTemporário)`. Campos que `CreatureSheet` não tem
     (`imageUrl`, `bio`) ficam sem seção equivalente no editor (o `CharacterDataSchema.omit(...)` do
     lado shared já ignora essas chaves ao salvar; não precisa impedir na UI, só não oferecer).
   - **Salvar**: converte o rascunho (`characterItemToCompendiumBody`/`creatureSheetFromCharacterData`,
     decisão 2), roda `validateCompendiumEntry` no cliente pra mostrar erro cedo, e emite
     `compendium:room-create`/`-update`.

5. **Onde entram os botões, tudo dentro da `CompendiumPalette` que já existe** (sem tela nova):
   - Um botão **"Novo ▾"** no cabeçalho da paleta, só GM, com um item por tipo (criatura + cada
     `def.itemKinds[]`) — abre o `RoomEntryEditor` vazio daquele tipo. Fica sempre visível pro GM
     (não só quando `roomIds.length > 0`, senão não dá pra criar a primeira entrada).
   - Cada entrada do compêndio do **sistema** ganha um botão **"Duplicar para a sala"** no preview
     (`EntryPreview`/`CreaturePreview`), só GM — abre o `RoomEntryEditor` pré-preenchido.
   - Cada entrada de origem **sala** (já identificável por `roomIds.includes(entry.id)`, mecanismo que
     já existe) troca esse botão por **"Editar"** e **"Apagar"** no preview.
   - Exportar/Importar: dois botões pequenos ao lado do chip "Sala" (que passa a aparecer sempre pro
     GM, não só quando há conteúdo — precisa existir pra abrigar esses botões mesmo com a sala vazia).
     Importar abre um `<input type="file">`; exportar dispara o download do Blob.

6. **Testes** (`make test` deve continuar passando, roda contra o Postgres do `make up`):
   - `packages/shared/src/rules/compendium.test.ts`: `characterItemToCompendiumBody`/
     `creatureSheetFromCharacterData` iom de volta o que `entryToItem`/`entryToCharacter` esperam
     (round-trip); `validateCompendiumEntry` rejeita o que já rejeitava antes (sem mudança de
     comportamento pra quem já usa).
   - `apps/server/src/services/compendium.test.ts`: troca a asserção "roomIds vem vazio" por um
     cenário com uma sala semeada com 1-2 `RoomCompendiumEntry`, confirmando prioridade sala > sistema
     em id repetido e que `roomIds` reflete o que está no banco.
   - Novo `apps/server/src/socket/roomCompendium.test.ts` (mesmo estilo de `notes.test.ts`/
     `scene.test.ts`): create/update/delete/undo, uma entrada inválida rejeitada na gravação, export
     devolve só o não-apagado, import pula conflito por padrão e sobrescreve com
     `overwriteConflicts: true`, uma entrada ruim no import não derruba as boas.

## Passos (cada um termina com `make typecheck && make test`)

1. **`shared`**: `characterItemToCompendiumBody`, `creatureSheetFromCharacterData`, função `slug`
   compartilhada (movida de `scripts/import-foundry-compendium.ts` pra `packages/shared`, script passa
   a importar de lá). Testes.
2. **Banco**: migration `RoomCompendiumEntry` (`make db-migrate`), relação em `Room`.
3. **Server**: `services/compendium.ts` real (lê a tabela), `services/roomCompendium.ts` novo
   (create/update/delete/export/import + geração de `entryId` com desempate), eventos em
   `events.ts` + handlers em `socket/compendium.ts` (create/update/delete com undo) e talvez
   `socket/roomCompendiumImportExport.ts` separado se o arquivo ficar grande. Testes.
4. **Web**: `store/compendium.ts` ganha as ações (`saveRoomEntry`, `deleteRoomEntry`, `exportRoom`,
   `importRoom`) e os listeners de `compendium:room-*` (mesmo padrão de `store/handouts.ts`).
5. **Web**: `RoomEntryEditor.tsx` (item e criatura, decisão 4).
6. **Web**: botões na `CompendiumPalette`/`EntryPreview`/`CreaturePreview` (decisão 5), exportar/
   importar.
7. **Docs**: `docs/SPEC.md` §9.18 (resumo) + §9.4 (tira o "a sala ainda é um stub"), este arquivo
   passa a "implementado".

## Decisões tomadas durante a implementação

- **`nextEntryId` também não pode colidir com o compêndio do SISTEMA**, não só com o da própria
  sala: o plano original só desempatava contra outros ids da sala, o que deixaria um nome como
  "Espada Longa" sobrepor a "espada-longa" do sistema sem o GM ter pedido isso — exatamente o que a
  decisão de id fixo (Q2) queria evitar. Corrigido antes de fechar o passo 3 (commit `Corrige
  nextEntryId`).
- **`ItemsSection` ganhou um prop `hideCompendiumButton`**: o botão "Do compêndio" dela abriria a
  MESMA paleta que já está por trás do `RoomEntryEditor` (nada a inserir ali dentro do editor) — em
  vez de reescrever a seção, só um booleano pra esconder esse botão específico no contexto do editor.
  Continua sendo reaproveitar, não recriar.
- **Teste do passo 3 foi `services/roomCompendium.test.ts`, não `socket/roomCompendium.test.ts`**
  como o plano original sugeria: os handlers de socket são só `guarded` + emitir (mesmo padrão de
  `handout:*`/`encounter:*`), a lógica que vale testar mora inteira em `services/roomCompendium.ts` —
  não existe infraestrutura de socket/io real nos testes deste projeto (todos os `socket/*.test.ts`
  atuais também só testam funções puras exportadas dos arquivos, nunca sobem um servidor de verdade).
- **Editor de criatura não tem "Anotações" (bio) nem moedas**: `DetailsSection` (a seção que mostra
  os dois) foi deixada de fora — `CreatureSheet` não carrega `bio` (o texto morreria em silêncio ao
  salvar) e moeda fixa numa criatura não é um caso de uso pedido. `description`/`page`/`tags`, que
  SÃO metadado real da entrada, ganharam três campos pequenos no cabeçalho do editor.
- **Sem verificação em navegador ao vivo**: o Chrome/Edge headless deste ambiente (WSL) não estava de
  pé e o executável não foi encontrado nos caminhos padrão pra subir um novo; a verificação ficou em
  `make typecheck && make test` (250 testes, 27 novos) mais revisão manual de código, que já pegou o
  problema do `hideCompendiumButton` acima antes de rodar. Recomendo um clique-e-veja rápido (chip
  "Sala", "Novo", "Duplicar para a sala", editar/apagar, exportar/importar) na próxima sessão com o
  navegador de teste de pé — sala semeada por `make seed-test`, GM em
  `http://localhost:5173/room/TESTE1?gm=mesa-de-teste-gm-secret&session=mesa-de-teste-mestre-token`.
