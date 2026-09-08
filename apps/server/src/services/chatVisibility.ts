/**
 * Quem recebe cada mensagem do chat. Uma regra só, usada no broadcast (ao
 * publicar e ao revelar) e no snapshot (histórico ao entrar na sala).
 *   all  -> todos
 *   gm   -> só o GM (o autor jogador NÃO vê: rolagem às cegas)
 *   self -> só o autor
 */
import type { ChatMessage } from "@tormenta-vtt/shared";
import { rooms, type TypedServer } from "../socket/types.js";

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
 * Emite `chat:message` para a sala toda: quem não pode ver o resultado recebe
 * a mesma mensagem sem `roll`/`item`/`text` (existe no chat dele, com um
 * placeholder no lugar do conteúdo) em vez de nada. Quem pode ver recebe a
 * versão completa por cima, mesmo `id` — o cliente faz upsert (igual ao
 * Revelar: `chat:reveal` chama esta função de novo com `visibility:"all"`,
 * e aí todo mundo já está na sala que recebe o conteúdo completo).
 */
export function emitChatMessage(io: TypedServer, roomId: string, msg: ChatMessage): void {
  if (msg.visibility === "all") {
    io.to(rooms.all(roomId)).emit("chat:message", msg);
    return;
  }
  io.to(rooms.all(roomId)).emit("chat:message", redactMessage(msg));
  const visibleRoom = msg.visibility === "gm" ? rooms.gm(roomId) : rooms.participant(msg.participantId);
  io.to(visibleRoom).emit("chat:message", msg);
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
