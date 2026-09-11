import { z } from "zod";
import { IdSchema } from "./common.js";
import { CompendiumIdSchema } from "./compendium.js";

/**
 * Encontro salvo (docs/SPEC.md §9.14): grupo de criaturas do compêndio (ou homebrew da sala) que o
 * GM monta uma vez e solta no mapa de uma vez, numa transação só. Guarda só a "receita"
 * (entryId + quantidade), nunca cópias de ficha — resolver contra o compêndio ATUAL é feito na hora
 * de soltar (`encounter:spawn`), mesmo princípio de nunca duplicar dados que o compêndio já tem.
 */

const EncounterNameSchema = z.string().trim().min(1).max(80);
const EncounterTagSchema = z.string().trim().min(1).max(30);
const EncounterTagsSchema = z.array(EncounterTagSchema).max(10).default([]);
const EncounterNotesSchema = z.string().max(2000).default("");

/** Uma linha do encontro: qual criatura, quantas cópias, visível ao soltar, nome customizado opcional. */
export const SavedEncounterEntrySchema = z.object({
  entryId: CompendiumIdSchema,
  /** Mesmo teto de `compendium:spawn-creature` (uma criatura por vez, no máximo 20 cópias). */
  count: z.number().int().min(1).max(20),
  visibleOnSpawn: z.boolean(),
  /** Nome de todas as cópias desta linha, no lugar do nome da criatura (ex.: "Chefe dos goblins"). */
  nameOverride: z.string().trim().min(1).max(80).nullable().default(null),
});
export type SavedEncounterEntry = z.infer<typeof SavedEncounterEntrySchema>;

export const SavedEncounterSchema = z.object({
  id: IdSchema,
  roomId: IdSchema,
  name: EncounterNameSchema,
  tags: EncounterTagsSchema,
  notes: EncounterNotesSchema,
  entries: z.array(SavedEncounterEntrySchema).min(1).max(20),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedEncounter = z.infer<typeof SavedEncounterSchema>;

/** `encounter:create` (GM): nasce só da "receita" — nenhuma cópia de ficha é feita aqui. */
export const EncounterCreateSchema = z.object({
  name: EncounterNameSchema,
  tags: EncounterTagsSchema,
  notes: EncounterNotesSchema,
  entries: z.array(SavedEncounterEntrySchema).min(1).max(20),
});
export type EncounterCreatePayload = z.infer<typeof EncounterCreateSchema>;

/**
 * `encounter:create-from-tokens` (GM): a partir de tokens já no mapa, cujo `Character` tem
 * `compendiumEntryId` (veio de uma soltura do compêndio antes). O servidor agrupa por entrada;
 * tokens sem origem de compêndio (ficha feita à mão) são ignorados — o ack devolve quantos foram.
 */
export const EncounterCreateFromTokensSchema = z.object({
  tokenIds: z.array(IdSchema).min(1).max(50),
  name: EncounterNameSchema,
  tags: EncounterTagsSchema,
  notes: EncounterNotesSchema,
});
export type EncounterCreateFromTokensPayload = z.infer<typeof EncounterCreateFromTokensSchema>;

export const EncounterPatchSchema = z.object({
  name: EncounterNameSchema.optional(),
  tags: EncounterTagsSchema.optional(),
  notes: EncounterNotesSchema.optional(),
  entries: z.array(SavedEncounterEntrySchema).min(1).max(20).optional(),
});
export type EncounterPatch = z.infer<typeof EncounterPatchSchema>;
export const EncounterUpdateSchema = z.object({ id: IdSchema, patch: EncounterPatchSchema });
export type EncounterUpdatePayload = z.infer<typeof EncounterUpdateSchema>;

export const EncounterDeleteSchema = z.object({ id: IdSchema });
export type EncounterDeletePayload = z.infer<typeof EncounterDeleteSchema>;

/** `encounter:spawn` (GM): mesmo formato de ponto de soltura de `compendium:spawn-creature`. */
export const EncounterSpawnSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  x: z.number().finite(),
  y: z.number().finite(),
});
export type EncounterSpawnPayload = z.infer<typeof EncounterSpawnSchema>;
