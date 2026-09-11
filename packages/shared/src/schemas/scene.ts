import { z } from "zod";
import { IdSchema } from "./common.js";
import { FogConfigSchema } from "./fog.js";
import { CombatStatusSchema } from "./combat.js";

export const GridTypeSchema = z.enum(["square", "none"]);

export const GridConfigSchema = z.object({
  type: GridTypeSchema.default("square"),
  /**
   * Tamanho da célula em pixels da imagem do mapa. Decimal (não `.int()`): a calibração pela
   * imagem (docs/plano-grid.md, Parte B) quase nunca acerta um inteiro exato — um mapa de 2048px
   * com 28 células dá 73,14. Inteiro continua válido (nenhum grid existente quebra).
   */
  cellSize: z.number().min(8).max(1000).default(70),
  /** Deslocamento do grid em relação ao canto superior esquerdo da imagem. Decimal pelo mesmo
   *  motivo de `cellSize` acima. */
  offsetX: z.number().default(0),
  offsetY: z.number().default(0),
  color: z.string().default("#00000055"),
  /** Se true, tokens "grudam" nas células ao soltar. */
  snap: z.boolean().default(true),
});
export type GridConfig = z.infer<typeof GridConfigSchema>;

/**
 * Tamanho (pixels) usado quando a cena ainda não tem mapa (`mapWidth`/`mapHeight` null) — tanto pra
 * desenhar um retângulo vazio no cliente quanto pros cálculos de posicionamento do servidor
 * (compendium:spawn-creature). Um só valor pros dois lados: usar fallbacks diferentes faria o
 * cliente e o servidor discordarem de onde cabe um token.
 */
export const DEFAULT_MAP_SIZE = { width: 1600, height: 1100 };

/** Ponto de chegada de "Levar para o mapa" (docs/plano-mapas.md §9), em pixels do mapa de destino. */
export const ArrivalPointSchema = z.object({ x: z.number(), y: z.number() });
export type ArrivalPoint = z.infer<typeof ArrivalPointSchema>;

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
  /** Ordem no painel "Mapas" (arrastar reordena, `scene:reorder`). Renumerado 0..n-1 a cada reorder. */
  order: z.number().int().default(0),
  /** Onde tokens levados de outro mapa aparecem ao ativar (espiral a partir daí). null = sem marcador. */
  arrival: ArrivalPointSchema.nullable().default(null),
  createdAt: z.string().datetime(),
});
export type Scene = z.infer<typeof SceneSchema>;

/**
 * Item de lista do painel "Mapas" (docs/plano-mapas.md §3): dados que o cliente não tem porque
 * nunca carregou os tokens/combate daquele mapa (só o GM entra em mapa que não é o ativo,
 * `scene:enter`). Calculado sob demanda (`scene:list`), não desnormalizado em `Scene`.
 */
export const SceneListItemSchema = z.object({
  sceneId: IdSchema,
  /** Tokens não apagados do mapa. */
  tokenCount: z.number().int(),
  /** Tokens com `ownerId != null` (o "pede confirmação" de apagar mapa). */
  playerTokenCount: z.number().int(),
  /** null = sem combate no mapa. */
  combatStatus: CombatStatusSchema.nullable(),
});
export type SceneListItem = z.infer<typeof SceneListItemSchema>;
