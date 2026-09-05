import { randomUUID } from "node:crypto";
import { ChatSendSchema, DiceParseError, roll, type DiceRoll } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { parseChatCommand } from "../services/chatCommands.js";
import { toChatMessage } from "../services/serialize.js";
import { guarded, HandlerError } from "./ack.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

export function registerChatHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "chat:send",
    guarded(socket, ChatSendSchema, async ({ text }, ctx) => {
      const me = await prisma.participant.findUnique({ where: { id: ctx.participantId } });
      if (!me) throw new HandlerError("Participante não encontrado");

      const cmd = parseChatCommand(text);

      if (cmd.kind === "text") {
        const msg = toChatMessage(
          await prisma.chatMessage.create({
            data: { roomId: ctx.roomId, participantId: me.id, nickname: me.nickname, kind: "text", text: cmd.text },
          }),
        );
        io.to(rooms.all(ctx.roomId)).emit("chat:message", msg);
        return msg;
      }

      // Rolagem acontece AQUI, no servidor: o cliente só mandou a fórmula.
      let outcome;
      try {
        outcome = roll(cmd.formula);
      } catch (err) {
        if (err instanceof DiceParseError) throw new HandlerError(`Fórmula inválida: ${err.message}`);
        throw err;
      }

      const diceRoll: DiceRoll = {
        id: randomUUID(),
        roomId: ctx.roomId,
        participantId: me.id,
        nickname: me.nickname,
        formula: outcome.formula,
        label: cmd.label,
        groups: outcome.groups,
        modifier: outcome.modifier,
        total: outcome.total,
        secret: cmd.secret,
        createdAt: new Date().toISOString(),
      };

      const msg = toChatMessage(
        await prisma.chatMessage.create({
          data: { roomId: ctx.roomId, participantId: me.id, nickname: me.nickname, kind: "roll", roll: diceRoll },
        }),
      );

      if (cmd.secret) {
        // Socket.io deduplica quando o mesmo socket está nas duas salas.
        io.to(rooms.gm(ctx.roomId)).to(rooms.participant(me.id)).emit("chat:message", msg);
      } else {
        io.to(rooms.all(ctx.roomId)).emit("chat:message", msg);
      }
      return msg;
    }),
  );
}
