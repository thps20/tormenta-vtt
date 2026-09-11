import { applyFogOp, FogUpdateSchema } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { emitCombat } from "../services/combat.js";
import { effectiveCellSize } from "../services/grid.js";
import { toScene, toToken } from "../services/serialize.js";
import { emitTokenToPlayers, isActiveScene } from "../services/visibility.js";
import { guarded, HandlerError } from "./ack.js";
import { requireScene } from "./scene.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

/**
 * Névoa manual (GM). O cliente manda a OPERAÇÃO; o servidor aplica sobre o estado
 * do banco, persiste e devolve o estado completo em `fog:updated`. Em seguida
 * reenvia os tokens da cena aos jogadores: o que ficou coberto vira `token:deleted`
 * para eles, o que foi revelado chega como `token:updated`.
 *
 * Regra de broadcast de mapa (docs/plano-mapas.md §5): GM sempre recebe (pode estar preparando um
 * mapa que a mesa não vê); jogador só se este é o mapa ATIVO da sala.
 */
export function registerFogHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "fog:update",
    guarded(socket, FogUpdateSchema, async ({ sceneId, op }, ctx) => {
      const scene = toScene(await requireScene(sceneId, ctx.roomId));
      const applied = applyFogOp(scene.fog, op);
      if (!applied.ok) throw new HandlerError(applied.error);
      const fog = applied.fog;
      await prisma.scene.update({ where: { id: sceneId }, data: { fog } });
      io.to(rooms.gm(ctx.roomId)).emit("fog:updated", { sceneId, fog });

      const active = await isActiveScene(ctx.roomId, sceneId);
      if (active) {
        io.to(rooms.players(ctx.roomId)).emit("fog:updated", { sceneId, fog });
        // Só a visibilidade para jogadores muda; o GM já tem todos os tokens.
        const geom = { fog, cellSizePx: effectiveCellSize(scene.grid) };
        const tokens = await prisma.token.findMany({ where: { sceneId, deletedAt: null }, orderBy: { zIndex: "asc" } });
        for (const t of tokens) emitTokenToPlayers(io, ctx.roomId, toToken(t), "token:updated", geom);
      }
      // A visibilidade do combate (se o mapa tiver um) também pode ter mudado.
      await emitCombat(io, ctx.roomId, sceneId, { role: "gm", participantId: ctx.participantId });
      return fog;
    }, { gmOnly: true }),
  );
}
