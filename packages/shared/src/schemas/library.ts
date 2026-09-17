import { z } from "zod";
import { IdSchema } from "./common.js";

/**
 * Acervo da sala (docs/plano-preparo.md §1): biblioteca única do Mestre para preparar a sessão.
 * Handouts/encontros/criaturas homebrew/macros já têm tabela e tela próprias — o acervo só os
 * REFERENCIA (ver `rules/library.ts#buildLibraryItems`). `Asset` é só para o que ainda não tinha
 * casa: imagem de mapa, arte de token, áudio.
 */

export const AssetKindSchema = z.enum(["map", "token", "audio"]);
export type AssetKind = z.infer<typeof AssetKindSchema>;

const AssetNameSchema = z.string().trim().min(1).max(80);
const AssetTagSchema = z.string().trim().min(1).max(30);
const AssetTagsSchema = z.array(AssetTagSchema).max(10).default([]);

/** Mesmo formato de URL de upload que `Scene.mapUrl` já usa (`/uploads/<hex>.<ext>`); recusa URL
 *  externa, pra ninguém "cadastrar" um link qualquer como áudio da sala (§1.3). */
const UploadUrlSchema = z.string().regex(/^\/uploads\/[^/]+$/, "URL precisa ser de um upload deste servidor");

/** Item do acervo salvo (`Asset`). `deletedAt` não aparece aqui: como em `Handout`/`SavedEncounter`,
 *  o servidor nunca manda um Asset apagado — soft delete é detalhe interno (`services/library.ts`). */
export const AssetSchema = z.object({
  id: IdSchema,
  roomId: IdSchema,
  kind: AssetKindSchema,
  name: AssetNameSchema,
  url: z.string().min(1),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
  /** Áudio: lido pelo navegador ao subir (metadata do `<audio>`), só informativo — nunca usado pra
   *  calcular posição de reprodução no servidor (ver `rules/audio.ts#trackPositionMs`). */
  durationMs: z.number().int().positive().nullable().default(null),
  tags: AssetTagsSchema,
  createdAt: z.string(),
});
export type Asset = z.infer<typeof AssetSchema>;

/** `asset:create` (GM). A URL já veio do upload HTTP feito antes (mesmo fluxo de `scene:setMap`). */
export const AssetCreateSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("map"), name: AssetNameSchema, url: UploadUrlSchema, width: z.number().int().positive(), height: z.number().int().positive(), tags: AssetTagsSchema }),
  z.object({ kind: z.literal("token"), name: AssetNameSchema, url: UploadUrlSchema, width: z.number().int().positive(), height: z.number().int().positive(), tags: AssetTagsSchema }),
  z.object({ kind: z.literal("audio"), name: AssetNameSchema, url: UploadUrlSchema, durationMs: z.number().int().positive().nullable().default(null), tags: AssetTagsSchema }),
]);
export type AssetCreatePayload = z.infer<typeof AssetCreateSchema>;

/** `asset:update` (GM): nome/tags sempre; `kind` só troca entre "map"↔"token" (§1.2) — uma imagem
 *  enviada como token que na verdade é um mapa, ou vice-versa, sem reenviar o arquivo. */
export const AssetPatchSchema = z.object({
  name: AssetNameSchema.optional(),
  tags: AssetTagsSchema.optional(),
  kind: z.enum(["map", "token"]).optional(),
});
export type AssetPatch = z.infer<typeof AssetPatchSchema>;
export const AssetUpdateSchema = z.object({ id: IdSchema, patch: AssetPatchSchema });
export type AssetUpdatePayload = z.infer<typeof AssetUpdateSchema>;

export const AssetDeleteSchema = z.object({ id: IdSchema });
export type AssetDeletePayload = z.infer<typeof AssetDeleteSchema>;

/** O que pode ser favoritado no acervo (§1.1) — tabela à parte, não uma coluna em cada tabela
 *  referenciada, pra favoritar funcionar igual nos cinco tipos sem migrar quatro tabelas. */
export const LibraryRefKindSchema = z.enum(["asset", "handout", "encounter", "creature", "macro"]);
export type LibraryRefKind = z.infer<typeof LibraryRefKindSchema>;

export const LibraryFavoriteSchema = z.object({
  refKind: LibraryRefKindSchema,
  refId: IdSchema,
});
export type LibraryFavorite = z.infer<typeof LibraryFavoriteSchema>;

export const LibraryFavoriteSetSchema = z.object({
  refKind: LibraryRefKindSchema,
  refId: IdSchema,
  favorite: z.boolean(),
});
export type LibraryFavoriteSetPayload = z.infer<typeof LibraryFavoriteSetSchema>;
