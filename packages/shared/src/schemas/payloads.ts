import { z } from "zod";
import { IdSchema } from "./common.js";
import { GridConfigSchema } from "./scene.js";
import { FogShapeSchema } from "./fog.js";
import { CharacterDataSchema, CharacterKindSchema, CharacterRollRequestSchema, EnhancementUseSchema } from "./character.js";
import { RollVisibilitySchema } from "./dice.js";

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

/**
 * Aplica um card de dano/cura do chat em um ou mais tokens. `amount` já vem com
 * sinal do cliente (negativo tira PV, positivo cura); o servidor só trava nos
 * limites (min/max da ficha, ou 0..max do token solto) e não precisa saber se
 * a rolagem "é" dano ou cura. Tudo-ou-nada: um alvo sem permissão rejeita o lote inteiro.
 */
export const TokenApplyDamageSchema = z.object({
  messageId: IdSchema,
  targets: z
    .array(z.object({ tokenId: IdSchema, amount: z.number().int(), multiplier: z.enum(["1", "0.5", "2", "0"]).optional() }))
    .min(1)
    .max(50),
});
export type TokenApplyDamagePayload = z.infer<typeof TokenApplyDamageSchema>;

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
  /** Modo de rolagem escolhido pelo autor (ver RollVisibilitySchema). */
  visibility: RollVisibilitySchema.default("all"),
});
export type CharacterRollPayload = z.infer<typeof CharacterRollSchema>;

/**
 * Usa um item ativo (poder, magia): desconta o custo e publica o card no chat.
 * `enhancements` = aprimoramentos escolhidos; o servidor valida contra o item
 * (ids existentes, times = 1 se não repetível) e cobra o custo total.
 */
export const CharacterUseItemSchema = z.object({ characterId: IdSchema, itemId: IdSchema, enhancements: z.array(EnhancementUseSchema).default([]) });
export type CharacterUseItemPayload = z.infer<typeof CharacterUseItemSchema>;

// --- Chat ------------------------------------------------------------------

/**
 * `visibility` é o modo de rolagem atual do autor e só vale para rolagens
 * (texto é sempre público). "/gmr" e "/pr" no texto forçam secreta/pública.
 */
export const ChatSendSchema = z.object({
  text: z.string().trim().min(1).max(2000),
  visibility: RollVisibilitySchema.default("all"),
});
export type ChatSendPayload = z.infer<typeof ChatSendSchema>;

/** GM torna pública uma mensagem secreta/própria. */
export const ChatRevealSchema = z.object({ messageId: IdSchema });
export type ChatRevealPayload = z.infer<typeof ChatRevealSchema>;

/** Payload vazio (combat:next/prev). */
export const EmptySchema = z.object({}).strict();

// --- Combate -----------------------------------------------------------

const TokenIdListSchema = z.array(IdSchema).min(1).max(100);

/** GM seleciona tokens e inicia o combate na cena ativa. Substitui um combate anterior da cena, se houver. */
export const CombatStartSchema = z.object({ sceneId: IdSchema, tokenIds: TokenIdListSchema });
export type CombatStartPayload = z.infer<typeof CombatStartSchema>;

/** Reforços: entram sem iniciativa, no fim da ordem. Token já no combate é ignorado. */
export const CombatAddSchema = z.object({ tokenIds: TokenIdListSchema });
export type CombatAddPayload = z.infer<typeof CombatAddSchema>;

export const CombatRemoveSchema = z.object({ combatantIds: z.array(IdSchema).min(1).max(100) });
export type CombatRemovePayload = z.infer<typeof CombatRemoveSchema>;

/**
 * `self` = os combatentes do autor que ainda não rolaram; `one` = um específico
 * (`combatantId` obrigatório); `npcs` = os sem dono que faltam (GM); `missing` = todos
 * que faltam (GM). `visibility` = modo de rolagem de quem clicou (ausente = "all").
 */
export const CombatRollSchema = z
  .object({
    scope: z.enum(["self", "one", "npcs", "missing"]),
    combatantId: IdSchema.optional(),
    visibility: RollVisibilitySchema.optional(),
  })
  .refine((v) => v.scope !== "one" || v.combatantId !== undefined, { message: "scope 'one' exige combatantId" });
export type CombatRollPayload = z.infer<typeof CombatRollSchema>;

/** Valor digitado à mão pelo GM. `initiative: null` volta para "não rolou". */
export const CombatSetInitiativeSchema = z.object({
  combatantId: IdSchema,
  initiative: z.number().nullable(),
  bonus: z.number().optional(),
});
export type CombatSetInitiativePayload = z.infer<typeof CombatSetInitiativeSchema>;

export const CombatSetSurprisedSchema = z.object({ combatantId: IdSchema, surprised: z.boolean() });
export type CombatSetSurprisedPayload = z.infer<typeof CombatSetSurprisedSchema>;

/** Nova ordem manual completa (arrastar na lista): grava `order` na sequência recebida. */
export const CombatReorderSchema = z.object({ combatantIds: z.array(IdSchema).min(1).max(100) });
export type CombatReorderPayload = z.infer<typeof CombatReorderSchema>;

export const CombatDelaySchema = z.object({ combatantId: IdSchema });
export type CombatDelayPayload = z.infer<typeof CombatDelaySchema>;

export const CombatResumeSchema = z.object({ combatantId: IdSchema });
export type CombatResumePayload = z.infer<typeof CombatResumeSchema>;

/** `clear` ausente/false: encerra mas mantém a ordem visível. `clear: true`: apaga o combate. */
export const CombatEndSchema = z.object({ clear: z.boolean().default(false) });
export type CombatEndPayload = z.infer<typeof CombatEndSchema>;
