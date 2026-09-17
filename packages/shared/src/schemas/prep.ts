import { z } from "zod";
import { IdSchema } from "./common.js";
import { CompendiumIdSchema } from "./compendium.js";

/**
 * Preparo do mapa (docs/plano-preparo.md §2): lista ordenada de passos por mapa; cada item de um
 * passo APONTA pra algo que já existe (acervo, handout, encontro, criatura, macro, pino, ficha de
 * NPC) ou é um lembrete solto sem referência nenhuma (`note`). Nunca reimplementa uma ação: soltar
 * um encontro, mostrar um handout etc. usam os MESMOS eventos que o botão manual já usa — o
 * preparo só guarda "o que apontar" e "com que opção", igual às macros (schemas/macro.ts).
 */
export const PrepRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("asset"), assetId: IdSchema }),
  z.object({ kind: z.literal("handout"), handoutId: IdSchema }),
  z.object({ kind: z.literal("encounter"), encounterId: IdSchema }),
  z.object({ kind: z.literal("creature"), entryId: CompendiumIdSchema }),
  z.object({ kind: z.literal("macro"), macroId: IdSchema }),
  z.object({ kind: z.literal("pin"), pinId: IdSchema }),
  z.object({ kind: z.literal("npc"), characterId: IdSchema }),
  /** Único item que não aponta pra nada: lembrete solto, escrito direto no passo. */
  z.object({ kind: z.literal("note"), text: z.string().trim().min(1).max(2000) }),
]);
export type PrepRef = z.infer<typeof PrepRefSchema>;
export type PrepRefKind = PrepRef["kind"];

/** Só os campos que fazem sentido pro tipo do item são usados; o resto é ignorado pelo cliente
 *  (§2.1) — por isso tudo aqui é opcional em vez de discriminado por `ref.kind`. */
export const PrepItemOptionsSchema = z
  .object({
    /** Encontro/criatura: soltar invisível. */
    hidden: z.boolean().optional(),
    /** Criatura: quantas cópias. */
    count: z.number().int().min(1).max(20).optional(),
    /** Áudio: "loop" (trilha, padrão) ou "once" (efeito). */
    audioMode: z.enum(["loop", "once"]).optional(),
    /** Handout: só "todos" nesta versão (§6, fora de escopo "mostrar para X" pelo preparo). */
    showTo: z.literal("all").optional(),
  })
  .default({});
export type PrepItemOptions = z.infer<typeof PrepItemOptionsSchema>;

/** Item de um passo. `label` é uma cópia do nome tirada no momento de adicionar (§2.6): só serve
 *  pra continuar mostrando um nome quando a referência quebra (o acervo/handout/etc. some) —
 *  NUNCA é usado pra executar a ação, que sempre resolve `ref` contra os dados atuais. */
export const PrepItemSchema = z.object({
  id: IdSchema,
  ref: PrepRefSchema,
  label: z.string().min(1).max(80),
  used: z.boolean().default(false),
  /** Entra no "Iniciar este passo" (§2.3). */
  auto: z.boolean().default(false),
  options: PrepItemOptionsSchema,
});
export type PrepItem = z.infer<typeof PrepItemSchema>;

const PrepStepTitleSchema = z.string().trim().min(1).max(80);
/** Markdown leve (§2.5): negrito/itálico/título/listas/citação, sem HTML — ver `rules/lightMarkdown.ts`. */
const PrepStepNotesSchema = z.string().max(20_000).default("");

/** Passo do preparo, já serializado (o que sai pro cliente). No banco `items` é uma coluna `Json`
 *  (§2.1 do plano explica o porquê); aqui é tipado de verdade. */
export const PrepStepSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  order: z.number().int().min(0),
  title: PrepStepTitleSchema,
  notes: PrepStepNotesSchema,
  items: z.array(PrepItemSchema).max(50),
  used: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PrepStep = z.infer<typeof PrepStepSchema>;

// --- Eventos (todos gmOnly, §2.4) ---------------------------------------------------------------

export const PrepListSchema = z.object({ sceneId: IdSchema });
export type PrepListPayload = z.infer<typeof PrepListSchema>;

export const PrepStepCreateSchema = z.object({ sceneId: IdSchema, title: PrepStepTitleSchema, afterStepId: IdSchema.optional() });
export type PrepStepCreatePayload = z.infer<typeof PrepStepCreateSchema>;

export const PrepStepPatchSchema = z.object({
  title: PrepStepTitleSchema.optional(),
  notes: PrepStepNotesSchema.optional(),
  used: z.boolean().optional(),
});
export type PrepStepPatch = z.infer<typeof PrepStepPatchSchema>;
export const PrepStepUpdateSchema = z.object({ stepId: IdSchema, patch: PrepStepPatchSchema });
export type PrepStepUpdatePayload = z.infer<typeof PrepStepUpdateSchema>;

export const PrepStepDeleteSchema = z.object({ stepId: IdSchema });
export type PrepStepDeletePayload = z.infer<typeof PrepStepDeleteSchema>;

/** Nova ordem completa dos passos do mapa (arrastar): permutação exata, mesmo padrão de `scene:reorder`. */
export const PrepStepReorderSchema = z.object({ sceneId: IdSchema, stepIds: z.array(IdSchema).max(200) });
export type PrepStepReorderPayload = z.infer<typeof PrepStepReorderSchema>;

/** Mesmo mapa = duplicar (entra logo depois do original); outro mapa = copiar pro fim de lá (§2.4). */
export const PrepStepCopySchema = z.object({ stepId: IdSchema, targetSceneId: IdSchema });
export type PrepStepCopyPayload = z.infer<typeof PrepStepCopySchema>;

/** `label` não vai no payload: o servidor resolve o nome atual da referência na hora de adicionar
 *  (mesmo espírito de nunca confiar em dado de exibição vindo do cliente). */
export const PrepItemAddSchema = z.object({ stepId: IdSchema, ref: PrepRefSchema, index: z.number().int().min(0).optional() });
export type PrepItemAddPayload = z.infer<typeof PrepItemAddSchema>;

export const PrepItemPatchSchema = z.object({
  auto: z.boolean().optional(),
  used: z.boolean().optional(),
  options: PrepItemOptionsSchema.optional(),
});
export type PrepItemPatch = z.infer<typeof PrepItemPatchSchema>;
export const PrepItemUpdateSchema = z.object({ stepId: IdSchema, itemId: IdSchema, patch: PrepItemPatchSchema });
export type PrepItemUpdatePayload = z.infer<typeof PrepItemUpdateSchema>;

export const PrepItemRemoveSchema = z.object({ stepId: IdSchema, itemId: IdSchema });
export type PrepItemRemovePayload = z.infer<typeof PrepItemRemoveSchema>;

/** Reordenar dentro do passo (`toStepId === stepId`) ou mover pra outro passo do mesmo mapa. */
export const PrepItemMoveSchema = z.object({ stepId: IdSchema, itemId: IdSchema, toStepId: IdSchema, index: z.number().int().min(0) });
export type PrepItemMovePayload = z.infer<typeof PrepItemMoveSchema>;

export const PrepResetSchema = z.object({ sceneId: IdSchema });
export type PrepResetPayload = z.infer<typeof PrepResetSchema>;
