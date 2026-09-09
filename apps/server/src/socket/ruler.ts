import { RulerUpdateSchema } from "@tormenta-vtt/shared";
import { isActiveScene } from "../services/visibility.js";
import { guarded, HandlerError } from "./ack.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

/**
 * Régua de medição: estado efêmero. Só validamos e repassamos aos OUTROS da
 * sala (o autor já desenha a própria régua localmente; ecoar 30 vezes por
 * segundo não traria nada). Nada é gravado no banco.
 *
 * Regra de broadcast de mapa (docs/plano-mapas.md §5): o GM sempre recebe (pode ser outro GM
 * medindo no mapa que este está preparando); jogador só se `sceneId` é o mapa ATIVO da sala — uma
 * régua de GM navegando um mapa que os jogadores não veem não deveria aparecer pra eles.
 */
export function registerRulerHandlers(_io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "ruler:update",
    guarded(socket, RulerUpdateSchema, async ({ sceneId, ruler }, ctx) => {
      // Defesa em profundidade (docs/plano-mapas.md §11): jogador só mede no mapa ATIVO — o
      // cliente honesto nem tem o id de outro mapa.
      if (ctx.role === "player" && !(await isActiveScene(ctx.roomId, sceneId))) {
        throw new HandlerError("Este mapa não está ativo");
      }
      const payload = { participantId: ctx.participantId, nickname: socket.data.nickname, sceneId, ruler };
      socket.to(rooms.gm(ctx.roomId)).emit("ruler:updated", payload);
      if (await isActiveScene(ctx.roomId, sceneId)) socket.to(rooms.players(ctx.roomId)).emit("ruler:updated", payload);
    }),
  );
}
