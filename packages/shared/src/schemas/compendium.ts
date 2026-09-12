import { z } from "zod";
import { KeySchema } from "./system.js";
import { ActionTemplateSchema, ActivationSchema, CharacterDataSchema, EnhancementSchema, ItemFieldValueSchema, SaveSchema } from "./character.js";

/**
 * Compêndio: biblioteca de itens e criaturas pré-definidos (classes, raças, armas, magias,
 * blocos de monstro...). Uma entrada de item é um CharacterItem SEM id, pronto para ser copiado
 * para a ficha (entryToItem, rules/compendium.ts); uma entrada de criatura é um Character `npc`
 * inteiro SEM ids (entryToCharacter). Inserir/soltar faz sempre uma CÓPIA, nunca um vínculo:
 * editar depois não mexe no compêndio e vice-versa.
 *
 * Os dados vivem em packages/shared/systems/<sistema>/compendium/*.json e são validados contra
 * o JSON do sistema por validateCompendiumEntry (kind existe, campos declarados, opções de enum
 * válidas...). Só mecânica: description fica vazia por enquanto (ver descriptions.local.json).
 */

/** Id estável e legível, ex.: "guerreiro", "espada-longa", "goblin". */
export const CompendiumIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]*$/).max(80);

/**
 * Corpo mecânico de um item, SEM id: compartilhado entre uma entrada de item avulsa
 * (CompendiumItemEntrySchema) e um item embutido no `sheet` de uma criatura (equipamento,
 * poder, ataque natural...). O id nasce ao copiar para a ficha (entryToItem).
 */
export const CompendiumItemBodySchema = z.object({
  /** Chave de itemKinds[] do sistema. */
  kind: KeySchema,
  name: z.string().min(1).max(80),
  /** Valores dos campos declarados em itemKinds[].fields (os ausentes usam o default do sistema). */
  fields: z.record(z.string(), ItemFieldValueSchema).default({}),
  /** Ações sem id; o id é gerado ao copiar para a ficha. */
  actions: z.array(ActionTemplateSchema).default([]),
  activation: ActivationSchema.nullable().default(null),
  /** Aprimoramentos (só mecânica: id, custo, repetível). O texto vem de descriptions.local.json ("<id>#<enhId>"). */
  enhancements: z.array(EnhancementSchema).default([]),
  save: SaveSchema.nullable().default(null),
  /** Stats fornecidos quando equipado (chaves de itemKinds[].statBonuses). */
  statBonuses: z.record(KeySchema, z.number()).default({}),
  slots: z.number().min(0).default(0),
  price: z.number().min(0).default(0),
  description: z.string().max(4000).default(""),
  /** Página do livro, só para referência. */
  page: z.number().int().positive().nullable().default(null),
});
export type CompendiumItemBody = z.infer<typeof CompendiumItemBodySchema>;

export const CompendiumItemEntrySchema = CompendiumItemBodySchema.extend({
  type: z.literal("item"),
  id: CompendiumIdSchema,
  /** Etiquetas livres para busca/filtro ("marcial", "corpo a corpo"). */
  tags: z.array(z.string().min(1).max(40)).default([]),
});
export type CompendiumItemEntry = z.infer<typeof CompendiumItemEntrySchema>;

/**
 * A ficha pronta de uma criatura: CharacterData sem `imageUrl`/`bio` (nasce sem imagem e sem
 * biografia, como qualquer cópia do compêndio) e com os itens SEM id (ganham id ao copiar,
 * igual ao resto do compêndio). `entryToCharacter` (rules/compendium.ts) monta o Character final.
 */
export const CreatureSheetSchema = CharacterDataSchema.omit({ imageUrl: true, bio: true, items: true }).extend({
  items: z.array(CompendiumItemBodySchema).default([]),
});
export type CreatureSheet = z.infer<typeof CreatureSheetSchema>;

/**
 * Bloco de monstro: ND, tamanho, tipo, atributos, PV/PM, resistências, perícias, ataques,
 * habilidades e poderes prontos — um NPC completo do compêndio. Ver docs/plano-criaturas.md.
 */
export const CompendiumCreatureEntrySchema = z.object({
  type: z.literal("creature"),
  id: CompendiumIdSchema,
  name: z.string().min(1).max(80),
  tags: z.array(z.string().min(1).max(40)).default([]),
  description: z.string().max(4000).default(""),
  page: z.number().int().positive().nullable().default(null),
  sheet: CreatureSheetSchema,
});
export type CompendiumCreatureEntry = z.infer<typeof CompendiumCreatureEntrySchema>;

/**
 * Entrada sem `type` é item (todo JSON escrito antes desta união continua válido sem edição,
 * mesmo truque de TokenConditionEntrySchema em schemas/token.ts).
 */
export const CompendiumEntrySchema = z.preprocess(
  (val) => (typeof val === "object" && val !== null && !("type" in val) ? { ...(val as Record<string, unknown>), type: "item" } : val),
  z.discriminatedUnion("type", [CompendiumItemEntrySchema, CompendiumCreatureEntrySchema]),
);
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

/**
 * Homebrew da sala (docs/plano-compendio-sala.md, §9.18): o mesmo `CompendiumEntry`, sem `id` — o
 * servidor gera o `entryId` a partir do nome só na CRIAÇÃO (`compendium:room-create`); depois disso
 * é fixo (decisão confirmada: sem campo pra editar, evita sobrepor uma entrada do sistema sem
 * querer). `compendium:room-update` reenvia este mesmo formato: o editor sempre manda a entrada
 * MECÂNICA inteira, nunca um patch parcial — igual `ItemsSection` já reescreve o array de itens
 * inteiro ao editar a ficha.
 */
export const RoomCompendiumEntryInputSchema = z.discriminatedUnion("type", [
  CompendiumItemEntrySchema.omit({ id: true }),
  CompendiumCreatureEntrySchema.omit({ id: true }),
]);
export type RoomCompendiumEntryInput = z.infer<typeof RoomCompendiumEntryInputSchema>;

export const RoomCompendiumCreateSchema = z.object({ entry: RoomCompendiumEntryInputSchema });
export type RoomCompendiumCreatePayload = z.infer<typeof RoomCompendiumCreateSchema>;

export const RoomCompendiumUpdateSchema = z.object({ entryId: CompendiumIdSchema, entry: RoomCompendiumEntryInputSchema });
export type RoomCompendiumUpdatePayload = z.infer<typeof RoomCompendiumUpdateSchema>;

export const RoomCompendiumDeleteSchema = z.object({ entryId: CompendiumIdSchema });
export type RoomCompendiumDeletePayload = z.infer<typeof RoomCompendiumDeleteSchema>;

/**
 * `compendium:room-import`: entradas completas (COM `id` — é o `entryId` que decide se cada uma é
 * nova ou já existe na sala), tipicamente vindas de `compendium:room-export` de outra sala.
 * `overwriteConflicts` (checkbox desmarcado por padrão na tela): id que já existe na sala é pulado
 * e reportado, a menos que venha `true`, quando é sobrescrito.
 */
export const RoomCompendiumImportSchema = z.object({
  entries: z.array(CompendiumEntrySchema).min(1).max(500),
  overwriteConflicts: z.boolean().default(false),
});
export type RoomCompendiumImportPayload = z.infer<typeof RoomCompendiumImportSchema>;

/** Ack de `compendium:room-import`: números pro resumo da tela + o nome de cada pulada (motivo). */
export interface RoomCompendiumImportResult {
  imported: number;
  overwritten: number;
  skipped: { id: string; name: string; reason: string }[];
}
