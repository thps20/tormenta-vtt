import { FogConfigSchema, GridConfigSchema, getSystemDefinition, type Combat, type RoomSnapshot } from "@tormenta-vtt/shared";
import type { Participant as DbParticipant, Room as DbRoom } from "@prisma/client";
import { prisma } from "../db.js";
import { isConnected } from "./presence.js";
import { loadCombatRow, toCombat } from "./combat.js";
import { toChatMessage, toParticipant, toRoomPublic, toScene, toToken } from "./serialize.js";
import { characterVisibleTo, toCharacter } from "./characters.js";
import { effectiveCellSize } from "./grid.js";
import { redactTokenForViewer, tokenVisibleTo } from "./visibility.js";
import { initiativeBatchForViewer, loadTokenInfo, messageVisibleTo, rollTargetsForViewer, tokenGateOk, whisperGateOk } from "./chatVisibility.js";
import { listTemplates } from "./templates.js";
import { pinVisibleTo, toPin } from "./pins.js";
import { isMovementLimitEnabled } from "./movementLimit.js";
import { isAutoRollNpcInitiativeEnabled } from "./autoRollNpcInitiative.js";
import { partyFor, partyOf } from "./party.js";
import { listTargets } from "./targets.js";

const CHAT_HISTORY_LIMIT = 100;

