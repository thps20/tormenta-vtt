import { z } from "zod";
import { IdSchema } from "./common.js";
import { GridConfigSchema } from "./scene.js";
import { FogShapeSchema } from "./fog.js";
import { InitiativeEntrySchema } from "./initiative.js";
import { CharacterDataSchema, CharacterKindSchema, CharacterRollRequestSchema } from "./character.js";

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

// --- Névoa (fog of war manual) ----------------------------------------------

/**
 * Operações sobre a névoa da cena. O cliente manda a OPERAÇÃO, não a lista inteira:
 * assim dois cliques rápidos do GM não sobrescrevem um ao outro. O servidor aplica,
 * persiste e devolve o estado completo em `fog:updated`.
 */
export const FogOpSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add"), shape: FogShapeSchema }),
  /** Desfazer último: tira a última shape da lista (sem histórico completo). */
  z.object({ type: z.literal("removeLast") }),
  /** Limpa a lista e seta base = revealed / hidden. */
  z.object({ type: z.literal("revealAll") }),
  z.object({ type: z.literal("hideAll") }),
  z.object({ type: z.literal("setEnabled"), enabled: z.boolean() }),
]);
export type FogOp = z.infer<typeof FogOpSchema>;

export const FogUpdateSchema = z.object({ sceneId: IdSchema, op: FogOpSchema });
export type FogUpdatePayload = z.infer<typeof FogUpdateSchema>;

// --- Tokens ----------------------------------------------------------------

export const TokenDeleteSchema = z.object({ tokenId: IdSchema });
/** Vincula (ou desvincula, com null) uma ficha ao token. */
export const TokenLinkCharacterSchema = z.object({ tokenId: IdSchema, characterId: IdSchema.nullable() });
export type TokenLinkCharacterPayload = z.infer<typeof TokenLinkCharacterSchema>;

// --- Régua (efêmera) -------------------------------------------------------

/** Ponto em pixels do mapa. */
const MapPointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

export const RulerSchema = z.object({ start: MapPointSchema, end: MapPointSchema });
export type Ruler = z.infer<typeof RulerSchema>;

/** Régua que o participante está desenhando; null = soltou (apagar). Nada é persistido. */
export const RulerUpdateSchema = z.object({ sceneId: IdSchema, ruler: RulerSchema.nullable() });
export type RulerUpdatePayload = z.infer<typeof RulerUpdateSchema>;

// --- Ficha -----------------------------------------------------------------

/** O servidor preenche os defaults do sistema (createDefaultCharacterData). */
export const CharacterCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: CharacterKindSchema.default("pc"),
  ownerId: IdSchema.nullable().default(null),
});
export type CharacterCreatePayload = z.infer<typeof CharacterCreateSchema>;

/**
 * Patch raso: cada campo enviado substitui o campo inteiro (ex.: `items` manda
 * a lista completa). Jogador não pode mudar ownerId nem kind (servidor ignora).
 */
export const CharacterPatchSchema = CharacterDataSchema.partial().extend({
  name: z.string().trim().min(1).max(80).optional(),
  ownerId: IdSchema.nullable().optional(),
  kind: CharacterKindSchema.optional(),
});
export type CharacterPatch = z.infer<typeof CharacterPatchSchema>;

export const CharacterUpdateSchema = z.object({ id: IdSchema, patch: CharacterPatchSchema });
export type CharacterUpdatePayload = z.infer<typeof CharacterUpdateSchema>;

export const CharacterDeleteSchema = z.object({ characterId: IdSchema });

export const CharacterRollSchema = z.object({
  characterId: IdSchema,
  roll: CharacterRollRequestSchema,
  secret: z.boolean().default(false),
});
export type CharacterRollPayload = z.infer<typeof CharacterRollSchema>;

/** Usa um item ativo (poder, magia): desconta o custo e publica o card no chat. */
export const CharacterUseItemSchema = z.object({ characterId: IdSchema, itemId: IdSchema });
export type CharacterUseItemPayload = z.infer<typeof CharacterUseItemSchema>;

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
