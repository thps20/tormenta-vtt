/**
 * Contrato dos eventos Socket.io.
 * Cliente -> Servidor: ClientToServerEvents
 * Servidor -> Cliente: ServerToClientEvents
 *
 * Convenção de nomes: "<recurso>:<ação>" em kebab/camel.
 * Todo evento C->S recebe um callback `ack` com { ok: true, data } ou { ok: false, error }.
 * Isso deixa o cliente saber se o servidor aceitou (ex.: validação Zod falhou).
 *
 * Os payloads são tipados a partir dos schemas Zod em schemas/payloads.ts,
 * então tipo e validação nunca divergem.
 */
import type {
  Character,
  CharacterCreatePayload,
  CharacterRollPayload,
  CharacterUpdatePayload,
  CharacterUseItemPayload,
  ChatMessage,
  ChatRevealPayload,
  ChatSendPayload,
  Combat,
  CombatAddPayload,
  CombatDelayPayload,
  CombatEndPayload,
  CombatRemovePayload,
  CombatReorderPayload,
  CombatResumePayload,
  CombatRollPayload,
  CombatScenePayload,
  CombatSetAutoRollNpcInitiativePayload,
  CombatSetInitiativePayload,
  CombatSetMovementLimitPayload,
  CombatSetMovementPayload,
  CombatSetSurprisedPayload,
  CombatStartPayload,
  CompendiumEntry,
  CompendiumSpawnCreaturePayload,
  Drawing,
  DrawingClearAllPayload,
  DrawingClearMinePayload,
  DrawingCreatePayload,
  DrawingPatchPayload,
  DrawingRemovePayload,
  DrawingSetPlayerPermissionPayload,
  EncounterCreateFromTokensPayload,
  EncounterCreatePayload,
  EncounterDeletePayload,
  EncounterSpawnPayload,
  EncounterUpdatePayload,
  FogConfig,
  FogUpdatePayload,
  Handout,
  HandoutClosePayload,
  HandoutCreatePayload,
  HandoutDeletePayload,
  HandoutShowPayload,
  HandoutUpdatePayload,
  NotesSearchPayload,
  NotesSearchResultItem,
  Participant,
  PartyAddPayload,
  PartyEntry,
  PartyRemovePayload,
  PartyReorderPayload,
  PartySetHiddenPayload,
  Pin,
  PinCreatePayload,
  PinRemovePayload,
  PinUpdatePayload,
  RoomJoinPayload,
  RoomPublic,
  Ruler,
  RulerUpdatePayload,
  SavedEncounter,
  Scene,
  SceneActivatePayload,
  SceneCreatePayload,
  SceneDeletePayload,
  SceneDeleteResult,
  SceneDuplicatePayload,
  SceneEnterPayload,
  SceneGetNotesPayload,
  SceneListItem,
  SceneRenamePayload,
  SceneReorderPayload,
  SceneSetArrivalPayload,
  SceneSetMapPayload,
  SceneSetNotesPayload,
  SceneUpdateGridPayload,
  TargetSetPayload,
  Template,
  TemplateRemovePayload,
  TemplateUpsertPayload,
  Token,
  TokenApplyDamagePayload,
  TokenCreate,
  TokenDeleteManyPayload,
  TokenGetNotesPayload,
  TokenLinkCharacterPayload,
  TokenPatch,
  TokenSetNotesPayload,
  TokenUpdateManyPayload,
} from "./schemas/index.js";

export type AckResult<T> = { ok: true; data: T } | { ok: false; error: string };
export type Ack<T = void> = (res: AckResult<T>) => void;

