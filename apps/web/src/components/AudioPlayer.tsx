import React from "react";
import { Pause, Play, Repeat, Repeat1, Square } from "lucide-react";
import { trackPositionMs } from "@tormenta-vtt/shared";
import { useAudio } from "../store/audio";
import { useLibrary } from "../store/library";
import { MOTION } from "./MapBar";

/**
 * Player do GM na TopBar (docs/plano-preparo.md §3.3, só GM): nome da trilha (o GM é o único que
 * recebe `assetId` no estado — `rules/audio.ts#toPublicAudioState` esconde isso de jogador/Cast),
 * ▶/⏸, ⏹, alternar repetir, volume (reaproveita `VolumeControl`, montado à parte na TopBar — não
 * duplica slider aqui). Tocar algo em si é pelo Acervo ou pelo Preparo; este player só CONTROLA o
 * que já está tocando.
 *
 * **Limitação documentada**: o servidor não tem um comando "só mude o loop sem reiniciar" — `loop`
 * é decidido em `audio:play`, junto da troca de trilha (ver `AudioPlaySchema`). Alternar repetir
 * aqui reinicia a trilha do zero com o loop invertido (`play(assetId, !loop)`); é o comportamento
 * mais simples e correto disponível hoje. Se isso incomodar na prática, um `audio:set-loop` novo
 * resolveria sem reiniciar — decisão pra revisitar se o dono do projeto notar o efeito colateral.
 */
export const AudioPlayer: React.FC = () => {
  const track = useAudio((s) => s.track);
  const skewMs = useAudio((s) => s.skewMs);
  const play = useAudio((s) => s.play);
  const pause = useAudio((s) => s.pause);
  const resume = useAudio((s) => s.resume);
  const stop = useAudio((s) => s.stop);
  const assets = useLibrary((s) => s.assets);

  if (!track || !track.assetId) return null;
  const assetId = track.assetId; // const à parte: preserva a narrowing dentro dos closures dos onClick abaixo

  const asset = assets.find((a) => a.id === assetId);
  const name = asset?.name ?? "Trilha";
  const positionMs = trackPositionMs(track, { now: Date.now() + skewMs, durationMs: null });

  return (
    <div className="flex items-center gap-1 h-8 pl-1 pr-2 rounded-ui border border-border bg-surface-1">
      <button
        id="btn-audio-toggle"
        onClick={() => void (track.playing ? pause() : resume())}
        title={track.playing ? "Pausar" : "Tocar"}
        className={`focus-ring flex items-center justify-center w-6 h-6 rounded-ui text-text-muted hover:text-text hover:bg-surface-2 cursor-pointer ${MOTION}`}
      >
        {track.playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
      </button>
      <button
        id="btn-audio-stop"
        onClick={() => void stop()}
        title="Parar"
        className={`focus-ring flex items-center justify-center w-6 h-6 rounded-ui text-text-muted hover:text-text hover:bg-surface-2 cursor-pointer ${MOTION}`}
      >
        <Square className="w-3.5 h-3.5" />
      </button>
      <button
        id="btn-audio-loop"
        onClick={() => void play(assetId, !track.loop)}
        title={track.loop ? "Repetindo — clique pra tocar só uma vez (reinicia a trilha)" : "Tocando uma vez — clique pra repetir (reinicia a trilha)"}
        className={`focus-ring flex items-center justify-center w-6 h-6 rounded-ui cursor-pointer ${MOTION} ${
          track.loop ? "text-accent" : "text-text-muted hover:text-text hover:bg-surface-2"
        }`}
      >
        {track.loop ? <Repeat className="w-3.5 h-3.5" /> : <Repeat1 className="w-3.5 h-3.5" />}
      </button>
      <span className="text-12 text-text truncate max-w-[9rem]" title={name}>
        {name}
      </span>
      <span className="sr-only">{Math.round(positionMs / 1000)}s</span>
    </div>
  );
};
