import { z } from "zod";
import { IdSchema } from "./common.js";

export const TokenSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  name: z.string().min(1).max(64),
  /** URL da imagem do token; null = desenha um círculo com a inicial do nome. */
  imageUrl: z.string().nullable(),
  /** Posição do canto superior esquerdo, em pixels do mapa. */
  x: z.number(),
  y: z.number(),
  /** Tamanho em pixels do mapa (um token 1x1 no grid = cellSize x cellSize). */
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().default(0),
  /** Ordem de desenho: maior = por cima. */
  zIndex: z.number().int().default(0),
  /** Se false, só o GM vê. */
  visible: z.boolean().default(true),
  /** Participante que "controla" o token (pode arrastar). null = só o GM. */
  ownerId: IdSchema.nullable(),
  color: z.string().default("#e11d48"),
});
export type Token = z.infer<typeof TokenSchema>;

/** Payload de criação: servidor gera o id. */
export const TokenCreateSchema = TokenSchema.omit({ id: true });
export type TokenCreate = z.infer<typeof TokenCreateSchema>;

/** Atualização parcial (arrastar manda só x/y; redimensionar manda width/height). */
export const TokenPatchSchema = TokenSchema.partial().required({ id: true });
export type TokenPatch = z.infer<typeof TokenPatchSchema>;
