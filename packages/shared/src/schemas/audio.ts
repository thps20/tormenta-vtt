import { z } from "zod";
import { IdSchema } from "./common.js";

/**
 * Sons (docs/plano-preparo.md §3): trilha em loop + efeitos avulsos, sincronizados pra todos.
 * Estado em memória no servidor (mesmo padrão do blackout do Cast, `services/display.ts`) — perde
 * num restart, aceitável pra música ambiente. Uma trilha por vez; efeito toca por cima sem cortar
 * a trilha (fogo-e-esquece, nunca entra neste estado nem no snapshot).
 */
export const AudioTrackStateSchema = z.object({
  /** Opcional: o jogador (e a tela do Cast) só recebe a URL (nome aleatório de upload) — nunca
   *  `assetId`/nome (§3.4). O servidor omite o campo ao montar o broadcast/snapshot pra quem não é
   *  GM (`rules/audio.ts#toPublicAudioState`); presente só na resposta (ack) de quem comandou. */
  assetId: IdSchema.optional(),
  url: z.string().min(1),
  loop: z.boolean(),
  playing: z.boolean(),
  /** Posição no instante `at`; posição "agora" = `positionMs + (agoraServidor - at)` quando
   *  `playing`, ver `rules/audio.ts#trackPositionMs`. */
  positionMs: z.number().int().min(0),
  /** Relógio do servidor (`Date.now()`) em que `positionMs` valia. */
  at: z.number(),
});
export type AudioTrackState = z.infer<typeof AudioTrackStateSchema>;

export const AudioStateSchema = z.object({
  track: AudioTrackStateSchema.nullable(),
});
export type AudioState = z.infer<typeof AudioStateSchema>;

// --- Eventos (GM, §3.2) --------------------------------------------------------------------------

/** Troca a trilha e começa do 0. */
export const AudioPlaySchema = z.object({ assetId: IdSchema, loop: z.boolean() });
export type AudioPlayPayload = z.infer<typeof AudioPlaySchema>;

/** Disponível pro player, não obrigatório na UI (§3.2). */
export const AudioSeekSchema = z.object({ positionMs: z.number().int().min(0) });
export type AudioSeekPayload = z.infer<typeof AudioSeekSchema>;

/** Toca uma vez, por cima da trilha, sem entrar no estado (fogo-e-esquece). */
export const AudioEffectSchema = z.object({ assetId: IdSchema });
export type AudioEffectPayload = z.infer<typeof AudioEffectSchema>;

// --- Preferência local de volume (§3.3) -----------------------------------------------------------

/**
 * Volume/silenciar do PRÓPRIO usuário, guardado no navegador (`localStorage`, chave `tvtt:audio`,
 * mesmo padrão de `TabletopPrefsSchema`/`lib/tabletopPrefs.ts`) — nunca por sala nem sincronizado
 * pelo servidor: cada um ouve no volume que quiser, sem mixagem nem "volume pra mesa" (§3.3).
 */
export const AudioUiPrefsSchema = z.object({
  volume: z.number().min(0).max(1).default(1),
  muted: z.boolean().default(false),
});
export type AudioUiPrefs = z.infer<typeof AudioUiPrefsSchema>;
