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
