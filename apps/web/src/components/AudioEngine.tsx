import { useEffect, useRef } from "react";
import { trackPositionMs } from "@tormenta-vtt/shared";
import { effectiveVolume, tryPlay } from "../lib/audioEngine";
import { useAudio } from "../store/audio";

/**
 * Sons (docs/plano-preparo.md §3.3): dono de verdade dos dois `<audio>` (trilha em loop + efeito
 * avulso, tocando por cima sem cortar a trilha) — "engine fora do React", mesmo espírito de
 * `DiceOverlay3D.tsx`, só que aqui é a API nativa do navegador. Montado UMA VEZ em `RoomPage.tsx`
 * (GM e jogador) e em `DisplayPage.tsx` (Cast) — os dois pontos reagem ao MESMO `store/audio.ts`
 * (hidratado do MESMO campo `RoomSnapshot.audio`/`DisplaySnapshot.audio`), sem nenhuma diferença
 * de código entre "sala" e "tela de exibição". Não renderiza nada visível — os elementos ficam
 * escondidos (`display:none` não serve pra `<audio>` continuar tocando em todo navegador; `hidden`
 * junto de posição fora da tela é mais seguro).
 */
export const AudioEngine: React.FC = () => {
  const track = useAudio((s) => s.track);
  const skewMs = useAudio((s) => s.skewMs);
  const volume = useAudio((s) => s.volume);
  const muted = useAudio((s) => s.muted);
  const effectRequest = useAudio((s) => s.effectRequest);
  const blocked = useAudio((s) => s.blocked);
  const setBlocked = useAudio((s) => s.setBlocked);

  const trackRef = useRef<HTMLAudioElement>(null);
  const effectRef = useRef<HTMLAudioElement>(null);
  const lastUrlRef = useRef<string | null>(null);
  const lastEffectNonceRef = useRef<number>(-1);

  // Troca de trilha/posição/play-pause: ajusta src, currentTime e play()/pause() do elemento.
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    if (!track) {
      el.pause();
      el.removeAttribute("src");
      lastUrlRef.current = null;
      return;
    }
    const now = Date.now() + skewMs;
    const positionMs = trackPositionMs(track, { now, durationMs: Number.isFinite(el.duration) ? el.duration * 1000 : null });
    if (lastUrlRef.current !== track.url) {
      el.src = track.url;
      lastUrlRef.current = track.url;
    }
    el.loop = track.loop;
    // Só corrige o `currentTime` se desviou mais de 1s do esperado (§3.1) — não "pula" a cada render.
    if (Math.abs(el.currentTime * 1000 - positionMs) > 1000) el.currentTime = positionMs / 1000;
    if (track.playing) {
      void tryPlay(el).then((ok) => setBlocked(!ok));
    } else {
      el.pause();
    }
  }, [track, skewMs, setBlocked]);

  // Volume dos dois elementos (trilha + efeito) segue a mesma preferência local.
  useEffect(() => {
    const v = effectiveVolume({ volume, muted });
    if (trackRef.current) trackRef.current.volume = v;
    if (effectRef.current) effectRef.current.volume = v;
  }, [volume, muted]);

  // Efeito avulso: toca uma vez, sem entrar no estado da trilha.
  useEffect(() => {
    const el = effectRef.current;
    if (!el || !effectRequest || effectRequest.nonce === lastEffectNonceRef.current) return;
    lastEffectNonceRef.current = effectRequest.nonce;
    el.src = effectRequest.url;
    el.currentTime = 0;
    void tryPlay(el);
  }, [effectRequest]);

  // Autoplay bloqueado (§3.3): o primeiro gesto em QUALQUER lugar da página tenta de novo e
  // recalcula a posição certa — não do zero. `capture` pra pegar o clique mesmo se algo por cima
  // (um diálogo, o mapa) parar a propagação antes de chegar no listener normal.
  useEffect(() => {
    if (!blocked) return;
    const retry = () => {
      const el = trackRef.current;
      const current = useAudio.getState().track;
      if (!el || !current?.playing) {
        setBlocked(false);
        return;
      }
      const now = Date.now() + useAudio.getState().skewMs;
      el.currentTime = trackPositionMs(current, { now, durationMs: Number.isFinite(el.duration) ? el.duration * 1000 : null }) / 1000;
      void tryPlay(el).then((ok) => setBlocked(!ok));
    };
    window.addEventListener("pointerdown", retry, { capture: true, once: true });
    window.addEventListener("keydown", retry, { capture: true, once: true });
    return () => {
      window.removeEventListener("pointerdown", retry, { capture: true });
      window.removeEventListener("keydown", retry, { capture: true });
    };
  }, [blocked, setBlocked]);

  return (
    <>
      <audio ref={trackRef} hidden />
      <audio ref={effectRef} hidden />
    </>
  );
};
