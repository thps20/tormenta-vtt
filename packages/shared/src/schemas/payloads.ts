import { z } from "zod";
import { IdSchema } from "./common.js";
import { ArrivalPointSchema, GridConfigSchema } from "./scene.js";
import { FogShapeSchema } from "./fog.js";
import { CharacterDataSchema, CharacterKindSchema, CharacterRollRequestSchema, EnhancementUseSchema } from "./character.js";
import { CompendiumIdSchema } from "./compendium.js";
import { RollVisibilitySchema } from "./dice.js";
import { TokenPatchSchema } from "./token.js";

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

// --- Cena / mapas (docs/plano-mapas.md) -------------------------------------

/**
 * `mapUrl`/`mapWidth`/`mapHeight` opcionais: "criar por upload" vira uma chamada só (em vez de
 * `create` + `setMap`, que deixaria um mapa vazio piscando na lista). Ausentes = mapa sem imagem.
 */
export const SceneCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  mapUrl: z.string().min(1).nullable().optional(),
  mapWidth: z.number().int().positive().nullable().optional(),
  mapHeight: z.number().int().positive().nullable().optional(),
});
export type SceneCreatePayload = z.infer<typeof SceneCreateSchema>;

/**
 * `moveTokenIds`/`dropPoint`: diálogo "Levar para o mapa" (docs/plano-mapas.md §8). Tokens do mapa
 * ATIVO ATUAL escolhidos pelo GM pra levar junto; `dropPoint` é só uma sugestão de onde a espiral de
 * posicionamento começa no destino (o servidor sempre recalcula, nunca confia no cliente).
 */
export const SceneActivateSchema = z.object({
  sceneId: IdSchema,
  moveTokenIds: z.array(IdSchema).max(200).optional(),
  dropPoint: ArrivalPointSchema.optional(),
});
export type SceneActivatePayload = z.infer<typeof SceneActivateSchema>;

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

/** Navegar (GM, qualquer mapa) ou seguir o ativo (jogador, só o ativo) sem os efeitos de `room:join`. */
export const SceneEnterSchema = z.object({ sceneId: IdSchema });
export type SceneEnterPayload = z.infer<typeof SceneEnterSchema>;

export const SceneRenameSchema = z.object({ sceneId: IdSchema, name: z.string().trim().min(1).max(80) });
export type SceneRenamePayload = z.infer<typeof SceneRenameSchema>;

/** `name` ausente: o servidor gera com `duplicateSceneName` (rules/scenes.ts). */
export const SceneDuplicateSchema = z.object({ sceneId: IdSchema, name: z.string().trim().min(1).max(80).optional() });
export type SceneDuplicatePayload = z.infer<typeof SceneDuplicateSchema>;

/**
 * Apagar mapa (docs/plano-mapas.md §10). Sem `confirmMovePlayerTokens`, um mapa com token de
 * jogador só devolve `{ status: "needs-confirm", ... }` (ver SceneDeleteResultSchema) — nada é
 * apagado ainda. Reenviar com `true` confirma e move os tokens de jogador pro mapa ativo antes de
 * apagar.
 */
export const SceneDeleteSchema = z.object({ sceneId: IdSchema, confirmMovePlayerTokens: z.boolean().optional() });
export type SceneDeletePayload = z.infer<typeof SceneDeleteSchema>;

export const SceneDeleteResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("deleted") }),
  /** Nada foi apagado ainda: a UI pergunta e reenvia com `confirmMovePlayerTokens: true`. */
  z.object({ status: z.literal("needs-confirm"), playerTokenIds: z.array(IdSchema) }),
]);
export type SceneDeleteResult = z.infer<typeof SceneDeleteResultSchema>;

/** Nova ordem manual completa (arrastar no painel "Mapas"): mesmo contrato de `combat:reorder`. */
export const SceneReorderSchema = z.object({ sceneIds: z.array(IdSchema).min(1).max(200) });
export type SceneReorderPayload = z.infer<typeof SceneReorderSchema>;

export const SceneSetArrivalSchema = z.object({ sceneId: IdSchema, arrival: ArrivalPointSchema.nullable() });
export type SceneSetArrivalPayload = z.infer<typeof SceneSetArrivalSchema>;

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

/** Apaga vários tokens de uma vez, tudo-ou-nada (mesmo molde de TokenApplyDamageSchema abaixo) —
 *  usado pelo Delete/Backspace em lote e pelo NpcQuickCard, para virar UMA entrada de histórico
 *  em vez de uma por token (docs/plano-desfazer.md §2). */
export const TokenDeleteManySchema = z.object({ tokenIds: z.array(IdSchema).min(1).max(100) });
export type TokenDeleteManyPayload = z.infer<typeof TokenDeleteManySchema>;

/** Atualiza vários tokens de uma vez, tudo-ou-nada — hoje só o arraste em grupo usa (soltar vários
 *  tokens selecionados vira UMA entrada de histórico, docs/plano-desfazer.md §3). */
export const TokenUpdateManySchema = z.object({ patches: z.array(TokenPatchSchema).min(1).max(100) });
export type TokenUpdateManyPayload = z.infer<typeof TokenUpdateManySchema>;
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
// Todo payload ganhou `sceneId` (docs/plano-mapas.md §7): combate deixou de exigir "cena ativa" —
// dois mapas podem ter combate ao mesmo tempo, então o cliente precisa dizer qual mapa quer dizer
// (o mapa que está vendo). Permissão de jogador: só vale no mapa ATIVO da sala (ver §11 do plano).

