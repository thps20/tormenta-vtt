import { z } from "zod";
import { IdSchema } from "./common.js";
import { FogConfigSchema } from "./fog.js";

export const GridTypeSchema = z.enum(["square", "none"]);

export const GridConfigSchema = z.object({
  type: GridTypeSchema.default("square"),
  /** Tamanho da célula em pixels da imagem do mapa. */
  cellSize: z.number().int().min(8).max(1000).default(70),
  /** Deslocamento do grid em relação ao canto superior esquerdo da imagem. */
  offsetX: z.number().int().default(0),
  offsetY: z.number().int().default(0),
  color: z.string().default("#00000055"),
  /** Se true, tokens "grudam" nas células ao soltar. */
  snap: z.boolean().default(true),
});
export type GridConfig = z.infer<typeof GridConfigSchema>;

export const SceneSchema = z.object({
  id: IdSchema,
  roomId: IdSchema,
  name: z.string().min(1).max(80),
  /** URL servida pelo servidor (ex.: /uploads/<file>.png). null = sem mapa ainda. */
  mapUrl: z.string().nullable(),
  mapWidth: z.number().int().positive().nullable(),
  mapHeight: z.number().int().positive().nullable(),
  grid: GridConfigSchema,
  /** Névoa manual (fase 2). JSON no banco, como `grid`. */
  fog: FogConfigSchema,
});
export type Scene = z.infer<typeof SceneSchema>;
