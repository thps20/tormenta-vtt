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
  CompendiumEntry,
  FogConfig,
  FogUpdatePayload,
  InitiativeAddPayload,
  InitiativeState,
  InitiativeUpdatePayload,
  Participant,
  RoomJoinPayload,
  RoomPublic,
  Ruler,
  RulerUpdatePayload,
  Scene,
  SceneSetMapPayload,
  SceneUpdateGridPayload,
  Token,
  TokenApplyDamagePayload,
  TokenCreate,
  TokenLinkCharacterPayload,
  TokenPatch,
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
  initiative: InitiativeState;
  chat: ChatMessage[];
  /** Fichas da sala (jogadores não recebem as de kind = "npc"). */
  characters: Character[];
}

export interface ClientToServerEvents {
  // Sala
  "room:join": (payload: RoomJoinPayload, ack: Ack<RoomSnapshot>) => void;

  // Cena (GM)
  "scene:create": (payload: { name: string }, ack: Ack<Scene>) => void;
  "scene:activate": (payload: { sceneId: string }, ack: Ack) => void;
  "scene:updateGrid": (payload: SceneUpdateGridPayload, ack: Ack<Scene>) => void;
  /** mapUrl vem do upload HTTP (POST /api/upload) feito antes. null remove o mapa. */
  "scene:setMap": (payload: SceneSetMapPayload, ack: Ack<Scene>) => void;
  /** Névoa manual da cena: add / removeLast / revealAll / hideAll / setEnabled. Ack devolve o estado completo. */
  "fog:update": (payload: FogUpdatePayload, ack: Ack<FogConfig>) => void;

  // Tokens
  "token:create": (payload: TokenCreate, ack: Ack<Token>) => void;
  /** Usado para arrastar/redimensionar. Cliente envia throttled (~30/s) enquanto arrasta. */
  "token:update": (payload: TokenPatch, ack: Ack<Token>) => void;
  "token:delete": (payload: { tokenId: string }, ack: Ack) => void;
  /** GM, ou dono do token que também é dono da ficha. characterId null desvincula. */
  "token:link-character": (payload: TokenLinkCharacterPayload, ack: Ack<Token>) => void;
  /**
   * Aplica um card de dano/cura (chat) num ou mais tokens: GM sempre, jogador só nos
   * que possui (tudo-ou-nada). Aplica no recurso `tokenBar` da ficha vinculada, ou em
   * `token.hp` se solto; devolve a mensagem com `roll.applied` atualizado (broadcast
   * normal também sai em token:updated/character:updated + chat:message).
   */
  "token:apply-damage": (payload: TokenApplyDamagePayload, ack: Ack<ChatMessage>) => void;

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
   * Entradas do compêndio do sistema da sala (e, no futuro, as da própria sala,
   * que têm prioridade quando o id coincide). Sem broadcast: o cliente pede ao
   * abrir a paleta e guarda em memória.
   */
  "compendium:list": (payload: Record<string, never>, ack: Ack<CompendiumEntry[]>) => void;

  // Régua (efêmera: só broadcast, nada vai ao banco)
  /** Enviado com throttle enquanto o participante arrasta a régua; `ruler: null` ao soltar. */
  "ruler:update": (payload: RulerUpdatePayload, ack: Ack) => void;

  // Chat + dados
  /** "/r <fórmula> [# rótulo]" rola; "/gr" rola em segredo (só GM + autor veem). */
  "chat:send": (payload: { text: string }, ack: Ack<ChatMessage>) => void;

  // Iniciativa (GM)
  "initiative:add": (payload: InitiativeAddPayload, ack: Ack<InitiativeState>) => void;
  "initiative:update": (payload: InitiativeUpdatePayload, ack: Ack<InitiativeState>) => void;
  "initiative:remove": (payload: { entryId: string }, ack: Ack<InitiativeState>) => void;
  "initiative:next": (payload: Record<string, never>, ack: Ack<InitiativeState>) => void;
  "initiative:prev": (payload: Record<string, never>, ack: Ack<InitiativeState>) => void;
  "initiative:reset": (payload: Record<string, never>, ack: Ack<InitiativeState>) => void;
}

export interface ServerToClientEvents {
  /** Participante entrou (ou reconectou). Se já existir na lista, atualizar. */
  "room:participantJoined": (p: Participant) => void;
  /** Participante desconectou. Ele continua na sala com connected = false. */
  "room:participantLeft": (p: { id: string }) => void;
  "room:activeSceneChanged": (p: { sceneId: string }) => void;

  "scene:created": (scene: Scene) => void;
  "scene:updated": (scene: Scene) => void;
  /** Estado completo da névoa após uma operação (cliente só substitui `scene.fog`). */
  "fog:updated": (p: { sceneId: string; fog: FogConfig }) => void;

  "token:created": (token: Token) => void;
  "token:updated": (token: Token) => void;
  "token:deleted": (p: { tokenId: string }) => void;

  "chat:message": (msg: ChatMessage) => void;

  "character:created": (character: Character) => void;
  "character:updated": (character: Character) => void;
  "character:deleted": (p: { characterId: string }) => void;

  "initiative:updated": (state: InitiativeState) => void;

  /** Régua de outro participante (o autor não recebe eco: já desenha a própria). ruler null = apagar. */
  "ruler:updated": (p: { participantId: string; nickname: string; sceneId: string; ruler: Ruler | null }) => void;

  /** Erros não relacionados a um ack específico. */
  "server:error": (p: { message: string }) => void;
}

/** Dados guardados no socket no servidor (socket.data). */
export interface SocketData {
  roomId: string;
  participantId: string;
  role: "gm" | "player";
  /** Guardado no join para eventos frequentes (régua) não consultarem o banco. */
  nickname: string;
}
