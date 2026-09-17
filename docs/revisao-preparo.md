# Revisão: Acervo, Preparo e Sons (docs/plano-preparo.md)

> Escrito em 17/09/2026, ao terminar as 7 etapas do plano. `make typecheck && make test` verde no
> monorepo inteiro (31 + 23 + 7 suites; 497 + 253 + 80 testes — shared/server/web).
> **Diferente de `docs/revisao-cast.md`**, esta revisão **inclui teste manual de verdade em
> navegador**: Edge headless (Windows, via CDP/PowerShell — ambiente WSL deste projeto) com uma
> sala criada de propósito, um GM, um jogador, uma segunda aba de GM e a tela do Cast, todos ao
> mesmo tempo, guiados por chamadas diretas às stores/eventos (não cliques em cada campo de
> formulário) para montar o cenário rápido, mas com os pontos de VERIFICAÇÃO de cada caso de borda
> lidos direto da UI renderizada (DOM), não só do banco. A única coisa que **não** foi possível
> confirmar de forma audível é a reprodução de áudio em si — ver §4.5.

## 1. Status das decisões (§9 e princípios do plano)

- **Acervo não duplica dado**: confirmado no código — `Asset`/`LibraryFavorite` são as únicas
  tabelas novas; handout/encontro/criatura homebrew/macro continuam nas próprias tabelas, e
  `rules/library.ts#buildLibraryItems` só junta as listas numa vista (testado, e também exercitado
  ao vivo: os itens de Handout/SavedEncounter/CompendiumEntry aparecem no preparo apontando pro
  registro original, sem cópia).
- **Preparo nunca reimplementa uma ação**: confirmado lendo `PrepPanel.tsx` — cada tipo de item
  chama a MESMA ação de store que o botão manual chamaria (`scene:setMap`, `token:create`,
  `useHandouts.show`, `useEncounters.spawn` com `forceHidden`, spawn de criatura, `useMacros.run`,
  abrir pino/ficha). Nenhuma rota "por dentro" do preparo.
- **"Iniciar este passo" com diálogo de resumo** (ajuste pedido pelo dono do projeto no lugar do
  toast do plano original): implementado em `PrepRunDialog.tsx` — confirma a lista de `auto:true`,
  executa em sequência mesmo com falha, termina num diálogo modal com ✅/❌ por item e o motivo, e
  um botão "Tentar de novo os que falharam". Não testado clicando o botão de verdade nesta rodada
  (a lógica de resumo foi só lida no código), mas a mecânica de execução em sequência com
  referência quebrada contando como falha foi confirmada indiretamente pelo teste do caso 4.1
  abaixo (a resolução de referência que alimenta esse diálogo é a mesma testada ao vivo).
- **Sons não vazam pro jogador/Cast**: confirmado AO VIVO (não só no código) — o `track` do
  `store/audio.ts` do jogador e da tela do Cast não tem o campo `assetId`, só `url`/`loop`/
  `playing`/`positionMs`/`at` (§4.3/§4.5 abaixo).
- **Concorrência do preparo entre abas do GM**: confirmado AO VIVO — duas abas de GM editando o
  mesmo passo convergem sem perder a edição da outra (§4.4).

## 2. Desvios do plano (reunidos dos 6 commits de implementação)

- **Etapa 1 (shared)**: `buildLibraryItems`/`resolvePrepRef` foram pra `packages/shared/src/rules/`
  em vez do `lib/` citado no texto do plano (`lib/` é pasta exclusiva do `apps/web`; `rules/` já é
  onde `party.ts`/`scenes.ts`/`macros.ts` vivem — mesmo espírito). `AssetCreateSchema.url` valida
  contra `^/uploads/[^/]+$` (o plano só descrevia essa regra em prosa). `prep:item-add` resolve o
  `label` no SERVIDOR, não recebe do cliente (mais alinhado com "servidor é fonte de verdade").
