import { z } from "zod";
import { IdSchema } from "./common.js";
import { ItemCardSchema } from "./character.js";
import { KeySchema } from "./system.js";

/**
 * Resultado de um único grupo de dados dentro da fórmula.
 * Ex.: em "2d6+3", o grupo é { count: 2, sides: 6, rolls: [4, 1] }.
 */
export const DiceGroupResultSchema = z.object({
  count: z.number().int().positive(),
  sides: z.number().int().positive(),
  rolls: z.array(z.number().int().positive()),
  /** Rolagens descartadas por modificadores (ex.: kh1 = keep highest). */
  dropped: z.array(z.number().int().positive()).default([]),
  subtotal: z.number().int(),
});
export type DiceGroupResult = z.infer<typeof DiceGroupResultSchema>;

/** Uma parcela de dano já rolada. */
export const DamageRollComponentSchema = z.object({
  damageType: KeySchema.nullable(),
  formula: z.string().min(1).max(200),
  groups: z.array(DiceGroupResultSchema),
  modifier: z.number().int(),
  total: z.number().int(),
});
export type DamageRollComponent = z.infer<typeof DamageRollComponentSchema>;

export const DiceRollSchema = z.object({
  id: IdSchema,
  roomId: IdSchema,
  /** Quem rolou. */
  participantId: IdSchema,
  nickname: z.string(),
  /** Fórmula rolada (normalizada), ex.: "1d20+5"; dano com várias parcelas junta todas ("6d6 + 1 + 4d6"). */
  formula: z.string().min(1).max(600),
  /** Rótulo opcional, ex.: "Ataque com espada". */
  label: z.string().max(80).optional(),
  groups: z.array(DiceGroupResultSchema),
  /** Modificador fixo total (ex.: +3). */
  modifier: z.number().int(),
  total: z.number().int(),
  /** true = só GM e quem rolou veem o resultado. */
  secret: z.boolean().default(false),
  /** Rolagem feita a partir de uma ficha. */
  characterId: IdSchema.optional(),
  /** Resultado natural do dado a partir do qual é crítico (ataques com margem ampliada). Ausente = máximo do dado. */
  critThreshold: z.number().int().optional(),
  /**
   * Rolagem de dano da ficha: uma parcela por tipo de dano, cada uma rolada em separado
   * (groups/modifier/total acima são a junção). A UI mostra "21 (7 fogo + 14 frio)".
   * Ausente = rolagem sem tipo (teste, ataque, /r).
   */
  damage: z.array(DamageRollComponentSchema).optional(),
  createdAt: z.string().datetime(),
});
export type DiceRoll = z.infer<typeof DiceRollSchema>;

export const ChatMessageSchema = z.object({
  id: IdSchema,
  roomId: IdSchema,
  participantId: IdSchema,
  nickname: z.string(),
  /** Texto puro, rolagem, aviso do sistema ou card de item usado (character:use-item). */
  kind: z.enum(["text", "roll", "system", "item"]),
  text: z.string().max(2000).optional(),
  roll: DiceRollSchema.optional(),
  item: ItemCardSchema.optional(),
  createdAt: z.string().datetime(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
