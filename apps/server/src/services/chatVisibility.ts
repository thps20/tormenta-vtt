/**
 * Quem recebe cada mensagem do chat. Duas regras, aplicadas em conjunto:
 *   1. `visibility` (all | gm | self) -> messageVisibleTo (mesma de sempre).
 *   2. `tokenId` (ver docs/plano-combate.md, acréscimo de 08/09) -> quem NÃO pode ver esse
 *      token (oculto ou sob a névoa) fica de fora por completo, mesmo com visibility "all" —
 *      nem o card, nem o placeholder de "rolagem secreta". O GM nunca é bloqueado por isso
 *      (ele vê todo token); o AUTOR também nunca é bloqueado por isso — sempre recebe a própria
 *      rolagem, mesmo que o GM tenha escondido o token dele depois. O gate vale só para os
 *      demais jogadores. Usada no broadcast (emitChatMessage) e no snapshot (histórico).
 *
 * Um card de iniciativa em lote (`kind: "initiative-batch"`, combat:roll rolando vários
 * combatentes de uma vez) tem várias linhas, cada uma com o seu próprio token: aí a regra 2 vira
 * por linha em vez de pela mensagem inteira (linha de token oculto some da cópia do jogador, sem
 * derrubar as outras), e a regra 1 decide só se `formula`/`result` aparecem em cada linha, não se
 * a linha existe — ver `initiativeBatchForViewer`.
 */
import { FogConfigSchema, type ChatMessage, type FogConfig, type Token } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { rooms, type TypedServer } from "../socket/types.js";
import { toToken } from "./serialize.js";
import { tokenVisibleTo } from "./visibility.js";

export interface Viewer {
  role: "gm" | "player";
  participantId: string;
}

export function messageVisibleTo(msg: ChatMessage, viewer: Viewer): boolean {
  switch (msg.visibility) {
    case "all":
      return true;
    case "gm":
      return viewer.role === "gm";
    case "self":
      return msg.participantId === viewer.participantId;
  }
}

/**
 * Ids dos jogadores (nunca o GM, nunca o autor) que não podem ver o token e por isso ficam de
 * fora da mensagem.
 */
async function blockedPlayerIds(roomId: string, tokenId: string, authorParticipantId: string): Promise<string[]> {
  const row = await prisma.token.findUnique({ where: { id: tokenId }, include: { scene: true } });
  if (!row) return []; // token apagado: a FK já zerou tokenId na mensagem antes desta chamada acontecer de novo.
  const token = toToken(row);
  const fog = FogConfigSchema.parse(row.scene.fog ?? {});
  const players = await prisma.participant.findMany({ where: { roomId, role: "player" } });
  return players
    .filter((p) => p.id !== authorParticipantId)
    .filter((p) => !tokenVisibleTo(token, { role: "player", participantId: p.id }, fog))
    .map((p) => p.id);
}

/**
 * Token + névoa da cena de cada um de `tokenIds`, pronto pra `tokenVisibleTo`. Usado pro gate por
 * linha de um card de iniciativa em lote (`initiativeBatchForViewer`) e reaproveitável pelo
 * snapshot (histórico), que já refaz essa consulta pra mensagens com `tokenId` único.
 */
export async function loadTokenInfo(tokenIds: string[]): Promise<Map<string, { token: Token; fog: FogConfig }>> {
  if (tokenIds.length === 0) return new Map();
  const rows = await prisma.token.findMany({ where: { id: { in: tokenIds } }, include: { scene: true } });
  return new Map(rows.map((t) => [t.id, { token: toToken(t), fog: FogConfigSchema.parse(t.scene.fog ?? {}) }]));
}

/**
 * Mesma regra de `blockedPlayerIds`, mas para filtrar uma lista já carregada (histórico do
 * snapshot): passa `authorParticipantId` da própria mensagem (`msg.participantId`) — o autor
 * nunca é bloqueado por essa regra, mesmo que o token dele esteja oculto.
 */
export function tokenGateOk(
  tokenId: string | null | undefined,
  viewer: Viewer,
  authorParticipantId: string,
  tokenInfo: { token: Token; fog: FogConfig } | undefined,
): boolean {
  if (!tokenId) return true;
  if (viewer.role === "gm") return true;
  if (viewer.participantId === authorParticipantId) return true;
  if (!tokenInfo) return true; // referência órfã (não deveria acontecer, a FK zera); não trava o resto do chat por isso.
  return tokenVisibleTo(tokenInfo.token, { role: "player", participantId: viewer.participantId }, tokenInfo.fog);
}

