import { z } from "zod";
import { IdSchema } from "./common.js";

/**
 * Fog of war manual (fase 2). Toda geometria está em pixels do mapa, como os tokens.
 * A área visível é a composição em ordem das shapes: `reveal` abre, `hide` fecha.
 * Ver `fog/visibility.ts` para a regra de "ponto revelado".
 */

export const FogShapeModeSchema = z.enum(["reveal", "hide"]);
export type FogShapeMode = z.infer<typeof FogShapeModeSchema>;

/** Limite de pontos por shape: pincel e polígono já chegam decimados do cliente; isso só barra abuso. */
export const FOG_MAX_POINTS_PER_SHAPE = 2000;

/** Lista achatada [x1, y1, x2, y2, ...]: metade do tamanho de uma lista de objetos no JSON do banco. */
const PointsSchema = (minPoints: number) =>
  z
    .array(z.number().finite())
    .min(minPoints * 2)
    .max(FOG_MAX_POINTS_PER_SHAPE * 2)
    .refine((p) => p.length % 2 === 0, "lista de pontos precisa ter tamanho par");

const ShapeBase = z.object({ id: IdSchema, mode: FogShapeModeSchema });

export const FogShapeSchema = z.discriminatedUnion("kind", [
  /** Clique único do pincel. */
  ShapeBase.extend({ kind: z.literal("circle"), cx: z.number().finite(), cy: z.number().finite(), r: z.number().positive() }),
  ShapeBase.extend({
    kind: z.literal("rect"),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  /** Polígono fechado (o último vértice liga ao primeiro). Mínimo 3 vértices. */
  ShapeBase.extend({ kind: z.literal("polygon"), points: PointsSchema(3) }),
  /** Arrasto do pincel: polilinha com largura (pontas e junções redondas). Um arrasto = uma shape. */
  ShapeBase.extend({ kind: z.literal("stroke"), points: PointsSchema(2), width: z.number().positive() }),
]);
export type FogShape = z.infer<typeof FogShapeSchema>;
export type FogShapeKind = FogShape["kind"];

export const FogBaseSchema = z.enum(["hidden", "revealed"]);

export const FogConfigSchema = z.object({
  /** Desligado: nada é desenhado e as shapes ficam guardadas para quando religar. */
  enabled: z.boolean().default(false),
  /** Estado de partida antes das shapes. "Revelar tudo"/"Ocultar tudo" limpam a lista e setam isto. */
  base: FogBaseSchema.default("hidden"),
  shapes: z.array(FogShapeSchema).default([]),
});
export type FogConfig = z.infer<typeof FogConfigSchema>;

/**
 * Limite prático de shapes por cena (decisão documentada no SPEC, "Fase 2"):
 * acima de WARN o cliente avisa o GM; acima de MAX o servidor recusa `add`.
 * Não mesclamos geometria automaticamente: um arrasto do pincel já é uma shape só
 * e "Revelar/Ocultar tudo" zera a lista, o que cobre o uso real.
 */
export const FOG_SHAPES_WARN = 400;
export const FOG_SHAPES_MAX = 500;
