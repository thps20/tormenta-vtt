/**
 * Contrato dos eventos Socket.io.
 * Cliente -> Servidor: ClientToServerEvents
 * Servidor -> Cliente: ServerToClientEvents
 *
 * Convenção de nomes: "<recurso>:<ação>" em kebab/camel.
 * Todo evento C->S recebe um callback `ack` com { ok: true, data } ou { ok: false, error }.
 * Isso deixa o cliente saber se o servidor aceitou (ex.: validação Zod falhou).
 */
import type {
  ChatMessage,
  InitiativeEntry,
  InitiativeState,
  Participant,
  RoomPublic,
  Scene,
  GridConfig,
  Token,
  TokenCreate,
  TokenPatch,
} from "./schemas/index.js";

export type Ack<T = void> = (res: { ok: true; data: T } | { ok: false; error: string }) => void;

/** Estado completo enviado ao entrar na sala. */
export interface RoomSnapshot {
  room: RoomPublic;
  me: Participant;
  participants: Participant[];
  scenes: Scene[];
  tokens: Token[];
  initiative: InitiativeState;
  chat: ChatMessage[];
}

export interface ClientToServerEvents {
  // Sala
  "room:join": (
    payload: { inviteCode: string; nickname: string; gmSecret?: string },
    ack: Ack<RoomSnapshot>,
  ) => void;

  // Cena (GM)
  "scene:create": (payload: { name: string }, ack: Ack<Scene>) => void;
  "scene:activate": (payload: { sceneId: string }, ack: Ack) => void;
  "scene:updateGrid": (payload: { sceneId: string; grid: Partial<GridConfig> }, ack: Ack<Scene>) => void;
  /** mapUrl vem do upload HTTP (POST /api/upload) feito antes. */
  "scene:setMap": (
    payload: { sceneId: string; mapUrl: string; mapWidth: number; mapHeight: number },
    ack: Ack<Scene>,
  ) => void;

  // Tokens
  "token:create": (payload: TokenCreate, ack: Ack<Token>) => void;
  /** Usado para arrastar/redimensionar. Cliente envia throttled (~30/s) enquanto arrasta. */
  "token:update": (payload: TokenPatch, ack: Ack<Token>) => void;
  "token:delete": (payload: { tokenId: string }, ack: Ack) => void;

  // Chat + dados
  /** Se text começar com "/r " o servidor interpreta como rolagem. */
  "chat:send": (payload: { text: string }, ack: Ack<ChatMessage>) => void;

  // Iniciativa (GM, exceto "initiative:roll" que jogadores podem usar no próprio token)
  "initiative:add": (payload: Omit<InitiativeEntry, "id">, ack: Ack<InitiativeState>) => void;
  "initiative:update": (payload: Partial<InitiativeEntry> & { id: string }, ack: Ack<InitiativeState>) => void;
  "initiative:remove": (payload: { entryId: string }, ack: Ack<InitiativeState>) => void;
  "initiative:next": (payload: Record<string, never>, ack: Ack<InitiativeState>) => void;
  "initiative:prev": (payload: Record<string, never>, ack: Ack<InitiativeState>) => void;
  "initiative:reset": (payload: Record<string, never>, ack: Ack<InitiativeState>) => void;
}

export interface ServerToClientEvents {
  "room:participantJoined": (p: Participant) => void;
  "room:participantLeft": (p: { id: string }) => void;
  "room:activeSceneChanged": (p: { sceneId: string }) => void;

  "scene:created": (scene: Scene) => void;
  "scene:updated": (scene: Scene) => void;

  "token:created": (token: Token) => void;
  "token:updated": (token: Token) => void;
  "token:deleted": (p: { tokenId: string }) => void;

  "chat:message": (msg: ChatMessage) => void;

  "initiative:updated": (state: InitiativeState) => void;

  /** Erros não relacionados a um ack específico. */
  "server:error": (p: { message: string }) => void;
}

/** Dados guardados no socket no servidor (socket.data). */
export interface SocketData {
  roomId: string;
  participantId: string;
  role: "gm" | "player";
}
