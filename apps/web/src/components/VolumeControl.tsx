import React, { useEffect, useRef, useState } from "react";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import { useAudio } from "../store/audio";
import { FLOAT_SURFACE, MOTION } from "./MapBar";

/**
 * Botão de alto-falante na TopBar (docs/plano-preparo.md §3.3), pra TODO MUNDO (GM e jogador) —
 * volume + silenciar tudo, salvo por usuário/navegador (`store/audio.ts#volume/muted`, nunca por
 * sala). Não existe "volume pra mesa": este é só o volume de QUEM está com a aba aberta, igual a
 * qualquer outro player de mídia — sem mixagem nem volume por trilha nesta versão.
 */
export const VolumeControl: React.FC = () => {
  const volume = useAudio((s) => s.volume);
  const muted = useAudio((s) => s.muted);
  const blocked = useAudio((s) => s.blocked);
  const setVolume = useAudio((s) => s.setVolume);
  const setMuted = useAudio((s) => s.setMuted);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const Icon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div ref={rootRef} className="relative">
      <button
        id="btn-volume-control"
        onClick={() => setOpen((v) => !v)}
        title={muted ? "Som silenciado" : "Volume"}
        className={`focus-ring relative flex items-center justify-center w-8 h-8 rounded-ui text-text-muted hover:text-text hover:bg-surface-2 cursor-pointer ${MOTION}`}
      >
        <Icon className="w-4 h-4" />
        {/* Autoplay bloqueado (§3.3): o navegador não deixa tocar sem um gesto — o primeiro clique
         *  em qualquer lugar (inclusive este botão) já destrava, ver AudioEngine.tsx. */}
        {blocked && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-accent" aria-label="Áudio bloqueado — clique para ativar" />}
      </button>

      {open && (
        <div className={`absolute right-0 top-9 z-30 w-44 p-3 flex flex-col gap-2 ${FLOAT_SURFACE}`}>
          <label className="flex items-center gap-2 text-12 text-text">
            <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} className="cursor-pointer" />
            Silenciar
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            disabled={muted}
            className="w-full cursor-pointer disabled:opacity-40"
          />
          {blocked && <p className="text-11 text-text-muted">Áudio bloqueado pelo navegador — clique em qualquer lugar da página pra ativar.</p>}
        </div>
      )}
    </div>
  );
};