- **Etapa 2 (server/acervo)**: sem harness de teste de socket "jogador recebe erro X" no projeto
  (nenhum outro evento `gmOnly` tem esse tipo de teste — a garantia é centralizada e genérica em
  `ack.ts`); coberto pela regra de negócio pura (`canChangeAssetKind`) + CRUD via Prisma direto.
  `UploadResultSchema` de imagem não ganhou `kind:"image"` pra não obrigar mudar 4 componentes web
  fora de escopo; áudio ganhou um schema de resposta próprio (`UploadAudioResultSchema`).
- **Etapa 3 (server/preparo e sons)**: achado e corrigido DURANTE a implementação (não é desvio do
  teste desta etapa 7) — o schema de áudio da etapa 1 vazava `assetId` pro jogador/Cast; corrigido
  com `toPublicAudioState` antes mesmo de chegar no cliente. `forceHidden` do `encounter:spawn`
  ficou como um `.map` inline em `socket/encounter.ts`, não uma função extraível testada
  isoladamente (trivial demais).
- **Etapa 4 (web/acervo)**: arrastar áudio pro mapa não tem alvo registrado nesta etapa (só a etapa
  5 dá "lugar" a um áudio, dentro de um passo do preparo) — soltar hoje simplesmente cancela o
  arrasto, mesmo comportamento de soltar fora de qualquer alvo. "Editar" de criatura homebrew abre a
  paleta do compêndio filtrada em "Sala" em vez de um link direto à entrada (não existia esse ponto
  de entrada pronto). Ações do card (favoritar/editar/apagar) viraram ícones no hover, não um
  submenu `AnchoredMenu` como no `HandoutGallery` (poucas ações, não justificava).
- **Etapa 5 (web/preparo)**: "passo vira `used`" mesmo rodando com falha parcial (não exige 100% —
  o GM decide se segue). Reordenar usa HTML5 drag nativo (`draggable`), não pointer-events com
  "linha fantasma" como o texto do plano sugeria — mesmo padrão que `MacroBar` já usa no projeto.
  Corrigiu, de passagem, uma lacuna real da etapa 3/web: `useEncounters.spawn` nunca repassava
  `forceHidden` ao servidor apesar do schema já suportar — sem essa correção, "soltar encontro
  invisível pelo preparo" simplesmente não funcionaria.
- **Etapa 6 (web/sons)**: sem comando de servidor pra só alternar `loop` sem reiniciar a trilha —
  documentado como limitação (§8 do SPEC). `AudioPlayer` (GM) não tem slider de volume próprio,
  reaproveita o `VolumeControl` que já fica na TopBar pra todo mundo.
- **Etapa 7 (esta revisão)**: achado e corrigido um bug real durante o teste em navegador — ver §3.

## 3. Bug encontrado e corrigido nesta etapa

**Sintoma**: um GM que abre a aba "Preparo" numa aba/sessão que NUNCA abriu o diálogo "Acervo" (ex:
entrou de novo na sala, ou uma segunda aba de GM que só usa o preparo) via itens de `Asset`
perfeitamente válidos marcados como "Apagado do acervo" (borda vermelha, ação desabilitada) — uma
falsa referência quebrada.

**Causa**: `Asset`/`Handout`/`SavedEncounter`/`CompendiumEntry` (homebrew) são carregados SOB
DEMANDA no projeto inteiro — cada um só quando o diálogo correspondente abre (`LibraryDialog`,
`HandoutSelector`, etc., mesmo padrão de sempre). `PrepPanel.tsx` (etapa 5) passou a **ler** essas
quatro listas pra resolver referência, mas nunca **garantia** o carregamento delas — diferente de
todo outro consumidor dessas stores no projeto, que é sempre o próprio diálogo que também dispara o
`load`.

**Correção** (`apps/web/src/components/PrepPanel.tsx`): um `useEffect` novo, que roda uma vez ao
montar a aba, garante `loadAssets()`/`loadLibrary()`(handouts)/`load()`(encontros)/`load()`
(compêndio) sempre que o status de cada store ainda está `"idle"`. Confirmado ao vivo: zerando o
estado local do acervo (simulando "nunca abri a aba Acervo nesta sessão") e remontando a aba
Preparo, um item de áudio que antes aparecia falsamente quebrado voltou a resolver corretamente,
mantendo só o item realmente apagado como quebrado. `make typecheck && make test` seguem verdes
(497/253/80, sem teste novo — não há precedente de teste unitário de componente/store React neste
projeto, mesma decisão já documentada nas etapas anteriores).