/** Estado completo enviado ao entrar na sala. */
export interface RoomSnapshot {
  room: RoomPublic;
  me: Participant;
  /** Guardar no localStorage para reconectar como o mesmo participante. */
  sessionToken: string;
  participants: Participant[];
  scenes: Scene[];
  /** Tokens da cena ativa (jogadores não recebem os invisíveis). */
  tokens: Token[];
  /** Combate da cena ativa (null = nenhum). Já filtrado pela visibilidade de quem recebe. */
  combat: Combat | null;
  /** Gabaritos de área de efeito da cena ativa (docs/plano-gabaritos.md). Efêmeros, não vêm do banco. */
  templates: Template[];
  /** Pinos (handout ou nota) fixados na cena ativa (§9.10/§9.16), já filtrados pela visibilidade de
   *  quem recebe. */
  pins: Pin[];
  /** Traços de desenho livre da cena ativa (§9.17), já filtrados pela visibilidade de quem recebe
   *  (jogador não recebe traço "só GM"). Persistidos por mapa, diferente dos gabaritos. */
  drawings: Drawing[];
  chat: ChatMessage[];
  /** Fichas da sala (jogadores não recebem as de kind = "npc"). */
  characters: Character[];
  /**
   * Grupo da "Visão de grupo" (SPEC §9.15), gerenciado pelo Mestre — já filtrado por quem recebe:
   * jogador nunca recebe entrada oculta (`hidden`), nem de ficha que deixou de ser PC; GM recebe
   * tudo, ocultas inclusive (a UI dele esmaece).
   */
  party: PartyEntry[];
  /** Trava de orçamento de deslocamento (docs/plano-movimento.md), por SALA — em memória, não vai
   *  ao banco. `true` = ninguém excede o orçamento sem confirmação do GM (padrão). */
  movementLimitEnabled: boolean;
  /** "Rolar iniciativa dos NPCs ao iniciar o combate" (§3.5), por SALA — em memória, mesmo padrão
   *  de `movementLimitEnabled` acima. `true` (padrão) = combat:start/combat:add rolam sozinhos os
   *  combatentes sem dono que entram sem iniciativa. */
  autoRollNpcInitiativeEnabled: boolean;
  /** "Jogadores podem desenhar" (§9.17), por SALA — em memória, mesmo padrão de
   *  `movementLimitEnabled` acima. `true` (padrão) = jogador pode criar traço novo no mapa ativo. */
  playerDrawingEnabled: boolean;
  /**
   * Alvos marcados (docs/plano-alvos.md), por participante — efêmeros, em memória, já filtrados
   * pra quem recebe (alvos do GM nunca vão a jogadores; jogador só vê os alvos dos outros
   * jogadores em tokens que ele próprio pode ver). `sceneId` é o mapa onde os `tokenIds` foram
   * marcados — pode não ser mais o mapa que o viewer está vendo agora.
   */
  targets: { participantId: string; sceneId: string; tokenIds: string[] }[];
}

/**
 * Resultado de `history:undo`/`history:redo` (docs/plano-desfazer.md). `null` = pilha vazia (nada
 * pra desfazer/refazer). `summary` é o texto pronto pro toast ("apagar Goblin 3", "mover 5 tokens").
 */
export interface HistoryActionResult {
  summary: string;
}

/** Resposta de `compendium:list`. */
export interface CompendiumList {
  /** Sistema + sala mescladas. Entradas `type: "creature"` só vêm para o GM (filtro no servidor). */
  entries: CompendiumEntry[];
  /** Ids que vieram do compêndio da SALA (homebrew do GM): a paleta mostra o chip "Sala" só quando houver algum. */
  roomIds: string[];
}

export interface ClientToServerEvents {
  // Sala
  "room:join": (payload: RoomJoinPayload, ack: Ack<RoomSnapshot>) => void;

  // Mapas (docs/plano-mapas.md) — GM, exceto scene:enter (todos)
  /** `mapUrl`/`mapWidth`/`mapHeight` opcionais: "criar por upload" numa chamada só. */
  "scene:create": (payload: SceneCreatePayload, ack: Ack<Scene>) => void;
  /**
   * `moveTokenIds`/`dropPoint`: diálogo "Levar para o mapa" (§8). Broadcast:
   * `token:updated` de cada token movido, `combat:updated` do mapa de origem se ele tinha combate,
   * e por fim `room:activeSceneChanged`.
   */
  "scene:activate": (payload: SceneActivatePayload, ack: Ack) => void;
  "scene:updateGrid": (payload: SceneUpdateGridPayload, ack: Ack<Scene>) => void;
  /** mapUrl vem do upload HTTP (POST /api/upload) feito antes. null remove o mapa. */
  "scene:setMap": (payload: SceneSetMapPayload, ack: Ack<Scene>) => void;
  /**
   * Navega para um mapa sem os efeitos colaterais de `room:join` (presença, snapshot inteiro):
   * GM entra em qualquer mapa não apagado da sala; jogador só no mapa ativo. Sem broadcast.
   */
  "scene:enter": (
    payload: SceneEnterPayload,
    ack: Ack<{ tokens: Token[]; combat: Combat | null; templates: Template[]; pins: Pin[]; drawings: Drawing[] }>,
  ) => void;
  "scene:rename": (payload: SceneRenamePayload, ack: Ack<Scene>) => void;
  /** Copia mapUrl/mapWidth/mapHeight/grid/fog/arrival; NÃO copia tokens nem combate. */
  "scene:duplicate": (payload: SceneDuplicatePayload, ack: Ack<Scene>) => void;
  /** Ver SceneDeleteResultSchema: "needs-confirm" ainda não apaga nada (reenviar com confirmMovePlayerTokens). */
  "scene:delete": (payload: SceneDeletePayload, ack: Ack<SceneDeleteResult>) => void;
  /** Lista completa nova (arrastar no painel "Mapas"): renumera 0..n-1, tudo ou nada. */
  "scene:reorder": (payload: SceneReorderPayload, ack: Ack<{ order: { sceneId: string; order: number }[] }>) => void;
  "scene:setArrival": (payload: SceneSetArrivalPayload, ack: Ack<Scene>) => void;
  /** Contagens/combate de cada mapa pro painel "Mapas" (dados que o cliente não carregou). */
  "scene:list": (payload: Record<string, never>, ack: Ack<{ items: SceneListItem[] }>) => void;

