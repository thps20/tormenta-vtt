import { z } from "zod";

/** IDs são strings (cuid/uuid geradas no servidor). */
export const IdSchema = z.string().min(1);
export type Id = z.infer<typeof IdSchema>;

/** Posição em pixels no canvas (não em células do grid). */
export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export type Position = z.infer<typeof PositionSchema>;

export const SizeSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});
export type Size = z.infer<typeof SizeSchema>;