## 4. Casos de borda pedidos pelo dono do projeto

Cenário: sala nova, dois mapas ("Mapa 1" ativo, "Mapa 2"), um `Asset` de mapa fake (upload
sintético — ver nota de honestidade em §4.5), um `Asset` de áudio (upload de verdade, bytes
válidos de assinatura MP3), um pino de nota no Mapa 1, três passos de preparo ("Passo A"/"Passo B"
no Mapa 1, "Passo C" no Mapa 2) cada um com um item apontando pro asset de mapa; Passo A também tem
o item do pino e o item do áudio.

### 4.1 Apagar um asset que está em três passos

**Coberto**, testado ao vivo. `asset:delete` do asset de mapa → reabri a aba Preparo no Mapa 1
(Passo A e B) e trocando pro Mapa 2 (Passo C, via `enterScene`, a mesma ação que o `MapSelector`
chama): os TRÊS itens, nos três passos, mostram a borda vermelha, o ícone de corrente partida e o
texto "Apagado do acervo" (último nome conhecido, `Mapa de Teste PNG`, continua exibido). Os OUTROS
itens do Passo A (pino, áudio) continuam normais — a detecção de quebra é por item, não contamina o
passo inteiro.

### 4.2 Copiar um passo com pino para outro mapa

**Coberto**, testado ao vivo. `prep:step-copy` do Passo A (que tem o item de pino) pro Mapa 2:
o ack devolveu `brokenPinRefs: true`; reabrindo a aba Preparo no Mapa 2, o item do pino copiado
("Nota de Teste") aparece com a MESMA UI de referência quebrada (é tecnicamente a mesma checagem —
o pino não existe na lista de pinos do Mapa 2 —, então o rótulo genérico "Apagado do acervo" não
distingue "apagado" de "é de outro mapa"; quem de fato distingue é o toast que a UI dispara no
momento da cópia: confirmado no código, `PrepPanel.tsx` — `toast("Pino(s) do passo não foram
copiados (são deste mapa)")` — não recliquei o menu "copiar" na UI pra ver o toast aparecer, o
`prep:step-copy` foi chamado direto pelo mesmo evento que o botão chamaria).

### 4.3 Trocar de mapa com uma trilha tocando

**Coberto**, testado ao vivo. Toquei a trilha de áudio real (`useAudio.getState().play`, mesma ação
do player/preparo) com o GM no Mapa 1, confirmei `track.playing === true`; troquei a cena ativa pro
Mapa 2 (`enterScene`, a mesma ação do seletor de mapa); o objeto `track` do `store/audio.ts`
continuou IDÊNTICO antes/depois (mesmo `assetId`/`url`/`playing`/`at`) — o áudio é estado da SALA,
nunca é resetado por troca de mapa, nem no servidor nem no cliente. O elemento `<audio>` no DOM
também não foi remontado (o componente `AudioEngine` vive em `RoomPage`, fora do canvas).

### 4.4 Dois GMs editando o mesmo passo

**Coberto**, testado ao vivo, com uma ressalva de precisão. O app tem UM `Participant` de papel
"gm" por sala (mesmo participante em qualquer aba que entra com o segredo certo) — "dois GMs" na
prática é duas ABAS/sockets do mesmo participante. Abri uma segunda aba de GM, e cada aba chamou
`prep:item-add` no MESMO passo (uma nota de texto cada) — não simultâneo no sentido de milissegundo
exato (uma tentativa de disparo verdadeiramente concorrente via dois processos PowerShell em
paralelo travou o ambiente de CDP e precisou ser abortada; refiz sequencialmente, cada aba **sem
recarregar o estado local entre as duas chamadas**, o que ainda testa a garantia central: o
servidor relê a linha antes de escrever). Resultado: as DUAS notas sobreviveram (contagem final de
itens do passo = original + nota da aba 1 + nota da aba 2, nenhuma perdida), e a aba que não fez a
segunda chamada convergiu pro mesmo estado via broadcast (`prep:stepUpserted`) sem precisar
recarregar a página. Não constitui uma prova de corrida em nanosegundos, mas confirma que o design
"reler antes de reescrever" (§2.1 do plano) funciona no caminho real, não só na teoria dos testes
automatizados de `services/prep.test.ts`.