  // Notas do Mestre (docs/plano-narracao.md, GM only): texto nunca vai no Scene/Token serializado
  // (só `hasNotes: boolean`) — só sai por estes eventos dedicados, carregados sob demanda quando o
  // painel/Inspector abre.
  "scene:set-notes": (payload: SceneSetNotesPayload, ack: Ack<Scene>) => void;
  "scene:get-notes": (payload: SceneGetNotesPayload, ack: Ack<{ notes: string }>) => void;
  "token:set-notes": (payload: TokenSetNotesPayload, ack: Ack<Token>) => void;
  "token:get-notes": (payload: TokenGetNotesPayload, ack: Ack<{ notes: string }>) => void;
  /** Busca simples (contains) nas notas de mapa e de token da sala inteira. */
  "notes:search": (payload: NotesSearchPayload, ack: Ack<{ items: NotesSearchResultItem[] }>) => void;
  /** Névoa manual da cena: add / removeLast / revealAll / hideAll / setEnabled. Ack devolve o estado completo. */
  "fog:update": (payload: FogUpdatePayload, ack: Ack<FogConfig>) => void;

  // Tokens
  "token:create": (payload: TokenCreate, ack: Ack<Token>) => void;
  /** Usado para arrastar/redimensionar. Cliente envia throttled (~30/s) enquanto arrasta (`live: true`). */
  "token:update": (payload: TokenPatch, ack: Ack<Token>) => void;
  /**
   * Atualiza vários tokens de uma vez, tudo-ou-nada (arraste em grupo ao soltar): uma entrada de
   * histórico só, em vez de uma por token (docs/plano-desfazer.md §3). `token:updated` normal por id.
   */
  "token:update-many": (payload: TokenUpdateManyPayload, ack: Ack) => void;
  "token:delete": (payload: { tokenId: string }, ack: Ack) => void;
  /**
   * Apaga vários tokens de uma vez, tudo-ou-nada (Delete/Backspace em lote, NpcQuickCard): uma
   * entrada de histórico só (docs/plano-desfazer.md §2). `token:deleted` normal por id.
   */
  "token:delete-many": (payload: TokenDeleteManyPayload, ack: Ack) => void;
  /** GM, ou dono do token que também é dono da ficha. characterId null desvincula. */
  "token:link-character": (payload: TokenLinkCharacterPayload, ack: Ack<Token>) => void;
  /**
   * Aplica um card de dano/cura (chat) num ou mais tokens: GM sempre, jogador só nos
   * que possui (tudo-ou-nada). Aplica no recurso `tokenBar` da ficha vinculada, ou em
   * `token.hp` se solto; devolve a mensagem com `roll.applied` atualizado (broadcast
   * normal também sai em token:updated/character:updated + chat:message).
   */
  "token:apply-damage": (payload: TokenApplyDamagePayload, ack: Ack<ChatMessage>) => void;

  // Alvos (efêmeros, docs/plano-alvos.md): quem mira quem. Lista completa (não adiciona/remove).
  /** GM: qualquer mapa vivo da sala. Jogador: só o mapa ATIVO, só tokens que vê — o servidor
   *  descarta o resto em silêncio e o ack devolve a lista que valeu. */
  "target:set": (payload: TargetSetPayload, ack: Ack<{ tokenIds: string[] }>) => void;

