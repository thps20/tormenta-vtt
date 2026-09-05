import { z } from "zod";
import { IdSchema } from "./common.js";

export const InitiativeEntrySchema = z.object({
  id: IdSchema,
  /** Token associado (opcional: pode ser uma entrada manual, ex.: "Armadilha"). */
  tokenId: IdSchema.nullable(),
  name: z.string().min(1).max(64),
  /** Valor da iniciativa; maior age primeiro. */
  value: z.number(),
  /** Desempate: maior primeiro. */
  tiebreak: z.number().default(0),
  visible: z.boolean().default(true),
});
export type InitiativeEntry = z.infer<typeof InitiativeEntrySchema>;

export const InitiativeStateSchema = z.object({
  roomId: IdSchema,
  entries: z.array(InitiativeEntrySchema),
  /** Índice (na lista já ordenada) de quem está agindo. null = combate não iniciado. */
  currentIndex: z.number().int().min(0).nullable(),
  round: z.number().int().min(0).default(0),
});
export type InitiativeState = z.infer<typeof InitiativeStateSchema>;
