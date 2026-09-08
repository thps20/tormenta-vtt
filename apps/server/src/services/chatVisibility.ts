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

/** Emite `chat:message` só para as salas Socket.io que a visibilidade permite. */
export function emitChatMessage(io: TypedServer, roomId: string, msg: ChatMessage): void {
  switch (msg.visibility) {
    case "all":
      io.to(rooms.all(roomId)).emit("chat:message", msg);
      return;
    case "gm":
      io.to(rooms.gm(roomId)).emit("chat:message", msg);
      return;
    case "self":
      io.to(rooms.participant(msg.participantId)).emit("chat:message", msg);
      return;
  }
}

/**
 * O ack do autor não pode vazar o que ele não pode ver: uma rolagem às cegas
 * volta sem `roll` (o cliente usa isso para avisar "enviada ao GM").
 */
export function redactForAuthor(msg: ChatMessage, author: Viewer): ChatMessage {
  if (messageVisibleTo(msg, author)) return msg;
  const { roll: _roll, item: _item, text: _text, ...rest } = msg;
  return rest;
}