  // Ficha de personagem
  /** Jogador cria só para si (ownerId = ele, kind = pc); GM cria qualquer uma. */
  "character:create": (payload: CharacterCreatePayload, ack: Ack<Character>) => void;
  /** GM ou dono. Patch raso (ver CharacterPatchSchema). */
  "character:update": (payload: CharacterUpdatePayload, ack: Ack<Character>) => void;
  "character:delete": (payload: { characterId: string }, ack: Ack) => void;
  /** Rola atributo/perícia/iniciativa/ação de item a partir da ficha; o servidor monta a fórmula e rola. */
  "character:roll": (payload: CharacterRollPayload, ack: Ack<ChatMessage>) => void;
  /**
   * Usa um item ativo: o servidor desconta o custo do recurso de ativação do sistema
   * (character:updated) e publica o card (chat:message kind "item"). Recurso
   * insuficiente = ack { ok:false } e nada é publicado.
   */
  "character:use-item": (payload: CharacterUseItemPayload, ack: Ack<ChatMessage>) => void;

  // Compêndio
  /**
   * Entradas do compêndio do sistema da sala + as da própria sala (homebrew do GM, que tem
   * prioridade quando o id coincide). Sem broadcast: o cliente pede ao abrir a paleta e guarda em
   * memória. Criaturas (`type: "creature"`) só vêm para o GM — o servidor filtra, não só a UI.
   */
  "compendium:list": (payload: Record<string, never>, ack: Ack<CompendiumList>) => void;
  /**
   * Solta `count` cópias de uma criatura do compêndio na cena (GM). Uma transação (ficha NPC nova
   * + token vinculado por cópia); ack devolve os tokens criados (pode ser menos que `count`, se a
   * espiral de posicionamento estourar o raio máximo). Broadcast de character:created (só GM,
   * NPC) e token:created (visibilidade normal) para cada um, feito separadamente deste ack.
   */
  "compendium:spawn-creature": (payload: CompendiumSpawnCreaturePayload, ack: Ack<Token[]>) => void;

  // Encontros salvos (§9.14): biblioteca por sala, só GM — mesmo desenho de handout:* (list/create/
  // update/delete, broadcast pra rooms.gm porque pode haver mais de uma aba/GM olhando a sala).
  "encounter:list": (payload: Record<string, never>, ack: Ack<SavedEncounter[]>) => void;
  /** Salva a "receita" (entryId + quantidade); nenhuma cópia de ficha é feita aqui. Duplicar reusa
   *  este evento no cliente (mesmos dados, nome + " (cópia)"), sem evento próprio. */
  "encounter:create": (payload: EncounterCreatePayload, ack: Ack<SavedEncounter>) => void;
  /** A partir de tokens já no mapa cujo Character tem `compendiumEntryId` (vieram de uma soltura do
   *  compêndio antes); agrupa por entrada. Tokens sem essa origem são ignorados — `ignoredTokens`
   *  avisa quantos, para o cliente informar o GM. */
  "encounter:create-from-tokens": (payload: EncounterCreateFromTokensPayload, ack: Ack<{ encounter: SavedEncounter; ignoredTokens: number }>) => void;
  "encounter:update": (payload: EncounterUpdatePayload, ack: Ack<SavedEncounter>) => void;
  /** Soft delete (mesmo padrão de handout:delete). */
  "encounter:delete": (payload: EncounterDeletePayload, ack: Ack) => void;
  /**
   * Solta TODAS as criaturas do encontro na cena, numa espiral só a partir do ponto (GM). Uma
   * transação (N fichas NPC + N tokens); `skippedEntryIds` avisa quais entradas não existem mais no
   * compêndio (solta o resto em vez de falhar tudo). Broadcast de character:created/token:created
   * por cópia, como compendium:spawn-creature; entra na pilha de desfazer como UMA entrada.
   */
  "encounter:spawn": (payload: EncounterSpawnPayload, ack: Ack<{ tokens: Token[]; skippedEntryIds: string[] }>) => void;

  // Régua (efêmera: só broadcast, nada vai ao banco)
  /** Enviado com throttle enquanto o participante arrasta a régua; `ruler: null` ao soltar. */
  "ruler:update": (payload: RulerUpdatePayload, ack: Ack) => void;

