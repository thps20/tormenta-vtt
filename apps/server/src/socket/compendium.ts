import { EmptySchema } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { listCompendium } from "../services/compendium.js";
import { guarded, HandlerError } from "./ack.js";
import type { TypedServer, TypedSocket } from "./types.js";

export function registerCompendiumHandlers(_io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "compendium:list",
    guarded(socket, EmptySchema, async (_input, ctx) => {
      const room = await prisma.room.findUnique({ where: { id: ctx.roomId } });
      if (!room) throw new HandlerError("Sala não encontrada");
      return listCompendium(room.systemId, room.id, ctx.role);
    }),
  );
}
