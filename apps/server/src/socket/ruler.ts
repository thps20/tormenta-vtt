import { RulerUpdateSchema } from "@tormenta-vtt/shared";
import { guarded } from "./ack.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

/**
 * Régua de medição: estado efêmero. Só validamos e repassamos aos OUTROS da
 * sala (o autor já desenha a própria régua localmente; ecoar 30 vezes por
 * segundo não traria nada). Nada é gravado no banco.
 */
export function registerRulerHandlers(_io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "ruler:update",
    guarded(socket, RulerUpdateSchema, async ({ sceneId, ruler }, ctx) => {
      socket.to(rooms.all(ctx.roomId)).emit("ruler:updated", {
        participantId: ctx.participantId,
        nickname: socket.data.nickname,
        sceneId,
        ruler,
      });
    }),
  );
}