  // Gabaritos de área de efeito (docs/plano-gabaritos.md): efêmeros por sessão, guardados em
  // memória no servidor (não vão ao banco) e sincronizados por socket, mesma regra de broadcast de
  // mapa que ruler/fog (GM sempre recebe; jogador só se `sceneId` é o mapa ATIVO da sala).
  /** Cria (id novo) ou edita (mover/girar) um gabarito. Dono = sempre quem chamou (nunca confiado
   *  do payload); GM edita/apaga qualquer um, jogador só os seus, e só no mapa ATIVO da sala. */
  "template:upsert": (payload: TemplateUpsertPayload, ack: Ack<Template>) => void;
  "template:remove": (payload: TemplateRemovePayload, ack: Ack) => void;

  // Handouts (§9.10): biblioteca por sala, só GM (criar/editar/apagar/listar/mostrar/fechar/fixar).
  // Biblioteca (create/update/delete/list) é enviada só pro GM (rooms.gm) — jogador nunca vê a lista.
  /** `imageUrl`/`width`/`height` vêm do upload HTTP (POST /api/upload) feito antes, como scene:setMap. */
  "handout:create": (payload: HandoutCreatePayload, ack: Ack<Handout>) => void;
  /** Só nome/tags — trocar imagem/texto é apagar e criar de novo. */
  "handout:update": (payload: HandoutUpdatePayload, ack: Ack<Handout>) => void;
  /** Soft delete: apaga também (soft delete) os pinos deste handout em qualquer mapa, uma entrada de
   *  desfazer só (docs/plano-desfazer.md). */
  "handout:delete": (payload: HandoutDeletePayload, ack: Ack) => void;
  "handout:list": (payload: Record<string, never>, ack: Ack<{ items: Handout[] }>) => void;
  /**
   * Publica `chat:message{kind:"handout"}` e abre o overlay AO VIVO pra quem recebe (broadcast, não
   * este ack). `target: "all"` = sala toda; `{participantId}` = sussurro visual (só aquele jogador +
   * GM, via `ChatMessage.whisperTo`).
   */
  "handout:show": (payload: HandoutShowPayload, ack: Ack) => void;
  /** Fecha o overlay pra quem via a mensagem (ela continua no chat, clicável de novo). */
  "handout:close": (payload: HandoutClosePayload, ack: Ack) => void;

  // Pinos no mapa (docs/plano-narracao.md, unifica o antigo handout:pin/unpin com pino de nota):
  // GM cria/edita/apaga; broadcast segue a regra de mapa de sempre (GM sempre; jogador só se
  // `visible` e `sceneId` é o mapa ATIVO). Entram no desfazer do GM.
  /** `kind: "handout"` fixa uma cópia denormalizada do handout; `kind: "note"` cria o pino com o
   *  conteúdo (título/texto/ícone/cor) direto no payload. */
  "pin:create": (payload: PinCreatePayload, ack: Ack<Pin>) => void;
  /** Só pinos `kind: "note"` — handout continua "apagar e fixar de novo" (cópia denormalizada). */
  "pin:update": (payload: PinUpdatePayload, ack: Ack<Pin>) => void;
  "pin:remove": (payload: PinRemovePayload, ack: Ack) => void;

  // Desenho livre no mapa (§9.17): persistido por mapa (diferente dos gabaritos), um traço por
  // linha do banco. GM sempre pode; jogador só os PRÓPRIOS, condicionado ao toggle abaixo e ao mapa
  // ATIVO da sala. Só ações do GM entram no desfazer geral (jogador tem pilha local, sem servidor).
  /** `drawing.id`/`ownerId` do payload nunca são confiados — o servidor sempre fixa `ownerId` a
   *  quem chamou e força `visible: true` quando quem cria é jogador. */
  "drawing:create": (payload: DrawingCreatePayload, ack: Ack<Drawing>) => void;
  /** Mover/redimensionar/reeditar texto/trocar cor-espessura-preenchimento; `visible` só o GM muda.
   *  `live: true` marca eco de arraste/redimensionamento em andamento (nunca empilha no desfazer). */
  "drawing:update": (payload: DrawingPatchPayload, ack: Ack<Drawing>) => void;
  "drawing:remove": (payload: DrawingRemovePayload, ack: Ack) => void;
  /** "Limpar meus desenhos" (qualquer role, só os próprios do mapa). */
  "drawing:clear-mine": (payload: DrawingClearMinePayload, ack: Ack) => void;
  /** "Limpar tudo" (GM). */
  "drawing:clear-all": (payload: DrawingClearAllPayload, ack: Ack) => void;
  /** GM: liga/desliga "jogadores podem desenhar" NA SALA (memória, broadcast
   *  `drawing:playerPermissionChanged`). Só trava CRIAR — mover/apagar os já existentes continua. */
  "drawing:set-player-permission": (payload: DrawingSetPlayerPermissionPayload, ack: Ack<{ enabled: boolean }>) => void;

