import { randomUUID } from "node:crypto";
import type { Participant as DbParticipant } from "@prisma/client";
import { DiceParseError, parseFormula, rollParsed, rollParsedMany, type ChatMessage, type DamageComponent, type DiceRoll, type RollVisibility } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { HandlerError } from "../socket/ack.js";
import type { TypedServer } from "../socket/types.js";
import { emitChatMessage, redactForAuthor } from "./chatVisibility.js";
import { toChatMessage } from "./serialize.js";

export interface RollMessageInput {
  /** Fórmula já sem placeholders. */
  formula: string;
  label?: string;
  /** Modo de rolagem (all | gm | self). */
  visibility: RollVisibility;
  /** Rolagem vinda de uma ficha. */
  characterId?: string;
  critThreshold?: number;
  /** Dano fixo ("2") é uma "rolagem" sem dado; no chat (/r) continua exigindo dado. */
  allowNoDice?: boolean;
  /** Parcelas de dano por tipo (ação de dano da ficha): cada uma é rolada em separado e `formula` é ignorada. */
  damage?: DamageComponent[];
}

/**
 * Rola NO SERVIDOR, persiste como ChatMessage{kind:"roll"} e faz o broadcast
 * conforme a visibilidade. Usado pelo chat (/r, /gmr, /pr) e pela ficha (character:roll).
 * Devolve a mensagem como o autor pode vê-la (às cegas = sem `roll`).
 */
export async function createRollMessage(io: TypedServer, roomId: string, me: DbParticipant, input: RollMessageInput): Promise<ChatMessage> {
  let outcome;
  let damage: DiceRoll["damage"];
  try {
    if (input.damage && input.damage.length > 0) {
      // Uma parcela por tipo de dano: rolar em separado dá o total de cada tipo para o chat.
      const multi = rollParsedMany(input.damage.map((d) => parseFormula(d.formula, { requireDice: !input.allowNoDice })));
      outcome = multi;
      damage = multi.parts.map((part, i) => ({ damageType: input.damage?.[i]?.damageType ?? null, ...part }));
    } else {
      outcome = rollParsed(parseFormula(input.formula, { requireDice: !input.allowNoDice }));
    }
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
    characterId: input.characterId,
    critThreshold: input.critThreshold,
    damage,
    applied: [],
    createdAt: new Date().toISOString(),
  };

  const msg = toChatMessage(
    await prisma.chatMessage.create({
      data: { roomId, participantId: me.id, nickname: me.nickname, kind: "roll", roll: diceRoll, visibility: input.visibility },
    }),
  );

  emitChatMessage(io, roomId, msg);
  return redactForAuthor(msg, { role: me.role === "gm" ? "gm" : "player", participantId: me.id });
}
