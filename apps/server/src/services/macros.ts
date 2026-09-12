/**
 * Macros (docs/SPEC.md §9.20): barra de botões por PARTICIPANTE, persistida por sala. Estritamente
 * pessoal — nem o GM edita/reordena/apaga a macro de outro participante (diferente de Pin/Handout,
 * que são recursos do GM).
 */
import type { Macro as DbMacro } from "@prisma/client";
import { MacroActionSchema, nextMacroOrder, type Macro, type MacroAction } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { HandlerError, type Ctx } from "../socket/ack.js";
import { canEditCharacter } from "./characters.js";

/** Linha do Prisma -> Macro do shared. Passa pelo Zod pra garantir o formato de `action` mesmo se
 *  um JSON antigo carregar um formato de uma versão anterior. */
export function toMacro(row: DbMacro): Macro {
  return { id: row.id, label: row.label, icon: row.icon, color: row.color, order: row.order, action: MacroActionSchema.parse(row.action) };
}

/** Carrega a macro e confirma que é desta sala. */
export async function requireMacro(macroId: string, roomId: string): Promise<DbMacro> {
  const row = await prisma.macro.findUnique({ where: { id: macroId } });
  if (!row || row.roomId !== roomId) throw new HandlerError("Macro não encontrada");
  return row;
}

/** Macro é estritamente pessoal: nem o GM mexe na de outro participante. */
export function canEditMacro(ctx: Pick<Ctx, "participantId">, macro: Pick<DbMacro, "participantId">): boolean {
  return macro.participantId === ctx.participantId;
}

/**
 * `characterAction`/`useItem`: o autor precisa controlar a ficha apontada — mesma `canEditCharacter`
 * que `character:roll`/`character:use-item` já checam na hora de EXECUTAR. Validar aqui também, na
 * criação/edição da macro, evita deixar existir um botão "impossível" sem avisar o autor logo de
 * cara (a execução em si já estaria protegida de qualquer jeito, mesmo sem esta checagem).
 * `roll`/`chatText` não referenciam ficha nenhuma: sempre válidas.
 */
export async function validateMacroAction(ctx: Ctx, action: MacroAction): Promise<void> {
  if (action.type !== "characterAction" && action.type !== "useItem") return;
  const character = await prisma.character.findUnique({ where: { id: action.characterId } });
  if (!character || character.roomId !== ctx.roomId) throw new HandlerError("Ficha não encontrada");
  if (!canEditCharacter(ctx, character)) throw new HandlerError("Você não controla esta ficha");
}

/** Macros do participante nesta sala, já ordenadas (mesma lista que entra no RoomSnapshot). */
export async function listMacros(roomId: string, participantId: string): Promise<Macro[]> {
  const rows = await prisma.macro.findMany({ where: { roomId, participantId }, orderBy: { order: "asc" } });
  return rows.map(toMacro);
}

/** Próxima posição (fim da barra) pra uma macro nova deste participante. */
export async function nextMacroOrderFor(roomId: string, participantId: string): Promise<number> {
  const rows = await prisma.macro.findMany({ where: { roomId, participantId }, select: { order: true } });
  return nextMacroOrder(rows);
}
