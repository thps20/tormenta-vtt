/**
 * Quem recebe cada mensagem do chat. Duas regras, aplicadas em conjunto:
 *   1. `visibility` (all | gm | self) -> messageVisibleTo (mesma de sempre).
 *   2. `tokenId` (ver docs/plano-combate.md, acréscimo de 08/09) -> quem NÃO pode ver esse
 *      token (oculto ou sob a névoa) fica de fora por completo, mesmo com visibility "all" —
 *      nem o card, nem o placeholder de "rolagem secreta". O GM nunca é bloqueado por isso
 *      (ele vê todo token); o AUTOR também nunca é bloqueado por isso — sempre recebe a própria
 *      rolagem, mesmo que o GM tenha escondido o token dele depois. O gate vale só para os
 *      demais jogadores. Usada no broadcast (emitChatMessage) e no snapshot (histórico).
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
 */
export async function emitChatMessage(io: TypedServer, roomId: string, msg: ChatMessage): Promise<void> {
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
