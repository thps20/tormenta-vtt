/**
 * Sons (docs/plano-preparo.md §3): trilha em loop + efeito avulso, sincronizados pra todos. Estado
 * em memória por sala (mesmo padrão do blackout do Cast, services/display.ts) — perde num restart
 * do servidor, aceitável pra música ambiente. Uma trilha por vez; efeito toca por cima sem cortar
 * a trilha (fogo-e-esquece, nunca entra neste estado nem no snapshot).
 */
import { trackPositionMs, type AudioState } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { HandlerError } from "../socket/ack.js";

const EMPTY_STATE: AudioState = { track: null };
const stateByRoom = new Map<string, AudioState>();

export function getAudioState(roomId: string): AudioState {
  return stateByRoom.get(roomId) ?? EMPTY_STATE;
}

function setAudioState(roomId: string, state: AudioState): AudioState {
  stateByRoom.set(roomId, state);
  return state;
}

/** Confere que o asset é de ÁUDIO, desta sala e não apagado; devolve a url resolvida. O cliente
 *  nunca manda url, só `assetId` — o servidor resolve, mesmo espírito de nunca confiar em dado de
 *  exibição vindo do cliente (§3.2/§3.4). */
async function requireAudioAsset(assetId: string, roomId: string): Promise<{ url: string }> {
  const row = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!row || row.roomId !== roomId || row.deletedAt !== null || row.kind !== "audio") throw new HandlerError("Áudio não encontrado no acervo");
  return { url: row.url };
}

/** `audio:play`: troca a trilha e começa do zero. */
export async function playTrack(roomId: string, assetId: string, loop: boolean): Promise<AudioState> {
  const { url } = await requireAudioAsset(assetId, roomId);
  return setAudioState(roomId, { track: { assetId, url, loop, playing: true, positionMs: 0, at: Date.now() } });
}

/** `audio:pause`: grava a posição calculada NESTE instante (não confia em `positionMs` parado). */
export function pauseTrack(roomId: string): AudioState {
  const state = getAudioState(roomId);
  if (!state.track) throw new HandlerError("Nenhuma trilha tocando");
  const positionMs = trackPositionMs(state.track, { now: Date.now() });
  return setAudioState(roomId, { track: { ...state.track, playing: false, positionMs, at: Date.now() } });
}

/** `audio:resume`: volta a tocar da posição salva em `pauseTrack`. */
export function resumeTrack(roomId: string): AudioState {
  const state = getAudioState(roomId);
  if (!state.track) throw new HandlerError("Nenhuma trilha tocando");
  return setAudioState(roomId, { track: { ...state.track, playing: true, at: Date.now() } });
}

/** `audio:stop`: idempotente (já parado não é erro, mesmo espírito de removeFromParty). */
export function stopTrack(roomId: string): AudioState {
  return setAudioState(roomId, { track: null });
}

/** `audio:seek`: ajusta a posição sem trocar de trilha nem de estado de play/pause. */
export function seekTrack(roomId: string, positionMs: number): AudioState {
  const state = getAudioState(roomId);
  if (!state.track) throw new HandlerError("Nenhuma trilha tocando");
  return setAudioState(roomId, { track: { ...state.track, positionMs, at: Date.now() } });
}

/** `audio:effect`: fogo-e-esquece — só resolve a url, nunca entra no estado (§3.1). */
export async function resolveEffectUrl(roomId: string, assetId: string): Promise<string> {
  const { url } = await requireAudioAsset(assetId, roomId);
  return url;
}