  // Chat + dados
  /**
   * "/r <fórmula> [# rótulo]" rola no modo `visibility` do autor; "/gmr" força
   * secreta (só GM) e "/pr" força pública. Texto é sempre público.
   * Rolagem que o autor não pode ver (às cegas) volta no ack sem `roll`.
   */
  "chat:send": (payload: ChatSendPayload, ack: Ack<ChatMessage>) => void;
  /** GM torna pública uma mensagem secreta/própria: `chat:message` com visibility "all" para todos (upsert no cliente). */
  "chat:reveal": (payload: ChatRevealPayload, ack: Ack<ChatMessage>) => void;

  // Combate (modo de combate por mapa; ver docs/plano-combate.md e docs/plano-mapas.md §7)
  // Combate deixou de exigir "mapa ativo": todo payload leva `sceneId` (o mapa que o cliente está
  // vendo). Jogador só controla/rola no mapa ATIVO da sala; o GM em qualquer mapa que esteja vendo.
  /** GM seleciona tokens e inicia: substitui um combate anterior do mapa, se houver. */
  "combat:start": (payload: CombatStartPayload, ack: Ack<Combat | null>) => void;
  /** Reforços: entram sem iniciativa, no fim da ordem. */
  "combat:add": (payload: CombatAddPayload, ack: Ack<Combat | null>) => void;
  "combat:remove": (payload: CombatRemovePayload, ack: Ack<Combat | null>) => void;
  /**
   * Rola iniciativa no servidor e publica no chat (uma mensagem por combatente rolado;
   * o broadcast de combat:updated sai uma vez só, no fim do lote). `self`: GM ou jogador,
   * só os seus; `one`: GM sempre, jogador só o seu; `npcs`/`missing`: só GM.
   */
  "combat:roll": (payload: CombatRollPayload, ack: Ack<Combat | null>) => void;
  /** Valor digitado à mão pelo GM (initiative: null volta para "não rolou"). */
  "combat:set-initiative": (payload: CombatSetInitiativePayload, ack: Ack<Combat | null>) => void;
  "combat:set-surprised": (payload: CombatSetSurprisedPayload, ack: Ack<Combat | null>) => void;
  /** Com status "rolling", inicia os turnos (round 1). Senão avança/volta na ordem. */
  "combat:next": (payload: CombatScenePayload, ack: Ack<Combat | null>) => void;
  "combat:prev": (payload: CombatScenePayload, ack: Ack<Combat | null>) => void;
  /** Nova ordem manual completa (arrastar na lista). */
  "combat:reorder": (payload: CombatReorderPayload, ack: Ack<Combat | null>) => void;
  /** Só no próprio turno: sai da rotação até "entrar agora". GM, ou dono do combatente. */
  "combat:delay": (payload: CombatDelayPayload, ack: Ack<Combat | null>) => void;
  "combat:resume": (payload: CombatResumePayload, ack: Ack<Combat | null>) => void;
  /** clear=false: encerra mas mantém a ordem visível; clear=true: apaga o combate. */
  "combat:end": (payload: CombatEndPayload, ack: Ack) => void;
  /** GM: ajusta à mão o orçamento/gasto de deslocamento de um combatente (docs/plano-movimento.md §4.3). */
  "combat:set-movement": (payload: CombatSetMovementPayload, ack: Ack<Combat | null>) => void;
  /** GM: liga/desliga a trava de deslocamento NA SALA (memória, broadcast `combat:movementLimitChanged`). */
  "combat:set-movement-limit": (payload: CombatSetMovementLimitPayload, ack: Ack<{ enabled: boolean }>) => void;
  /** GM: liga/desliga "Rolar iniciativa dos NPCs ao iniciar o combate" NA SALA (memória, broadcast
   *  `combat:autoRollNpcInitiativeChanged`). */
  "combat:set-auto-roll-npc-initiative": (payload: CombatSetAutoRollNpcInitiativePayload, ack: Ack<{ enabled: boolean }>) => void;

