import { FogConfigSchema, getSystemDefinition, type Combat, type RoomSnapshot } from "@tormenta-vtt/shared";
import type { Participant as DbParticipant, Room as DbRoom } from "@prisma/client";
import { prisma } from "../db.js";
import { isConnected } from "./presence.js";
import { loadCombatRow, toCombat } from "./combat.js";
import { toChatMessage, toParticipant, toRoomPublic, toScene, toToken } from "./serialize.js";
import { characterVisibleTo, toCharacter } from "./characters.js";
import { tokenVisibleTo } from "./visibility.js";
import { messageVisibleTo, tokenGateOk } from "./chatVisibility.js";

const CHAT_HISTORY_LIMIT = 100;

/** Estado completo da sala do ponto de vista de `me`. */
export async function buildSnapshot(room: DbRoom, me: DbParticipant): Promise<RoomSnapshot> {
  const [participants, scenes, tokens, messages, combatRow, characters] = await Promise.all([
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
    room.activeSceneId ? loadCombatRow(room.activeSceneId) : Promise.resolve(null),
    prisma.character.findMany({ where: { roomId: room.id }, orderBy: { createdAt: "asc" } }),
  ]);

  // Névoa da cena ativa: decide quais tokens (e combatentes) alheios um jogador recebe.
  const activeScene = scenes.find((sc) => sc.id === room.activeSceneId);
  const fog = FogConfigSchema.parse(activeScene?.fog ?? {});
  const viewer = { role: me.role, participantId: me.id };
  const def = getSystemDefinition(room.systemId);

  const combat: Combat | null = combatRow ? toCombat(combatRow, def, viewer, fog) : null;

  // Mensagens ligadas a um token (combate/ficha): quem não vê esse token não recebe a mensagem
  // (nem histórico), mesmo que ele já tenha sido revelado/escondido depois de ela ser criada —
  // o snapshot sempre reavalia com o token/névoa de AGORA (ver docs/plano-combate.md, acréscimo).
  const tokenIds = [...new Set(messages.map((m) => m.tokenId).filter((id): id is string => id !== null))];
  const tokenRows = tokenIds.length
    ? await prisma.token.findMany({ where: { id: { in: tokenIds } }, include: { scene: true } })
    : [];
  const tokenInfoById = new Map(tokenRows.map((t) => [t.id, { token: toToken(t), fog: FogConfigSchema.parse(t.scene.fog ?? {}) }]));

  return {
    room: toRoomPublic(room),
    me: toParticipant(me, true),
    sessionToken: me.sessionToken,
    participants: participants.map((p) => toParticipant(p, isConnected(room.id, p.id))),
    scenes: scenes.map(toScene),
    tokens: tokens.map(toToken).filter((t) => tokenVisibleTo(t, viewer, fog)),
    combat,
    chat: messages
      .reverse()
      .map(toChatMessage)
      .filter((m) => tokenGateOk(m.tokenId, viewer, m.participantId, tokenInfoById.get(m.tokenId ?? "")) && messageVisibleTo(m, viewer)),
    characters: characters.map(toCharacter).filter((c) => characterVisibleTo(c, me.role)),
  };
}