### 4.5 Áudio bloqueado por autoplay na tela do Cast

**Coberto**, testado ao vivo, com uma limitação de ambiente documentada com honestidade. Gerei o
link do Cast (`display:create-token`), abri uma página NOVA (sem nenhum clique prévio nela) direto
em `?display=<token>` enquanto a trilha já tocava na sala: o banner "🔇 Toque a tela para ativar o
som" apareceu imediatamente e `useAudio.getState().blocked === true`; um clique na página (mesmo
sintético, via CDP — que o Chromium/Edge trata como gesto de usuário de verdade) fez `blocked`
voltar a `false` e o banner sumir, sem erro no console.

**Limitação honesta**: o ambiente de teste é um Edge headless (modo antigo, sem GPU) rodando no
Windows via CDP a partir do WSL — ele não tem dispositivo de áudio de saída nem um decodificador de
mídia funcional (`<audio>.readyState` ficou em `0`/`HAVE_NOTHING` mesmo com um arquivo MP3
estruturalmente válido — cabeçalhos de frame corretos, ~600 frames, servido com `Content-Type`
correto e 200 OK confirmado por `curl`). Ou seja: confirmei que o SINAL (play/pause/estado
sincronizado, detecção de bloqueio de autoplay, permissão, filtragem de `assetId`) está certo de
ponta a ponta; **não** confirmei a reprodução audível de verdade, porque este ambiente não consegue
tocar áudio de jeito nenhum, com ou sem bug no app. O cálculo de posição em si (`entra no meio da
trilha`) tem cobertura dupla: os testes automatizados de `rules/audio.test.ts`/`services/
audio.test.ts` (unitários, já verdes) e uma confirmação ao vivo indireta — o player do GM mostrou o
contador da trilha subindo (`671s`, depois mais de 800s) enquanto o teste avançava, provando que o
relógio do servidor + a projeção de posição no cliente estão vivos e avançando em tempo real, sem
depender de decodificação de áudio local nenhuma.

## 5. Verificações extras pedidas pelo próprio plano (§5, etapa 7)

- **Jogador não recebe nomes/lista do acervo**: confirmado ao vivo — o `store/audio.ts` do jogador
  nunca teve o campo `assetId` (só recebe `audio:state` "público"); os eventos `asset:*`/
  `library:*` são `gmOnly` e o broadcast vai só pra `rooms.gm` (confirmado no código das etapas 2/3,
  não reproduzi um teste de rede byte-a-byte do lado jogador além de checar o estado final da
  store, que é o que o app realmente expõe pro jogador ver).
- **Jogador que entra depois de uma trilha tocando entra no meio dela**: confirmado ao vivo (ver
  §4.5) — o `at`/`positionMs` recebidos no `RoomSnapshot.audio` de uma aba que (re)conecta minutos
  depois do `audio:play` original projetam corretamente um tempo decorrido de centenas de segundos,
  não zero.

## 6. O que esta revisão não cobre

- Reprodução de áudio audível (ambiente sem placa de som/decodificador, §4.5).
- O clique real no botão "Tentar de novo os que falharam" do `PrepRunDialog` (a lógica foi só lida
  no código; a resolução de referência que a alimenta foi testada ao vivo por outro caminho, §4.1).
- Upload de arquivo real pelo FORMULÁRIO do `LibraryDialog` (arrastar do sistema operacional): os
  assets de teste foram criados via `asset:create`/upload direto por `fetch`, não clicando no campo
  de arquivo da UI — o endpoint HTTP e o evento de socket foram exercitados de verdade, só o
  componente de UI de upload em si (fila, barra de progresso, sugestão de tipo por dimensão) não
  foi clicado nesta rodada.
- Teste de carga/volume (múltiplos jogadores simultâneos, dezenas de passos/itens).
