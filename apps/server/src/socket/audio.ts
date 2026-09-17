/**
 * Sons (docs/plano-preparo.md §3): GM controla trilha/efeito (`gmOnly`). Broadcast em DOIS envios,
 * não um só pra `rooms.all`: `rooms.gm` recebe o `AudioState` cheio (com `assetId`, útil pro GM
 * saber o que está tocando); `rooms.players` recebe a versão redigida (`toPublicAudioState`) — a
 * tela do Cast está em `rooms.players` também (`display:join`, socket/display.ts), então cai no
 * mesmo redigido, nunca vendo `assetId` nem nome do arquivo original (§3.4).
 */
import { AudioEffectSchema, AudioPlaySchema, AudioSeekSchema, EmptySchema, toPublicAudioState, type AudioState } from "@tormenta-vtt/shared";
import { pauseTrack, playTrack, resolveEffectUrl, resumeTrack, seekTrack, stopTrack } from "../services/audio.js";
import { guarded } from "./ack.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

const gmOnly = { gmOnly: true };

export function registerAudioHandlers(io: TypedServer, socket: TypedSocket): void {
  function broadcastState(roomId: string, state: AudioState): void {
    const serverNow = Date.now();
    io.to(rooms.gm(roomId)).emit("audio:state", { state, serverNow });
    io.to(rooms.players(roomId)).emit("audio:state", { state: toPublicAudioState(state), serverNow });
  }

  socket.on(
    "audio:play",
    guarded(
      socket,
      AudioPlaySchema,
      async ({ assetId, loop }, ctx) => {
        const state = await playTrack(ctx.roomId, assetId, loop);
        broadcastState(ctx.roomId, state);
        return state;
      },
      gmOnly,
    ),
  );

  socket.on(
    "audio:pause",
    guarded(
      socket,
      EmptySchema,
      async (_input, ctx) => {
        const state = pauseTrack(ctx.roomId);
        broadcastState(ctx.roomId, state);
        return state;
      },
      gmOnly,
    ),
  );

  socket.on(
    "audio:resume",
    guarded(
      socket,
      EmptySchema,
      async (_input, ctx) => {
        const state = resumeTrack(ctx.roomId);
        broadcastState(ctx.roomId, state);
        return state;
      },
      gmOnly,
    ),
  );

  socket.on(
    "audio:stop",
    guarded(
      socket,
      EmptySchema,
      async (_input, ctx) => {
        const state = stopTrack(ctx.roomId);
        broadcastState(ctx.roomId, state);
        return state;
      },
      gmOnly,
    ),
  );

  socket.on(
    "audio:seek",
    guarded(
      socket,
      AudioSeekSchema,
      async ({ positionMs }, ctx) => {
        const state = seekTrack(ctx.roomId, positionMs);
        broadcastState(ctx.roomId, state);
        return state;
      },
      gmOnly,
    ),
  );

  socket.on(
    "audio:effect",
    guarded(
      socket,
      AudioEffectSchema,
      async ({ assetId }, ctx) => {
        const url = await resolveEffectUrl(ctx.roomId, assetId);
        io.to(rooms.all(ctx.roomId)).emit("audio:effect", { url });
      },
      gmOnly,
    ),
  );
}
