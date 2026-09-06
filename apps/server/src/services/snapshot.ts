import { FogConfigSchema, type ChatMessage, type RoomSnapshot } from "@tormenta-vtt/shared";
import type { Participant as DbParticipant, Room as DbRoom } from "@prisma/client";
import { prisma } from "../db.js";
import { isConnected } from "./presence.js";
import { loadInitiativeState } from "./initiativeState.js";
import { toChatMessage, toParticipant, toRoomPublic, toScene, toToken } from "./serialize.js";
import { characterVisibleTo, toCharacter } from "./characters.js";
import { tokenVisibleTo } from "./visibility.js";

const CHAT_HISTORY_LIMIT = 100;

/** Rolagem secreta: só GM e autor. */
export function messageVisibleTo(msg: ChatMessage, role: "gm" | "player", participantId: string): boolean {
  if (msg.kind !== "roll" || !msg.roll?.secret) return true;
  return role === "gm" || msg.participantId === participantId;
}

/** Estado completo da sala do ponto de vista de `me`. */
export async function buildSnapshot(room: DbRoom, me: DbParticipant): Promise<RoomSnapshot> {
  const [participants, scenes, tokens, messages, initiative, characters] = await Promise.all([
    prisma.participant.findMany({ where: { roomId: room.id }, orderBy: { createdAt: "asc" } }),
    prisma.scene.findMany({ where: { roomId: room.id }, orderBy: { createdAt: "asc" } }),
    room.activeSceneId
      ? prisma.token.findMany({ where: { sceneId: room.activeSceneId }, orderBy: { zIndex: "asc" } })
      : Promise.resolve([]),
    prisma.chatMessage.findMany({
      where: { roomId: room.id },
      orderBy: { createdAt: "desc" },
      take: CHAT_HISTORY_LIMIT,
    }),
    loadInitiativeState(room.id, me.role === "gm"),
    prisma.character.findMany({ where: { roomId: room.id }, orderBy: { createdAt: "asc" } }),
  ]);

  // Névoa da cena ativa: decide quais tokens alheios um jogador recebe.
  const activeScene = scenes.find((sc) => sc.id === room.activeSceneId);
  const fog = FogConfigSchema.parse(activeScene?.fog ?? {});
  const viewer = { role: me.role, participantId: me.id };

  return {
    room: toRoomPublic(room),
    me: toParticipant(me, true),
    sessionToken: me.sessionToken,
    participants: participants.map((p) => toParticipant(p, isConnected(room.id, p.id))),
    scenes: scenes.map(toScene),
    tokens: tokens.map(toToken).filter((t) => tokenVisibleTo(t, viewer, fog)),
    initiative,
    chat: messages
      .reverse()
      .map(toChatMessage)
      .filter((m) => messageVisibleTo(m, me.role, me.id)),
    characters: characters.map(toCharacter).filter((c) => characterVisibleTo(c, me.role)),
  };
}
