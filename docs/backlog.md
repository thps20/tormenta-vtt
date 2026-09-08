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
