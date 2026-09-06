import { ChatSendSchema, FormulaError, resolveCharacterFormula, getSystemDefinition } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { parseChatCommand } from "../services/chatCommands.js";
import { toCharacter } from "../services/characters.js";
import { createRollMessage } from "../services/rolls.js";
import { toChatMessage } from "../services/serialize.js";
import { guarded, HandlerError } from "./ack.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

/**
 * "/r 1d20+{skill.luta}": resolve os placeholders com a ficha do autor.
 * Precisa ter exatamente UMA ficha própria; com várias, use a própria ficha para rolar.
 */
async function resolveWithOwnCharacter(roomId: string, participantId: string, formula: string): Promise<string> {
  const rows = await prisma.character.findMany({ where: { roomId, ownerId: participantId } });
  if (rows.length === 0) throw new HandlerError("Você não tem ficha nesta sala para resolver {…} na fórmula");
  if (rows.length > 1) throw new HandlerError("Você tem mais de uma ficha; role pela ficha para o servidor saber qual usar");
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room) throw new HandlerError("Sala não encontrada");
  try {
    return resolveCharacterFormula(getSystemDefinition(room.systemId), toCharacter(rows[0]!), formula);
  } catch (err) {
    if (err instanceof FormulaError) throw new HandlerError(err.message);
    throw err;
  }
}

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
      const formula = cmd.formula.includes("{") ? await resolveWithOwnCharacter(ctx.roomId, me.id, cmd.formula) : cmd.formula;
      return createRollMessage(io, ctx.roomId, me, { formula, label: cmd.label, secret: cmd.secret });
    }),
  );
}
