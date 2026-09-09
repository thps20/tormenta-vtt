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
- **Tamanho de token em células (`Token.cells`) como fonte da verdade, pixels derivados do grid do
  mapa — refatoração que elimina essa classe de bug.** Hoje `Token.width/height` são pixels fixos;
  toda vez que o token muda de grid (`scene:activate`/`scene:delete` levando pra outro mapa,
  `scene:updateGrid` trocando o `cellSize` do mapa atual) alguém precisa lembrar de converter
  (`convertSizeToCellSize`, `packages/shared/src/rules/placement.ts`) e recalcular pixels de novo —
  esqueceu uma vez (docs/plano-mapas.md, corrigido em 09/09/2026: os dois handlers de mapa moviam
  token sem tocar no tamanho, então ele ficava do jeito que estava no mapa de origem, menor/maior
  que a célula do destino). Se `Token` guardasse `cells` (nº de células de lado, análogo ao que já
  existe pra criaturas do compêndio) em vez de `width/height`, os pixels seriam sempre `cells ×
  cellSize do grid ATUAL` — calculado on-the-fly em qualquer lugar que precisa (canvas, findFreeCells,
  serialização), nunca gravado errado. Não corrigido agora: é uma migration de schema (`Token.width/
  height` → `Token.cells`, mais decidir o que fazer com token redimensionado livremente — hoje os
  handles do canto permitem qualquer pixel, não só múltiplos de `cellSize`; ou perde essa liberdade,
  ou `cells` vira fracionário) que toca client (Konva, handles de resize) e servidor a fundo — fora
  do escopo de um fix pontual.
