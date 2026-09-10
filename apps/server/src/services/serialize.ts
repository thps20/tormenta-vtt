/**
 * Converte linhas do Prisma nos tipos do shared que vão para o cliente.
 * Diferenças: Date -> string ISO; `grid`/`roll` são Json no banco e precisam
 * ser validados pelo schema Zod antes de sair (garantia de formato).
 */
import type { ChatMessage as DbChatMessage, Participant as DbParticipant, Room as DbRoom, Scene as DbScene, Token as DbToken } from "@prisma/client";
import {
  ArrivalPointSchema,
  ChatMessageSchema,
  FogConfigSchema,
  GridConfigSchema,
  TokenConditionEntrySchema,
  TokenHpSchema,
  type ChatMessage,
  type Participant,
  type RoomPublic,
  type Scene,
  type Token,
} from "@tormenta-vtt/shared";

export function toRoomPublic(room: DbRoom): RoomPublic {
  return {
    id: room.id,
    name: room.name,
    inviteCode: room.inviteCode,
    systemId: room.systemId,
    activeSceneId: room.activeSceneId,
    createdAt: room.createdAt.toISOString(),
  };
}

export function toParticipant(p: DbParticipant, connected: boolean): Participant {
  return { id: p.id, nickname: p.nickname, role: p.role, connected };
}

export function toScene(scene: DbScene): Scene {
  return {
    id: scene.id,
    roomId: scene.roomId,
    name: scene.name,
    mapUrl: scene.mapUrl,
    mapWidth: scene.mapWidth,
    mapHeight: scene.mapHeight,
    // Se o JSON estiver incompleto, os defaults do schema preenchem.
    grid: GridConfigSchema.parse(scene.grid ?? {}),
    fog: FogConfigSchema.parse(scene.fog ?? {}),
    order: scene.order,
    // `deletedAt` NÃO entra no Scene do shared (é coluna só do banco, como Token.deletedAt): um
    // mapa apagado simplesmente não é serializado para ninguém.
    arrival: ArrivalPointSchema.nullable().parse(scene.arrival),
    createdAt: scene.createdAt.toISOString(),
  };
}

export function toToken(t: DbToken): Token {
  return {
    id: t.id,
    sceneId: t.sceneId,
    name: t.name,
    imageUrl: t.imageUrl,
    x: t.x,
    y: t.y,
    width: t.width,
    height: t.height,
    rotation: t.rotation,
    zIndex: t.zIndex,
    visible: t.visible,
    ownerId: t.ownerId,
    color: t.color,
    characterId: t.characterId,
    hp: TokenHpSchema.nullable().parse(t.hp),
    // `conditions` é Json no banco (sem tipo garantido pelo Prisma): o preprocess do schema aceita
    // tanto a forma antiga (string, gravada antes desta mudança) quanto { key, expiresRound? }.
    conditions: TokenConditionEntrySchema.array().parse(t.conditions),
  };
}

export function toChatMessage(m: DbChatMessage): ChatMessage {
  return ChatMessageSchema.parse({
    id: m.id,
    roomId: m.roomId,
    participantId: m.participantId,
    nickname: m.nickname,
    kind: m.kind,
    text: m.text ?? undefined,
    roll: m.roll ?? undefined,
    item: m.item ?? undefined,
    initiativeBatch: m.initiativeBatch ?? undefined,
    handout: m.handout ?? undefined,
    visibility: m.visibility,
    tokenId: m.tokenId,
    whisperTo: m.whisperTo,
    createdAt: m.createdAt.toISOString(),
  });
}
