/**
 * Desfazer/refazer (docs/plano-desfazer.md): só o GM (`gmOnly`), pilha em memória por sala
 * (services/history.ts). `revert`/`apply` de cada entrada reconferem premissas antes de escrever
 * (§7) — se falharem, a entrada é descartada (some da pilha, não vai pro lado oposto) em vez de
 * ficar tentando de novo pra sempre.
 */
import { EmptySchema, type HistoryActionResult } from "@tormenta-vtt/shared";
import { moveToRedo, moveToUndo, peekSummaries, popRedo, popUndo } from "../services/history.js";
import { guarded, HandlerError } from "./ack.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

/** Emite o estado da pilha pro GM (botões da Toolbar habilitados/desabilitados + tooltip). Chamado
 *  depois de qualquer push (ação nova desfazível) ou pop (undo/redo) — ver socket/token.ts e
 *  socket/compendium.ts pros pushes. */
export function emitHistoryUpdated(io: TypedServer, roomId: string): void {
  io.to(rooms.gm(roomId)).emit("history:updated", peekSummaries(roomId));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "erro desconhecido";
}

export function registerHistoryHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "history:undo",
    guarded(
      socket,
      EmptySchema,
      async (_payload, ctx): Promise<HistoryActionResult | null> => {
        const entry = popUndo(ctx.roomId);
        if (!entry) return null;
        try {
          await entry.revert();
        } catch (err) {
          // A entrada já saiu do undo (popUndo) e não volta: ficou inválida (§7), some de vez.
          emitHistoryUpdated(io, ctx.roomId);
          throw new HandlerError(`Não foi possível desfazer: ${errorMessage(err)}`);
        }
        moveToRedo(ctx.roomId, entry);
        emitHistoryUpdated(io, ctx.roomId);
        return { summary: entry.summary };
      },
      { gmOnly: true },
    ),
  );

  socket.on(
    "history:redo",
    guarded(
      socket,
      EmptySchema,
      async (_payload, ctx): Promise<HistoryActionResult | null> => {
        const entry = popRedo(ctx.roomId);
        if (!entry) return null;
        try {
          await entry.apply();
        } catch (err) {
          emitHistoryUpdated(io, ctx.roomId);
          throw new HandlerError(`Não foi possível refazer: ${errorMessage(err)}`);
        }
        moveToUndo(ctx.roomId, entry);
        emitHistoryUpdated(io, ctx.roomId);
        return { summary: entry.summary };
      },
      { gmOnly: true },
    ),
  );
}
