import { applyFogOp, FogUpdateSchema } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { emitCombat } from "../services/combat.js";
import { toScene, toToken } from "../services/serialize.js";
import { emitTokenToPlayers } from "../services/visibility.js";
import { guarded, HandlerError } from "./ack.js";
import { requireScene } from "./scene.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

/**
 * Névoa manual (GM). O cliente manda a OPERAÇÃO; o servidor aplica sobre o estado
 * do banco, persiste e devolve o estado completo em `fog:updated`. Em seguida
 * reenvia os tokens da cena aos jogadores: o que ficou coberto vira `token:deleted`
 * para eles, o que foi revelado chega como `token:updated`.
 */
export function registerFogHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "fog:update",
    guarded(socket, FogUpdateSchema, async ({ sceneId, op }, ctx) => {
      const current = toScene(await requireScene(sceneId, ctx.roomId)).fog;
      const applied = applyFogOp(current, op);
      if (!applied.ok) throw new HandlerError(applied.error);
      const fog = applied.fog;
      await prisma.scene.update({ where: { id: sceneId }, data: { fog } });
      io.to(rooms.all(ctx.roomId)).emit("fog:updated", { sceneId, fog });

      // Só a visibilidade para jogadores muda; o GM já tem todos os tokens.
      const tokens = await prisma.token.findMany({ where: { sceneId }, orderBy: { zIndex: "asc" } });
      for (const t of tokens) emitTokenToPlayers(io, ctx.roomId, toToken(t), "token:updated", fog);
      // A visibilidade do combate (se a cena tiver um) também pode ter mudado.
      await emitCombat(io, ctx.roomId, { role: "gm", participantId: ctx.participantId });
      return fog;
    }, { gmOnly: true }),
  );
}
