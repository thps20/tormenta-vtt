import { z } from "zod";
import { KeySchema } from "./system.js";
import { ActionTemplateSchema, ActivationSchema, ItemFieldValueSchema, SaveSchema } from "./character.js";

/**
 * Compêndio: biblioteca de itens pré-definidos (classes, raças, armas, magias...).
 * Uma entrada é um CharacterItem SEM id, pronto para ser copiado para a ficha.
 * Inserir na ficha faz uma cópia (entryToItem, rules/compendium.ts), nunca um
 * vínculo: editar o item depois não mexe no compêndio e vice-versa.
 *
 * Os dados vivem em packages/shared/systems/<sistema>/compendium/*.json e são
 * validados contra o JSON do sistema por validateCompendiumEntry (kind existe,
 * campos declarados, opções de enum válidas...). Só mecânica: description fica
 * vazia por enquanto.
 */

/** Id estável e legível, ex.: "guerreiro", "espada-longa". */
export const CompendiumIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/).max(80);

export const CompendiumEntrySchema = z.object({
  id: CompendiumIdSchema,
  name: z.string().min(1).max(80),
  /** Chave de itemKinds[] do sistema. */
  kind: KeySchema,
  /** Etiquetas livres para busca/filtro ("marcial", "corpo a corpo"). */
  tags: z.array(z.string().min(1).max(40)).default([]),
  /** Valores dos campos declarados em itemKinds[].fields (os ausentes usam o default do sistema). */
  fields: z.record(z.string(), ItemFieldValueSchema).default({}),
  /** Ações sem id; o id é gerado ao copiar para a ficha. */
  actions: z.array(ActionTemplateSchema).default([]),
  activation: ActivationSchema.nullable().default(null),
  save: SaveSchema.nullable().default(null),
  /** Stats fornecidos quando equipado (chaves de itemKinds[].statBonuses). */
  statBonuses: z.record(KeySchema, z.number()).default({}),
  slots: z.number().min(0).default(0),
  price: z.number().min(0).default(0),
  description: z.string().max(4000).default(""),
  /** Página do livro, só para referência. */
  page: z.number().int().positive().nullable().default(null),
});
export type CompendiumEntry = z.infer<typeof CompendiumEntrySchema>;

/**
 * Uma fonte de entradas. Hoje só existe a do sistema; o compêndio da SALA
 * (homebrew do GM) terá a mesma forma e prioridade maior, de modo que uma
 * entrada com o mesmo id substitua a do sistema (ver mergeCompendium).
 */
export interface CompendiumSource {
  id: string;
  label: string;
  /** Maior vence quando dois ids coincidem. */
  priority: number;
  entries: CompendiumEntry[];
}
