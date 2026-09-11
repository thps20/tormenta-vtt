# Backlog

Ideias e melhorias fora do escopo do MVP no momento em que foram anotadas. Não é um roadmap
comprometido — só um lugar para não perder a ideia até o dono do projeto priorizar.

- **Agrupar rolagens de iniciativa em lote num card só.** `combat:roll` com `scope: "npcs"` ou
  `"missing"` publica uma `ChatMessage{kind:"roll"}` por combatente (reaproveita
  `createRollMessage` inteiro: visibilidade, "Revelar", rolagem às cegas). Com muitos NPCs isso
  enche o chat de cards repetidos. Se incomodar na prática, dá para juntar num card de "Iniciativa
  (lote)" com uma linha por combatente — mas perde a granularidade de "Revelar" por um só e exige
  um tipo de card novo. Anotado em 08/09/2026, ao implementar o modo de combate
  (`docs/plano-combate.md`).
- **Reentregar ao vivo mensagens de token revelado.** Hoje, uma rolagem ligada a um token oculto
  (`ChatMessage.tokenId`) só passa a chegar para quem não via o token no **próximo**
  `room:join`/snapshot — não há reenvio ao vivo no momento em que o token é revelado ou sai da
  névoa (diferente do próprio token, que já é reemitido ao vivo nesse instante). Implementar exigiria
  saber "para quem a visibilidade de QUAL token mudou agora" (comparar contra o estado anterior por
  participante) e então escanear/reenviar o histórico de mensagens daquele token — caro de fazer no
  caminho quente de arraste. Anotado em 08/09/2026 (`docs/revisao-combate.md` §2).
- **`token:apply-damage` deve aplicar o gate de token oculto ao validar `messageId`.** O handler
  hoje confere só `messageVisibleTo` (campo `visibility`) antes de deixar aplicar dano/cura a partir
  de uma mensagem; não confere `ChatMessage.tokenId`/`tokenGateOk`. Na prática o cliente só tem o id
  de mensagens que já recebeu (o gate já vale no broadcast/snapshot), mas um cliente malicioso que
  adivinhasse o id de uma rolagem bloqueada poderia tentar referenciá-la mesmo assim. Não vaza o
  conteúdo da rolagem (aplicar dano não devolve isso), mas é uma checagem de defesa em profundidade
  que ficou faltando. Anotado em 08/09/2026 (`docs/revisao-combate.md` §2).
- **Convocações com atributos escalando pelo nível do conjurador.** O pack `convocacoes` do Foundry
  (18 atores `type: simple`) ficou **fora** do importador de criaturas: os blocos vêm quase vazios
  porque os valores reais escalam com o nível de quem conjura — Defesa 10 em 16 dos 18, PV 0 ou 1 em
  12 deles, sem ND e sem tipo de criatura. Importar geraria 18 entradas que não servem para soltar no
  mapa. Para entrar de verdade seria preciso ou blocos conferidos no livro em `custom.json`, ou um
  conceito novo de "criatura que escala" (valor em função de um nível informado na hora de soltar),
  que hoje não existe nem no schema nem na ficha. Anotado em 08/09/2026 (`docs/plano-criaturas.md` §1.5).
- **Avisar no toast quando `compendium:spawn-creature` criar menos cópias que o pedido.** O
  servidor já pode devolver menos tokens do que `count` (espiral de posicionamento estourou o raio
  máximo, ou não sobrou célula livre no mapa pro token caber — `apps/server/src/socket/compendium.ts`),
  sem erro: o ack só traz o `Token[]` menor. Hoje o cliente aplica o que veio e não avisa o GM que
  pediu 10 e ganhou 6, por exemplo. Precisa comparar `payload.count` com `res.length` em
  `apps/web/src/store/tokens.ts` (spawnCreature) e mostrar um toast quando forem diferentes.
- **Aplicar resistências/imunidades/vulnerabilidades automaticamente no dano.** `CharacterData.damageResponses`
  guarda RD, "reduz à metade", imunidade e vulnerabilidade por tipo de dano, mas `token:apply-damage`
  continua aplicando o valor que o cliente manda: o ajuste é só uma **sugestão de UI** no seletor de
  "Aplicar" (multiplicador pré-selecionado + aviso "resistente a fogo"), e o Mestre confirma. Automatizar
  no servidor exigiria decidir o que fazer quando o Mestre discorda da conta (hoje ele simplesmente
  digita outro valor), como registrar isso em `roll.applied` e o que vale para alvos sem ficha vinculada
  (`token.hp`, que não tem resposta a dano nenhuma). Anotado em 08/09/2026 (`docs/plano-criaturas.md` §0.3–0.4).
