import { ChatRevealSchema, ChatSendSchema, FormulaError, resolveCharacterFormula, getSystemDefinition } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { parseChatCommand } from "../services/chatCommands.js";
import { toCharacter } from "../services/characters.js";
import { emitChatMessage } from "../services/chatVisibility.js";
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
    guarded(socket, ChatSendSchema, async ({ text, visibility }, ctx) => {
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
      // "/gmr" e "/pr" forçam a visibilidade; "/r" segue o modo de rolagem do autor.
      const formula = cmd.formula.includes("{") ? await resolveWithOwnCharacter(ctx.roomId, me.id, cmd.formula) : cmd.formula;
      const { message } = await createRollMessage(io, ctx.roomId, me, { formula, label: cmd.label, visibility: cmd.visibility ?? visibility });
      return message;
    }),
  );

  socket.on(
    "chat:reveal",
    guarded(
      socket,
      ChatRevealSchema,
      async ({ messageId }, ctx) => {
        const row = await prisma.chatMessage.findUnique({ where: { id: messageId } });
        if (!row || row.roomId !== ctx.roomId) throw new HandlerError("Mensagem não encontrada");
        if (row.visibility === "all") throw new HandlerError("Esta mensagem já é pública");
        // Mesmo id, visibility nova: quem já tinha a mensagem atualiza; quem não tinha, recebe agora.
        const msg = toChatMessage(await prisma.chatMessage.update({ where: { id: messageId }, data: { visibility: "all" } }));
        await emitChatMessage(io, ctx.roomId, msg);
        return msg;
      },
      { gmOnly: true },
    ),
  );
}