/**
 * Emite `chat:message` para a sala toda: quem não pode ver o resultado recebe
 * a mesma mensagem sem `roll`/`item`/`text` (existe no chat dele, com um
 * placeholder no lugar do conteúdo) em vez de nada. Quem pode ver recebe a
 * versão completa por cima, mesmo `id` — o cliente faz upsert (igual ao
 * Revelar: `chat:reveal` chama esta função de novo com `visibility:"all"`,
 * e aí todo mundo já está na sala que recebe o conteúdo completo).
 *
 * Quando a mensagem tem `tokenId`, quem não vê esse token fica de fora de TUDO
 * (nem o placeholder) — daí o `.except(...)` nos dois envios abaixo.
 *
 * Um card de iniciativa em lote (`kind: "initiative-batch"`) não tem um `tokenId` só: cada
 * linha cita o seu, e o gate é por linha (não pela mensagem inteira) — delega pra
 * `emitInitiativeBatchMessage`, que manda uma cópia calculada pra cada participante.
 */
export async function emitChatMessage(io: TypedServer, roomId: string, msg: ChatMessage): Promise<void> {
  if (msg.kind === "initiative-batch") return emitInitiativeBatchMessage(io, roomId, msg);

  const blocked = msg.tokenId ? await blockedPlayerIds(roomId, msg.tokenId, msg.participantId) : [];
  const exceptRooms = blocked.map(rooms.participant);
  const withExcept = (target: ReturnType<TypedServer["to"]>) => (exceptRooms.length ? target.except(exceptRooms) : target);

  if (msg.visibility === "all") {
    withExcept(io.to(rooms.all(roomId))).emit("chat:message", msg);
    return;
  }
  withExcept(io.to(rooms.all(roomId))).emit("chat:message", redactMessage(msg));
  const visibleRoom = msg.visibility === "gm" ? rooms.gm(roomId) : rooms.participant(msg.participantId);
  withExcept(io.to(visibleRoom)).emit("chat:message", msg);
}

/**
 * Card de iniciativa em lote do ponto de vista de UM viewer: linha a linha, quem não vê o token
 * daquela linha (oculto/névoa) fica sem ela — a linha simplesmente não existe pra ele, não um
 * placeholder (diferente do `tokenId` único de cima, que bloqueia a mensagem inteira). Nas linhas
 * que sobram, `formula`/`result` só aparecem se `visibility` (all/gm/self) permite a este viewer
 * (mesma regra de sempre); os demais recebem só `name`/`tokenId`/`combatantId` (a UI mostra
 * "rolou"). `undefined` = nenhuma linha sobrou — o viewer não recebe o card.
 */
export function initiativeBatchForViewer(
  msg: ChatMessage,
  viewer: Viewer,
  tokenInfoById: Map<string, { token: Token; fog: FogConfig }>,
): ChatMessage | undefined {
  if (!msg.initiativeBatch) return undefined;
  const showValues = messageVisibleTo(msg, viewer);
  const entries = msg.initiativeBatch.entries
    .filter((e) => {
      const info = tokenInfoById.get(e.tokenId);
      return !info || tokenVisibleTo(info.token, viewer, info.fog); // referência órfã: não trava (mesma regra do resto)
    })
    .map((e) => (showValues ? e : { combatantId: e.combatantId, tokenId: e.tokenId, name: e.name }));
  if (entries.length === 0) return undefined;
  return { ...msg, initiativeBatch: { round: msg.initiativeBatch.round, entries } };
}

/** Manda a cópia de `initiativeBatchForViewer` pra cada participante que tem alguma linha a ver. */
async function emitInitiativeBatchMessage(io: TypedServer, roomId: string, msg: ChatMessage): Promise<void> {
  if (!msg.initiativeBatch) return;
  const tokenInfoById = await loadTokenInfo([...new Set(msg.initiativeBatch.entries.map((e) => e.tokenId))]);
  const participants = await prisma.participant.findMany({ where: { roomId } });
  for (const p of participants) {
    const view = initiativeBatchForViewer(msg, { role: p.role === "gm" ? "gm" : "player", participantId: p.id }, tokenInfoById);
    if (view) io.to(rooms.participant(p.id)).emit("chat:message", view);
  }
}

/** Tira o conteúdo (`roll`/`item`/`text`) de uma mensagem, sem checar permissão. */
export function redactMessage(msg: ChatMessage): ChatMessage {
  const { roll: _roll, item: _item, text: _text, ...rest } = msg;
  return rest;
}

/**
 * O ack do autor não pode vazar o que ele não pode ver: uma rolagem às cegas
 * volta sem `roll` (o cliente usa isso para avisar "enviada ao GM").
 */
export function redactForAuthor(msg: ChatMessage, author: Viewer): ChatMessage {
  return messageVisibleTo(msg, author) ? msg : redactMessage(msg);
}