- **"Encerrar cena": expira durações "até o fim da cena" de magias/poderes/condições.** Em Tormenta20
  **cena** é uma unidade de tempo de jogo ("dura uma cena"), diferente do **mapa** (a imagem com grid e
  tokens — a entidade que o código chama de `Scene`, ver `docs/plano-mapas.md` §1). Falta um botão
  "Encerrar cena" para o Mestre que varra o que tem duração "até o fim da cena" e expire de uma vez:
  condições de token (hoje só há duração em rodadas, `TokenCondition.expiresRound`, §3.3 do SPEC),
  efeitos de magias/poderes já conjurados e o que mais vier a ter duração. Precisaria de um jeito de
  marcar "esta duração é por cena" no que hoje só sabe contar rodadas — provavelmente uma duração
  simbólica no `TokenCondition` e no card de item, mais o gatilho no servidor com aviso no chat, no
  mesmo estilo da expiração por rodada. Anotado em 09/09/2026.
- **Snapshot de mapas para jogador: enviar só o mapa ativo.** Hoje `RoomSnapshot.scenes` manda
  `Scene[]` inteiro (nome, grid e a névoa completa — todas as `FogShape`) de **todos** os mapas da
  sala pra **todos** os participantes, jogador incluso; só `token:*`/`combat:*` são filtrados pelo
  mapa ativo (docs/plano-mapas.md §5). Não vaza o que está atrás da névoa, mas um jogador curioso no
  DevTools vê nome e forma da névoa de mapas que o GM ainda nem mostrou — situação que já existia
  antes de múltiplos mapas (era uma cena só), mas ficou bem mais visível na prática agora que há
  vários mapas de verdade por sala. Anotado em 09/09/2026 (`docs/revisao-mapas.md` §5).
