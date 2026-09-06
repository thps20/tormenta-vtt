import { randomUUID } from "node:crypto";
import type { Participant as DbParticipant } from "@prisma/client";
import { DiceParseError, parseFormula, rollParsed, type ChatMessage, type DiceRoll } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { HandlerError } from "../socket/ack.js";
import { rooms, type TypedServer } from "../socket/types.js";
import { toChatMessage } from "./serialize.js";

export interface RollMessageInput {
  /** Fórmula já sem placeholders. */
  formula: string;
  label?: string;
  secret: boolean;
  /** Rolagem vinda de uma ficha. */
  characterId?: string;
  critThreshold?: number;
  /** Dano fixo ("2") é uma "rolagem" sem dado; no chat (/r) continua exigindo dado. */
  allowNoDice?: boolean;
}

/**
 * Rola NO SERVIDOR, persiste como ChatMessage{kind:"roll"} e faz o broadcast
 * (secreta: só GM + autor). Usado pelo chat (/r, /gr) e pela ficha (character:roll).
 */
export async function createRollMessage(io: TypedServer, roomId: string, me: DbParticipant, input: RollMessageInput): Promise<ChatMessage> {
  let outcome;
  try {
    outcome = rollParsed(parseFormula(input.formula, { requireDice: !input.allowNoDice }));
  } catch (err) {
    if (err instanceof DiceParseError) throw new HandlerError(`Fórmula inválida: ${err.message}`);
    throw err;
  }

  const diceRoll: DiceRoll = {
    id: randomUUID(),
    roomId,
    participantId: me.id,
    nickname: me.nickname,
    formula: outcome.formula,
    label: input.label,
    groups: outcome.groups,
    modifier: outcome.modifier,
    total: outcome.total,
    secret: input.secret,
    characterId: input.characterId,
    critThreshold: input.critThreshold,
    createdAt: new Date().toISOString(),
  };

  const msg = toChatMessage(
    await prisma.chatMessage.create({
      data: { roomId, participantId: me.id, nickname: me.nickname, kind: "roll", roll: diceRoll },
    }),
  );

  if (input.secret) {
    // Socket.io deduplica quando o mesmo socket está nas duas salas.
    io.to(rooms.gm(roomId)).to(rooms.participant(me.id)).emit("chat:message", msg);
  } else {
    io.to(rooms.all(roomId)).emit("chat:message", msg);
  }
  return msg;
}
