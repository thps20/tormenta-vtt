import { z } from "zod";
import { IdSchema } from "./common.js";
import { GridConfigSchema } from "./scene.js";
import { InitiativeEntrySchema } from "./initiative.js";

/**
 * Schemas dos payloads que entram no servidor (socket e HTTP).
 * Regra do projeto: a fronteira é Zod. O servidor faz `Schema.safeParse(payload)`
 * antes de tocar no banco; os tipos TS dos eventos vêm daqui via z.infer.
 */

const NicknameSchema = z.string().trim().min(1).max(32);

// --- HTTP ------------------------------------------------------------------

export const CreateRoomBodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  nickname: NicknameSchema,
});
export type CreateRoomBody = z.infer<typeof CreateRoomBodySchema>;

export const UploadResultSchema = z.object({
  url: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type UploadResult = z.infer<typeof UploadResultSchema>;

// --- Sala ------------------------------------------------------------------

/**
 * Primeira entrada: manda nickname (+ gmSecret se for o GM).
 * Reconexão: manda o sessionToken guardado no localStorage; nickname é ignorado.
 */
export const RoomJoinSchema = z.object({
  inviteCode: z.string().trim().min(1).max(32),
  nickname: NicknameSchema.optional(),
  gmSecret: z.string().optional(),
  sessionToken: z.string().optional(),
});
export type RoomJoinPayload = z.infer<typeof RoomJoinSchema>;

// --- Cena ------------------------------------------------------------------

export const SceneCreateSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const SceneActivateSchema = z.object({ sceneId: IdSchema });
export const SceneSetMapSchema = z.object({
  sceneId: IdSchema,
  mapUrl: z.string().min(1).nullable(),
  mapWidth: z.number().int().positive().nullable(),
  mapHeight: z.number().int().positive().nullable(),
});
export const SceneUpdateGridSchema = z.object({
  sceneId: IdSchema,
  grid: GridConfigSchema.partial(),
});
export type SceneSetMapPayload = z.infer<typeof SceneSetMapSchema>;
export type SceneUpdateGridPayload = z.infer<typeof SceneUpdateGridSchema>;

// --- Tokens ----------------------------------------------------------------

export const TokenDeleteSchema = z.object({ tokenId: IdSchema });

// --- Chat ------------------------------------------------------------------

export const ChatSendSchema = z.object({ text: z.string().trim().min(1).max(2000) });

// --- Iniciativa ------------------------------------------------------------

export const InitiativeAddSchema = InitiativeEntrySchema.omit({ id: true });
export const InitiativeUpdateSchema = InitiativeEntrySchema.partial().required({ id: true });
export const InitiativeRemoveSchema = z.object({ entryId: IdSchema });
export type InitiativeAddPayload = z.infer<typeof InitiativeAddSchema>;
export type InitiativeUpdatePayload = z.infer<typeof InitiativeUpdateSchema>;

/** Payload vazio (next/prev/reset). */
export const EmptySchema = z.object({}).strict();