- **`requireToken` deve rejeitar token de mapa soft-deleted.** `apps/server/src/socket/token.ts`
  confere `row.scene.roomId` e `row.deletedAt` (do próprio token), mas não `row.scene.deletedAt`: um
  token cujo mapa foi apagado continua editável via id direto. Não há UI pra chegar nesse id (o mapa
  some da lista de mapas, então o cliente honesto nunca carrega esses tokens), mas um cliente
  adulterado que já tivesse o id de antes do apagar poderia tentar. Checagem barata de acrescentar
  (mais um campo no mesmo `if`), mas fora do §11 do plano (que fala de "mapa ativo", não "mapa
  apagado") — não corrigido nesta rodada. Anotado em 09/09/2026 (`docs/revisao-mapas.md` §5).
- **Período de graça ao ativar mapa para não recusar o commit final de um arraste em andamento.**
  `requirePlayerTokenOnActiveScene` (defesa em profundidade do §11 do plano, commit `b3f1570`) passa
  a recusar `token:update` de um jogador pro token que ficou no mapa que **acabou de** deixar de ser
  o ativo — inclusive o commit final de um arraste que já estava em curso quando o GM clicou
  "Ativar" no mapa novo. Sem corrupção de dado: o servidor fica com a posição do último eco `live`
  que passou antes da troca (no pior caso, dezenas de ms antes do solto do mouse), o jogador só vê
  um toast de erro e o token some da tela dele (segue o mapa ativo). Corrigir exigiria um jeito de
  distinguir "este token acabou de ficar inativo, no meio do gesto de quem está mandando o commit"
  de "cliente adulterado insistindo num mapa antigo" — por exemplo, aceitar por alguns segundos
  depois da troca um `token:update` de um jogador que era dono do token quando o mapa ainda era o
  ativo. O §11 do plano não previa essa distinção. Anotado em 09/09/2026 (`docs/revisao-mapas.md`
  §4, "Ativar um mapa enquanto um jogador está no meio de um arraste").
- **Botão "Atualizar do compêndio" no item da ficha**, refazendo a cópia a partir da entrada de
  origem (`$source`). Hoje `character:insert-from-compendium` copia a entrada uma vez (denormalizada,
  `entryToItem`) e o item da ficha vive independente dali em diante — se o GM corrige o JSON do
  compêndio depois (erro de digitação, ajuste de regra), todo item já copiado fica desatualizado e
  só dá pra corrigir manualmente. Precisaria guardar de qual entrada o item veio (campo tipo
  `$source: entryId`, hoje não existe no `CharacterItemSchema`) e decidir o que fazer com o que o
  jogador já personalizou no item (nome, aprimoramentos extras, campos editados) — sobrescrever tudo
  perderia essas edições, mesclar exigiria decidir campo a campo o que é "do compêndio" vs. "do
  jogador". Anotado em 10/09/2026, ao implementar a área estruturada dos itens (`docs/plano-gabaritos.md` §6).
- **Cone vindo de "Colocar área" nasce no token do conjurador, em modo apontar** (origem fixa no
  token, só a direção é escolhida — mira com o mouse, clique confirma); dono pode reapontar depois
  (o arrastar-o-corpo pra mover e a alça de rotação pra girar já existem, docs/plano-gabaritos.md §5).
  Hoje o botão "Colocar área" do card de item (§6) abre a ferramenta com a forma/tamanho certos, mas
  a origem é sempre por clique livre no mapa — nunca ancora em token nenhum (decisão do SPEC §9.9:
  evita travar o GM num efeito lançado longe de onde o conjurador está, tipo uma Bola de Fogo à
  distância). Faz sentido só pro CONE porque cone é "de onde eu estou, apontando pra lá" (sopro,
  ataque em leque) — diferente de círculo/quadrado/linha, que miram um ponto longe do conjurador.
  Implementar exigiria: achar qual token corresponde a quem usou o item (`ItemCardMessage` não tem
  isso hoje — personagem não é 1:1 com token, pode ter zero ou vários no mapa; com mais de um,
  precisaria perguntar qual), e um sub-modo novo da ferramenta Área ("apontar": origem travada no
  token, só o `mousemove`/clique decide a rotação) separado do clique-e-arrasto livre de hoje.
  Anotado em 10/09/2026 (`docs/plano-gabaritos.md` §6).
- **Autor da rolagem vê a linha do próprio alvo mesmo se o token ficar oculto (hoje segue a regra de
  linha do card de iniciativa).** No sistema de alvos (§9.12 do SPEC), `rollTargetsForViewer`
  (`apps/server/src/services/chatVisibility.ts`) tira a linha de um alvo cujo token o viewer não vê
  — **inclusive o autor da rolagem**, seguindo à risca a mesma regra por LINHA que
  `initiativeBatchForViewer` já usava (o plano pediu pra espelhar essa função, docs/plano-alvos.md
  §2.4). Efeito prático: um jogador que ataca um monstro que fica invisível/sai da névoa no meio do
  ataque não vê se o próprio ataque acertou — só o GM vê. É diferente da regra de MENSAGEM inteira
  (`tokenId`/`blockedPlayerIds`), que sempre isenta o autor. Se o dono do projeto preferir que o
  autor sempre veja o resultado do próprio ataque (mesmo contra um alvo que ficou oculto pra ele
  depois de rolar), precisaria de uma exceção por autor dentro de `rollTargetsForViewer` — parecida
  com a que a regra de mensagem já tem, mas nova pra regra de linha (nem `initiativeBatchForViewer`
  tem isso hoje, então mudar só pra alvos criaria uma assimetria entre os dois cards). Achado na
  revisão de 10/09/2026 (`docs/revisao-alvos.md` §5.3); não corrigido — comportamento consistente
  com o que já existia, não uma regressão.
- **Tokens de meia célula (Minúsculo 0,5 em T20).** `Token.cells` (docs/plano-grid.md) é inteiro
  ≥ 1: um token cuja criatura tem `tokenCells: 0.5` no sistema (Minúsculo) arredonda pra 1 célula
  cheia ao soltar do compêndio, igual ao comportamento de antes da migration — só que agora não tem
  mais como um dia render "meia célula" sem o schema aprender fração. Suportar de verdade exigiria
  `Token.cells` fracionário (ex.: `0.5`), o que muda a espiral de posicionamento (`findFreeCells`,
  hoje em células inteiras) e o snap do Transformer (§ do plano) pra aceitar meio passo. Anotado em
  11/09/2026, ao trocar `Token.width/height` por `Token.cells`.