  // Grupo (Visão de grupo, SPEC §9.15): lista de PCs gerenciada pelo Mestre, persistida em
  // Room.party. Todos gmOnly — o servidor devolve, no ack, a visão do GM (tudo, ocultas inclusive);
  // quem muda de verdade é o broadcast `party:updated` (visões diferentes por papel).
  /** Um PC novo (character:create) já entra sozinho; isto é só pra "+ Adicionar ao grupo" (PC que
   *  não entrou junto, ex.: sala antiga sem este recurso, ou removido antes). Idempotente. */
  "party:add": (payload: PartyAddPayload, ack: Ack<PartyEntry[]>) => void;
  /** Idempotente (já não estar no grupo não é erro). */
  "party:remove": (payload: PartyRemovePayload, ack: Ack<PartyEntry[]>) => void;
  "party:set-hidden": (payload: PartySetHiddenPayload, ack: Ack<PartyEntry[]>) => void;
  /** Nova ordem completa (arrastar na faixa), tudo ou nada — ver reorderParty. */
  "party:reorder": (payload: PartyReorderPayload, ack: Ack<PartyEntry[]>) => void;

  // Desfazer/refazer (docs/plano-desfazer.md): pilha por sala, só do GM, em memória no servidor.
  /** Desfaz o topo da pilha da sala. `null` no ack = pilha vazia (nada pra desfazer). */
  "history:undo": (payload: Record<string, never>, ack: Ack<HistoryActionResult | null>) => void;
  /** Refaz o topo da pilha de redo (esvaziada por qualquer ação nova desde o último undo). */
  "history:redo": (payload: Record<string, never>, ack: Ack<HistoryActionResult | null>) => void;
}

export interface ServerToClientEvents {
  /** Participante entrou (ou reconectou). Se já existir na lista, atualizar. */
  "room:participantJoined": (p: Participant) => void;
  /** Participante desconectou. Ele continua na sala com connected = false. */
  "room:participantLeft": (p: { id: string }) => void;
  /** Mapa ativo mudou (`scene:activate`). Jogador sempre segue; GM segue só se estava vendo o mapa
   *  que era ativo — em ambos os casos, chamando `scene:enter`, não mais reemitindo `room:join`. */
  "room:activeSceneChanged": (p: { sceneId: string }) => void;

  "scene:created": (scene: Scene) => void;
  "scene:updated": (scene: Scene) => void;
  /** Mapa apagado (soft delete): quem estava vendo esse mapa cai para o ativo. */
  "scene:deleted": (p: { sceneId: string }) => void;
  /** `scene:reorder`: só os pares (sceneId, order) que mudaram de posição, não a lista inteira. */
  "scene:reordered": (p: { order: { sceneId: string; order: number }[] }) => void;
  /** Estado completo da névoa após uma operação (cliente só substitui `scene.fog`). */
  "fog:updated": (p: { sceneId: string; fog: FogConfig }) => void;

  "token:created": (token: Token) => void;
  "token:updated": (token: Token) => void;
  "token:deleted": (p: { tokenId: string }) => void;

  /** Alvos de UM participante mudaram (docs/plano-alvos.md) — o cliente substitui a lista dele.
   *  Jogador nunca recebe isto pro GM (alvos do GM nunca vão a jogadores). */
  "target:updated": (p: { participantId: string; sceneId: string; tokenIds: string[] }) => void;

  /** Mensagem nova ou revelada (mesmo id, visibility nova): o cliente faz upsert. */
  "chat:message": (msg: ChatMessage) => void;

  "character:created": (character: Character) => void;
  "character:updated": (character: Character) => void;
  "character:deleted": (p: { characterId: string }) => void;

  /**
   * Lista do grupo mudou (party:add/remove/set-hidden/reorder, ou um PC novo entrou sozinho ao ser
   * criado; ou saiu porque a ficha foi apagada / deixou de ser PC). Lista COMPLETA, já filtrada por
   * quem recebe (ver RoomSnapshot.party) — o cliente substitui a que tinha, não faz merge.
   */
  "party:updated": (p: { party: PartyEntry[] }) => void;