/** Estado completo da sala do ponto de vista de `me`. */
export async function buildSnapshot(room: DbRoom, me: DbParticipant): Promise<RoomSnapshot> {
  const [participants, scenes, tokens, messages, combatRow, characters, pinRows] = await Promise.all([
    prisma.participant.findMany({ where: { roomId: room.id }, orderBy: { createdAt: "asc" } }),
    // Mapas apagados (soft delete, docs/plano-mapas.md §10) nunca vão pro cliente. Ordenados como
    // o painel "Mapas" mostra (order asc, createdAt desempata — mesma regra de rules/scenes.ts).
    prisma.scene.findMany({ where: { roomId: room.id, deletedAt: null }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] }),
    room.activeSceneId
      ? prisma.token.findMany({ where: { sceneId: room.activeSceneId, deletedAt: null }, orderBy: { zIndex: "asc" } })
      : Promise.resolve([]),
    prisma.chatMessage.findMany({
      where: { roomId: room.id },
      orderBy: { createdAt: "desc" },
      take: CHAT_HISTORY_LIMIT,
    }),
    room.activeSceneId ? loadCombatRow(room.activeSceneId) : Promise.resolve(null),
    prisma.character.findMany({ where: { roomId: room.id }, orderBy: { createdAt: "asc" } }),
    room.activeSceneId ? prisma.pin.findMany({ where: { sceneId: room.activeSceneId, deletedAt: null } }) : Promise.resolve([]),
  ]);

  // Névoa + cellSize da cena ativa: decide quais tokens (e combatentes) alheios um jogador recebe
  // (o centro do token, pra régua da névoa, depende de `cells` — docs/plano-grid.md).
  const activeScene = scenes.find((sc) => sc.id === room.activeSceneId);
  const fog = FogConfigSchema.parse(activeScene?.fog ?? {});
  const geom = { fog, cellSizePx: effectiveCellSize(GridConfigSchema.parse(activeScene?.grid ?? {})) };
  const viewer = { role: me.role, participantId: me.id };
  const def = getSystemDefinition(room.systemId);

  const combat: Combat | null = combatRow ? toCombat(combatRow, def, viewer, geom) : null;

  // Mensagens ligadas a um token (combate/ficha) ou cujas linhas citam tokens (card de
  // iniciativa em lote): quem não vê esses tokens não recebe a mensagem (nem histórico), mesmo
  // que eles já tenham sido revelados/escondidos depois de ela ser criada — o snapshot sempre
  // reavalia com o token/névoa de AGORA (ver docs/plano-combate.md, acréscimo).
  const chatMessages = messages.reverse().map(toChatMessage);
  const tokenIds = [
    ...new Set(
      chatMessages.flatMap((m) => [
        ...(m.tokenId ? [m.tokenId] : []),
        ...(m.initiativeBatch?.entries.map((e) => e.tokenId) ?? []),
        ...(m.roll?.targets.map((t) => t.tokenId) ?? []),
      ]),
    ),
  ];
  const tokenInfoById = await loadTokenInfo(tokenIds);

  // Alvos (docs/plano-alvos.md): GM vê tudo. Jogador vê os próprios sempre, nunca os do GM, e dos
  // outros jogadores só os ids de token que ele mesmo pode ver (mesmo filtro de tokenVisibleTo de
  // sempre — reaproveita loadTokenInfo, que já carrega token+névoa por id).
  const rawTargets = listTargets(room.id);
  const roleByParticipant = new Map(participants.map((p) => [p.id, p.role]));
  const targetTokenInfo = viewer.role === "player" ? await loadTokenInfo([...new Set(rawTargets.flatMap((t) => t.tokenIds))]) : new Map();
  const targets = rawTargets.flatMap((t) => {
    if (viewer.role === "gm" || t.participantId === viewer.participantId) return [t];
    if (roleByParticipant.get(t.participantId) === "gm") return []; // alvos do GM nunca vão a jogador
    const tokenIds = t.tokenIds.filter((id) => {
      const info = targetTokenInfo.get(id);
      return info !== undefined && tokenVisibleTo(info.token, viewer, info.geom);
    });
    return tokenIds.length > 0 ? [{ ...t, tokenIds }] : [];
  });

  return {
    room: toRoomPublic(room),
    me: toParticipant(me, true),
    sessionToken: me.sessionToken,
    participants: participants.map((p) => toParticipant(p, isConnected(room.id, p.id))),
    scenes: scenes.map(toScene),
    tokens: tokens
      .map(toToken)
      .filter((t) => tokenVisibleTo(t, viewer, geom))
      .map((t) => redactTokenForViewer(t, viewer)),
    combat,
    // Gabaritos são efêmeros (docs/plano-gabaritos.md): sem fog/visibilidade por token, todos que
    // veem o mapa ativo veem todos os gabaritos dele.
    templates: room.activeSceneId ? listTemplates(room.activeSceneId) : [],
    pins: pinRows.map(toPin).filter((p) => pinVisibleTo(p, viewer, room.activeSceneId)),
    chat: chatMessages.flatMap((m) => {
      if (m.kind === "initiative-batch") {
        const view = initiativeBatchForViewer(m, viewer, tokenInfoById, room.activeSceneId);
        return view ? [view] : [];
      }
      const ok =
        tokenGateOk(m.tokenId, viewer, m.participantId, tokenInfoById.get(m.tokenId ?? ""), room.activeSceneId) &&
        whisperGateOk(m, viewer) &&
        messageVisibleTo(m, viewer);
      if (!ok) return [];
      // Rolagem com alvos (docs/plano-alvos.md, regra 4): mesma redação por linha/campo do
      // broadcast ao vivo, reavaliada com o token/névoa/mapa ativo de AGORA.
      if (m.roll?.targets.length) {
        return [{ ...m, roll: { ...m.roll, targets: rollTargetsForViewer(m.roll.targets, viewer, tokenInfoById, room.activeSceneId) } }];
      }
      return [m];
    }),
    characters: characters.map(toCharacter).filter((c) => characterVisibleTo(c, me.role)),
    // Visão de grupo (SPEC §9.15): reusa os `characters` já carregados acima pra saber quem ainda é
    // PC, em vez de repetir a consulta (ver pcIdsOf, mesma regra, usada pelos eventos party:*).
    party: partyFor(partyOf(room), new Set(characters.filter((c) => c.kind === "pc").map((c) => c.id)), viewer.role),
    movementLimitEnabled: isMovementLimitEnabled(room.id),
    autoRollNpcInitiativeEnabled: isAutoRollNpcInitiativeEnabled(room.id),
    targets,
  };
}
