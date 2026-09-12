/**
 * Macros (docs/SPEC.md §9.20): barra de botões por PARTICIPANTE, persistida por sala — 100%
 * pessoal, sem gmOnly (cada um mexe só nas próprias). Broadcast só pras próprias abas do
 * participante (`rooms.participant`), nunca pra sala toda. EXECUTAR uma macro não passa por
 * nenhum evento daqui: o cliente reemite `chat:send`/`character:roll`/`character:use-item` direto
 * com os parâmetros guardados — a permissão de executar já é garantida por aqueles handlers.
 */
import { MacroCreateSchema, MacroRemoveSchema, MacroReorderSchema, MacroUpdateSchema, reorderMacros } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { canEditMacro, listMacros, nextMacroOrderFor, requireMacro, toMacro, validateMacroAction } from "../services/macros.js";
import { guarded, HandlerError } from "./ack.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

export function registerMacroHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "macro:create",
    guarded(socket, MacroCreateSchema, async ({ label, icon, color, action }, ctx) => {
      await validateMacroAction(ctx, action);
      const order = await nextMacroOrderFor(ctx.roomId, ctx.participantId);
      const row = await prisma.macro.create({ data: { roomId: ctx.roomId, participantId: ctx.participantId, order, label, icon, color, action } });
      const macro = toMacro(row);
      io.to(rooms.participant(ctx.participantId)).emit("macro:created", macro);
      return macro;
    }),
  );

  socket.on(
    "macro:update",
    guarded(socket, MacroUpdateSchema, async ({ id, patch }, ctx) => {
      const row = await requireMacro(id, ctx.roomId);
      if (!canEditMacro(ctx, row)) throw new HandlerError("Você não controla esta macro");
      if (patch.action) await validateMacroAction(ctx, patch.action);

      const updatedRow = await prisma.macro.update({
        where: { id },
        data: {
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
          ...(patch.color !== undefined ? { color: patch.color } : {}),
          ...(patch.action !== undefined ? { action: patch.action } : {}),
        },
      });
      const macro = toMacro(updatedRow);
      io.to(rooms.participant(ctx.participantId)).emit("macro:updated", macro);
      return macro;
    }),
  );

  socket.on(
    "macro:remove",
    guarded(socket, MacroRemoveSchema, async ({ id }, ctx) => {
      const row = await requireMacro(id, ctx.roomId);
      if (!canEditMacro(ctx, row)) throw new HandlerError("Você não controla esta macro");
      await prisma.macro.delete({ where: { id } });
      io.to(rooms.participant(ctx.participantId)).emit("macro:removed", { id });
    }),
  );

  socket.on(
    "macro:reorder",
    guarded(socket, MacroReorderSchema, async ({ macroIds }, ctx) => {
      const current = await listMacros(ctx.roomId, ctx.participantId);
      const result = reorderMacros(current, macroIds);
      if (!result.ok) throw new HandlerError(result.error);
      await prisma.$transaction(result.order.map((o) => prisma.macro.update({ where: { id: o.id }, data: { order: o.order } })));
      io.to(rooms.participant(ctx.participantId)).emit("macro:reordered", { order: result.order });
      return { order: result.order };
    }),
  );
}
