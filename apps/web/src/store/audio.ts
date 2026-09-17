import { create } from "zustand";
import type { AudioState as SyncedAudioState } from "@tormenta-vtt/shared";
import { loadAudioPrefs, saveAudioPrefs } from "../lib/audioPrefs";
import { emitAck } from "./connection";
import { toast } from "./ui";

/**
 * Sons (docs/plano-preparo.md §3): estado da trilha/efeito sincronizado com o servidor (fonte da
 * verdade — as ações de comando abaixo só EMITEM o evento; quem atualiza `track` de verdade é o
 * broadcast `audio:state` chegando por `bindSocket.ts`, mesmo pro GM que comandou, mesmo padrão do
 * resto do projeto). `skewMs` guarda só a diferença de relógio (`serverNow - Date.now()` no
 * instante da última atualização) — NUNCA um timer: a posição "agora" é sempre recalculada na hora
 * de tocar (`rules/audio.ts#trackPositionMs`), com `Date.now() + skewMs` no lugar do relógio do
 * servidor. `blocked`/`effectRequest` são efêmeros, geridos por `components/AudioEngine.tsx`.
 */
interface AudioStoreState {
  track: SyncedAudioState["track"];
  skewMs: number;
  hydrated: boolean;
  /** Autoplay bloqueado NESTA aba agora (`NotAllowedError`) — ver `components/AudioEngine.tsx`. */
  blocked: boolean;
  /** Último efeito pedido (fogo-e-esquece): `nonce` garante que tocar o MESMO efeito duas vezes
   *  seguidas ainda dispara o `useEffect` de quem escuta (senão um objeto igual não re-renderiza). */
  effectRequest: { url: string; nonce: number } | null;

  /** Preferência local (§3.3, `lib/audioPrefs.ts`) — por usuário/navegador, nunca por sala. Vive
   *  aqui (não numa store à parte) pra `AudioEngine`/`VolumeControl`/`AudioPlayer` lerem e
   *  reagirem ao mesmo estado sem duplicar. */
  volume: number;
  muted: boolean;
  setVolume: (volume: number) => void;
  setMuted: (muted: boolean) => void;

  hydrateFromSnapshot: (audio: { state: SyncedAudioState; serverNow: number }) => void;
  applyState: (state: SyncedAudioState, serverNow: number) => void;
  applyEffect: (url: string) => void;
  setBlocked: (blocked: boolean) => void;

  // Comandos do GM (o servidor recusa quem não for GM; a UI só mostra os controles pro GM mesmo).
  play: (assetId: string, loop: boolean) => Promise<boolean>;
  pause: () => Promise<boolean>;
  resume: () => Promise<boolean>;
  stop: () => Promise<boolean>;
  seek: (positionMs: number) => Promise<boolean>;
  effect: (assetId: string) => Promise<boolean>;

  reset: () => void;
}

let effectNonce = 0;

const initialPrefs = loadAudioPrefs();

export const useAudio = create<AudioStoreState>((set) => ({
  track: null,
  skewMs: 0,
  hydrated: false,
  blocked: false,
  effectRequest: null,
  volume: initialPrefs.volume,
  muted: initialPrefs.muted,

  // Não entra no `reset()` (troca de sala/logout): é preferência do NAVEGADOR, não da sala.
  setVolume: (volume) =>
    set((s) => {
      saveAudioPrefs({ volume, muted: s.muted });
      return { volume };
    }),
  setMuted: (muted) =>
    set((s) => {
      saveAudioPrefs({ volume: s.volume, muted });
      return { muted };
    }),

  hydrateFromSnapshot: ({ state, serverNow }) => set({ track: state.track, skewMs: serverNow - Date.now(), hydrated: true, blocked: false }),
  applyState: (state, serverNow) => set({ track: state.track, skewMs: serverNow - Date.now() }),
  applyEffect: (url) => set({ effectRequest: { url, nonce: ++effectNonce } }),
  setBlocked: (blocked) => set({ blocked }),

  play: async (assetId, loop) => {
    const res = await emitAck("audio:play", { assetId, loop });
    if (!res.ok) toast(res.error);
    return res.ok;
  },
  pause: async () => {
    const res = await emitAck("audio:pause", {});
    if (!res.ok) toast(res.error);
    return res.ok;
  },
  resume: async () => {
    const res = await emitAck("audio:resume", {});
    if (!res.ok) toast(res.error);
    return res.ok;
  },
  stop: async () => {
    const res = await emitAck("audio:stop", {});
    if (!res.ok) toast(res.error);
    return res.ok;
  },
  seek: async (positionMs) => {
    const res = await emitAck("audio:seek", { positionMs });
    if (!res.ok) toast(res.error);
    return res.ok;
  },
  effect: async (assetId) => {
    const res = await emitAck("audio:effect", { assetId });
    if (!res.ok) toast(res.error);
    return res.ok;
  },

  reset: () => set({ track: null, skewMs: 0, hydrated: false, blocked: false, effectRequest: null }),
}));
