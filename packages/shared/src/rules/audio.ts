/**
 * Sons (docs/plano-preparo.md §3.1): posição atual de uma trilha sem depender de um timer no
 * servidor — `positionMs + (agoraServidor - at)`, com módulo pela duração quando está em loop e a
 * duração é conhecida (só o navegador a conhece de verdade; se não vier, não faz módulo).
 */
import type { AudioState, AudioTrackState } from "../schemas/audio.js";

export function trackPositionMs(track: AudioTrackState, opts: { now: number; durationMs?: number | null }): number {
  if (!track.playing) return track.positionMs;
  const elapsed = Math.max(0, opts.now - track.at);
  const raw = track.positionMs + elapsed;
  if (track.loop && opts.durationMs !== undefined && opts.durationMs !== null && opts.durationMs > 0) {
    return raw % opts.durationMs;
  }
  return raw;
}

/** Versão do estado que vai pro jogador e pra tela do Cast (docs/plano-preparo.md §3.4): sem
 *  `assetId` nem nome do arquivo original, só o que dá pra tocar/sincronizar. O GM recebe o estado
 *  cheio (ack de comando, e o snapshot dele — ver services/snapshot.ts). */
export function toPublicAudioState(state: AudioState): AudioState {
  if (!state.track) return state;
  const { assetId: _assetId, ...publicTrack } = state.track;
  return { track: publicTrack };
}