  /**
   * Estado completo do combate DE UM MAPA (já ordenado e filtrado por quem recebe). `combat: null`
   * = esse mapa não tem combate (ex.: `combat:end { clear: true }`). Combate deixou de estar preso
   * ao mapa ativo (docs/plano-mapas.md §7): ativar outro mapa não encerra o anterior, então mais de
   * um `combat:updated` (de mapas diferentes) pode chegar sem relação um com o outro.
   */
  "combat:updated": (p: { sceneId: string; combat: Combat | null }) => void;

  /** `combat:set-movement-limit`: novo estado da trava de deslocamento da SALA, para todos. */
  "combat:movementLimitChanged": (p: { enabled: boolean }) => void;

  /** `combat:set-auto-roll-npc-initiative`: novo estado de "Rolar iniciativa dos NPCs ao iniciar o
   *  combate" da SALA, para todos. */
  "combat:autoRollNpcInitiativeChanged": (p: { enabled: boolean }) => void;

  /** Régua de outro participante (o autor não recebe eco: já desenha a própria). ruler null = apagar. */
  "ruler:updated": (p: { participantId: string; nickname: string; sceneId: string; ruler: Ruler | null }) => void;

  /** Gabarito criado ou editado (mover/girar) — o cliente faz upsert por id, igual a token:updated. */
  "template:upserted": (p: { sceneId: string; template: Template }) => void;
  "template:removed": (p: { sceneId: string; templateId: string }) => void;

  // Handouts (§9.10). Biblioteca (created/updated/deleted) só vai pro GM.
  "handout:created": (handout: Handout) => void;
  "handout:updated": (handout: Handout) => void;
  "handout:deleted": (p: { id: string }) => void;

  // Pinos no mapa (§9.10/§9.16): mesma regra de broadcast de mapa de sempre — GM sempre recebe;
  // jogador só se `visible` e `sceneId` é o mapa ATIVO.
  "pin:created": (p: { sceneId: string; pin: Pin }) => void;
  "pin:updated": (p: { sceneId: string; pin: Pin }) => void;
  "pin:removed": (p: { sceneId: string; pinId: string }) => void;

  // Desenho livre no mapa (§9.17): mesma regra de broadcast de mapa de sempre — GM sempre recebe;
  // jogador só se `visible` e `sceneId` é o mapa ATIVO.
  "drawing:created": (p: { sceneId: string; drawing: Drawing }) => void;
  "drawing:updated": (p: { sceneId: string; drawing: Drawing }) => void;
  "drawing:removed": (p: { sceneId: string; drawingId: string }) => void;
  /** "Limpar meus"/"Limpar tudo": lote de ids de uma vez (o cliente remove todos, ids que ele nunca
   *  teve — traço "só GM" pra um jogador — são um no-op). */
  "drawing:cleared": (p: { sceneId: string; drawingIds: string[] }) => void;
  /** `drawing:set-player-permission`: novo estado de "jogadores podem desenhar" da SALA, para todos. */
  "drawing:playerPermissionChanged": (p: { enabled: boolean }) => void;

  // Encontros salvos (§9.14): biblioteca por sala, só pro GM (rooms.gm) — mesmo desenho de handout:*.
  "encounter:created": (encounter: SavedEncounter) => void;
  "encounter:updated": (encounter: SavedEncounter) => void;
  "encounter:deleted": (p: { id: string }) => void;
  /** Efêmero: instrui quem via a mensagem a fechar o overlay (a mensagem em si não muda no chat). */
  "handout:closed": (p: { messageId: string }) => void;

  /** Erros não relacionados a um ack específico. */
  "server:error": (p: { message: string }) => void;

  /**
   * Estado da pilha de histórico da sala, só pro GM (`rooms.gm`) — jogador não tem UI disso
   * (docs/plano-desfazer.md §6). Emitido depois de qualquer push/pop (uma ação nova desfazível,
   * um undo, um redo), pra Toolbar habilitar/desabilitar os botões e mostrar o resumo no tooltip.
   */
  "history:updated": (p: { canUndo: boolean; canRedo: boolean; undoSummary?: string; redoSummary?: string }) => void;
}

/** Dados guardados no socket no servidor (socket.data). */
export interface SocketData {
  roomId: string;
  participantId: string;
  role: "gm" | "player";
  /** Guardado no join para eventos frequentes (régua) não consultarem o banco. */
  nickname: string;
}