const TokenIdListSchema = z.array(IdSchema).min(1).max(100);

/** GM seleciona tokens e inicia o combate no mapa indicado. Substitui um combate anterior dele, se houver. */
export const CombatStartSchema = z.object({ sceneId: IdSchema, tokenIds: TokenIdListSchema });
export type CombatStartPayload = z.infer<typeof CombatStartSchema>;

/** `combat:next`/`combat:prev`: payload é só o mapa (não há mais "a cena ativa da sala"). */
export const CombatSceneSchema = z.object({ sceneId: IdSchema });
export type CombatScenePayload = z.infer<typeof CombatSceneSchema>;

/** Reforços: entram sem iniciativa, no fim da ordem. Token já no combate é ignorado. */
export const CombatAddSchema = z.object({ sceneId: IdSchema, tokenIds: TokenIdListSchema });
export type CombatAddPayload = z.infer<typeof CombatAddSchema>;

export const CombatRemoveSchema = z.object({ sceneId: IdSchema, combatantIds: z.array(IdSchema).min(1).max(100) });
export type CombatRemovePayload = z.infer<typeof CombatRemoveSchema>;

/**
 * `self` = os combatentes do autor que ainda não rolaram; `one` = um específico
 * (`combatantId` obrigatório); `npcs` = os sem dono que faltam (GM); `missing` = todos
 * que faltam (GM). `visibility` = modo de rolagem de quem clicou (ausente = "all").
 */
export const CombatRollSchema = z
  .object({
    sceneId: IdSchema,
    scope: z.enum(["self", "one", "npcs", "missing"]),
    combatantId: IdSchema.optional(),
    visibility: RollVisibilitySchema.optional(),
  })
  .refine((v) => v.scope !== "one" || v.combatantId !== undefined, { message: "scope 'one' exige combatantId" });
export type CombatRollPayload = z.infer<typeof CombatRollSchema>;

/** Valor digitado à mão pelo GM. `initiative: null` volta para "não rolou". */
export const CombatSetInitiativeSchema = z.object({
  sceneId: IdSchema,
  combatantId: IdSchema,
  initiative: z.number().nullable(),
  bonus: z.number().optional(),
});
export type CombatSetInitiativePayload = z.infer<typeof CombatSetInitiativeSchema>;

export const CombatSetSurprisedSchema = z.object({ sceneId: IdSchema, combatantId: IdSchema, surprised: z.boolean() });
export type CombatSetSurprisedPayload = z.infer<typeof CombatSetSurprisedSchema>;

/** Nova ordem manual completa (arrastar na lista): grava `order` na sequência recebida. */
export const CombatReorderSchema = z.object({ sceneId: IdSchema, combatantIds: z.array(IdSchema).min(1).max(100) });
export type CombatReorderPayload = z.infer<typeof CombatReorderSchema>;

export const CombatDelaySchema = z.object({ sceneId: IdSchema, combatantId: IdSchema });
export type CombatDelayPayload = z.infer<typeof CombatDelaySchema>;

export const CombatResumeSchema = z.object({ sceneId: IdSchema, combatantId: IdSchema });
export type CombatResumePayload = z.infer<typeof CombatResumeSchema>;

/** `clear` ausente/false: encerra mas mantém a ordem visível. `clear: true`: apaga o combate. */
export const CombatEndSchema = z.object({ sceneId: IdSchema, clear: z.boolean().default(false) });
export type CombatEndPayload = z.infer<typeof CombatEndSchema>;

// --- Orçamento de deslocamento por turno (docs/plano-movimento.md) ---------

/**
 * Ajuste manual do GM no orçamento/gasto de deslocamento de um combatente. `budget: null` volta a
 * seguir a ficha (override removido); `budget` ausente não mexe no orçamento atual. `used: 0` é o
 * botão "zerar gasto" do painel — reinicia também a âncora e o caminho desenhado (servidor).
 */
export const CombatSetMovementSchema = z.object({
  sceneId: IdSchema,
  combatantId: IdSchema,
  budget: z.number().nonnegative().nullable().optional(),
  used: z.number().min(0).optional(),
});
export type CombatSetMovementPayload = z.infer<typeof CombatSetMovementSchema>;

/** Liga/desliga a trava de orçamento de deslocamento NA SALA (memória, não vai ao banco — GM only). */
export const CombatSetMovementLimitSchema = z.object({ enabled: z.boolean() });
export type CombatSetMovementLimitPayload = z.infer<typeof CombatSetMovementLimitSchema>;

// --- Compêndio: soltar criatura no mapa (docs/plano-criaturas.md) ----------

/**
 * Solta `count` cópias de uma criatura do compêndio na cena (GM). `x`/`y` são o ponto de soltura
 * em PIXELS DO MAPA (o centro da célula sob o cursor, ou o centro da área visível no Enter do
 * preview); o servidor converte em célula e roda a mesma espiral do fantasma no cliente
 * (findFreeCells), então onde o GM vê o fantasma é onde os tokens caem.
 */
export const CompendiumSpawnCreatureSchema = z.object({
  sceneId: IdSchema,
  entryId: CompendiumIdSchema,
  count: z.number().int().min(1).max(20),
  /** Toggle "invisível ao soltar" do preview (true = visible). */
  visible: z.boolean(),
  x: z.number().finite(),
  y: z.number().finite(),
});
export type CompendiumSpawnCreaturePayload = z.infer<typeof CompendiumSpawnCreatureSchema>;
