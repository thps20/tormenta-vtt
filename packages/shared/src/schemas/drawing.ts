import { z } from "zod";
import { IdSchema } from "./common.js";
import { HexColorSchema } from "./system.js";

/**
 * Desenho livre no mapa (SPEC §9.17): traços persistidos por MAPA (diferente dos gabaritos, que são
 * efêmeros — `schemas/template.ts`), um por linha do banco, editáveis/apagáveis individualmente.
 * Geometria em pixels do mapa, como token/gabarito/pino. `kind` discrimina a forma:
 * - "pen": polilinha à mão livre (pincel).
 * - "line"/"arrow": segmento reto, com ou sem cabeça de seta.
 * - "rect"/"ellipse": formas fechadas, com preenchimento opcional.
 * - "text": rótulo de texto solto no mapa.
 * `ownerId` é sempre travado no servidor (nunca confiado do payload — mesmo princípio de
 * `Template.ownerId`): jogador move/apaga só os seus, GM edita/apaga qualquer um.
 */

/** Espessura do traço (pen/line/rect/ellipse/arrow) OU tamanho da fonte (text) — mesmo controle
 *  (slider único na sub-barra) reaproveitado pros dois sentidos, pra não abrir um segundo campo. */
export const DRAWING_MIN_STROKE_WIDTH = 1;
export const DRAWING_MAX_STROKE_WIDTH = 20;

/** Pontos da caneta já chegam decimados (ao vivo) e suavizados (`smoothPenPoints`, rules/drawing.ts)
 *  do cliente; isto só barra abuso, mesmo espírito de `FOG_MAX_POINTS_PER_SHAPE`. */
export const DRAWING_MAX_POINTS_PER_STROKE = 2000;

/** Lista achatada [x1, y1, x2, y2, ...], mesmo formato de `FogShape` "stroke". */
const PenPointsSchema = z
  .array(z.number().finite())
  .min(4)
  .max(DRAWING_MAX_POINTS_PER_STROKE * 2)
  .refine((p) => p.length % 2 === 0, "lista de pontos precisa ter tamanho par");

const StrokeWidthSchema = z.number().min(DRAWING_MIN_STROKE_WIDTH).max(DRAWING_MAX_STROKE_WIDTH);

const DrawingBaseSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  /** Quem criou (sempre o participantId de quem chamou drawing:create, nunca confiado do payload). */
  ownerId: IdSchema,
  color: HexColorSchema,
  strokeWidth: StrokeWidthSchema,
  /** GM decide: "todos" (true, padrão) ou "só GM" (false) — pra marcar coisas na preparação. Traço
   *  de jogador é sempre `true`: o servidor ignora o que vier no payload dele. */
  visible: z.boolean(),
});

export const DrawingSchema = z.discriminatedUnion("kind", [
  DrawingBaseSchema.extend({ kind: z.literal("pen"), points: PenPointsSchema }),
  DrawingBaseSchema.extend({
    kind: z.literal("line"),
    x1: z.number().finite(),
    y1: z.number().finite(),
    x2: z.number().finite(),
    y2: z.number().finite(),
  }),
  DrawingBaseSchema.extend({
    kind: z.literal("arrow"),
    x1: z.number().finite(),
    y1: z.number().finite(),
    x2: z.number().finite(),
    y2: z.number().finite(),
  }),
  DrawingBaseSchema.extend({
    kind: z.literal("rect"),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().positive(),
    height: z.number().positive(),
    filled: z.boolean().default(false),
  }),
  DrawingBaseSchema.extend({
    kind: z.literal("ellipse"),
    cx: z.number().finite(),
    cy: z.number().finite(),
    rx: z.number().positive(),
    ry: z.number().positive(),
    filled: z.boolean().default(false),
  }),
  DrawingBaseSchema.extend({
    kind: z.literal("text"),
    x: z.number().finite(),
    y: z.number().finite(),
    text: z.string().trim().min(1).max(500),
  }),
]);
export type Drawing = z.infer<typeof DrawingSchema>;
export type DrawingKind = Drawing["kind"];

/** `drawing:create`: `id`/`ownerId` do payload nunca são confiados (o servidor sempre fixa
 *  `ownerId = ctx.participantId`, e `visible = true` quando quem cria é jogador). */
export const DrawingCreateSchema = z.object({ sceneId: IdSchema, drawing: DrawingSchema });
export type DrawingCreatePayload = z.infer<typeof DrawingCreateSchema>;

/**
 * `drawing:update`: mover/redimensionar/reeditar texto/trocar cor-espessura-preenchimento, ou (só
 * GM) alternar visibilidade. `live` marca eco de arraste/redimensionamento em andamento (mesmo
 * papel de `TemplateUpsertSchema.live`) — nunca empilha no desfazer, só o commit final do gesto.
 */
export const DrawingPatchSchema = z.object({
  sceneId: IdSchema,
  drawingId: IdSchema,
  patch: z.object({
    points: PenPointsSchema.optional(),
    x1: z.number().finite().optional(),
    y1: z.number().finite().optional(),
    x2: z.number().finite().optional(),
    y2: z.number().finite().optional(),
    x: z.number().finite().optional(),
    y: z.number().finite().optional(),
    width: z.number().positive().optional(),
    height: z.number().positive().optional(),
    cx: z.number().finite().optional(),
    cy: z.number().finite().optional(),
    rx: z.number().positive().optional(),
    ry: z.number().positive().optional(),
    text: z.string().trim().min(1).max(500).optional(),
    color: HexColorSchema.optional(),
    strokeWidth: StrokeWidthSchema.optional(),
    filled: z.boolean().optional(),
    /** Só o GM pode setar: o servidor recusa o patch se um jogador tentar mudar isto. */
    visible: z.boolean().optional(),
  }),
  live: z.boolean().optional(),
});
export type DrawingPatchPayload = z.infer<typeof DrawingPatchSchema>;

export const DrawingRemoveSchema = z.object({ sceneId: IdSchema, drawingId: IdSchema });
export type DrawingRemovePayload = z.infer<typeof DrawingRemoveSchema>;

/** "Limpar meus desenhos" (qualquer role, só os próprios) / "Limpar tudo" (GM, `gmOnly`). */
export const DrawingClearMineSchema = z.object({ sceneId: IdSchema });
export type DrawingClearMinePayload = z.infer<typeof DrawingClearMineSchema>;

export const DrawingClearAllSchema = z.object({ sceneId: IdSchema });
export type DrawingClearAllPayload = z.infer<typeof DrawingClearAllSchema>;

/** "Jogadores podem desenhar" (GM, por SALA — mesmo padrão de `CombatSetMovementLimitSchema`). */
export const DrawingSetPlayerPermissionSchema = z.object({ enabled: z.boolean() });
export type DrawingSetPlayerPermissionPayload = z.infer<typeof DrawingSetPlayerPermissionSchema>;

/** Guarda-corpo por mapa (mesmo espírito de `FOG_SHAPES_WARN`/`MAX`, mais conservador porque aqui
 *  cada traço é uma LINHA de banco, não um item de array JSON): acima de WARN o cliente avisa o GM;
 *  acima de MAX o servidor recusa `drawing:create`. */
export const DRAWING_WARN_PER_SCENE = 300;
export const DRAWING_MAX_PER_SCENE = 400;
