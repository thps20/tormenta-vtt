/**
 * Sons (docs/plano-preparo.md §3.1): posição atual de uma trilha sem depender de um timer no
 * servidor — `positionMs + (agoraServidor - at)`, com módulo pela duração quando está em loop e a
 * duração é conhecida (só o navegador a conhece de verdade; se não vier, não faz módulo).
 */
import type { AudioTrackState } from "../schemas/audio.js";

export function trackPositionMs(track: AudioTrackState, opts: { now: number; durationMs?: number | null }): number {
  if (!track.playing) return track.positionMs;
  const elapsed = Math.max(0, opts.now - track.at);
  const raw = track.positionMs + elapsed;
  if (track.loop && opts.durationMs !== undefined && opts.durationMs !== null && opts.durationMs > 0) {
    return raw % opts.durationMs;
  }
  return raw;
}
