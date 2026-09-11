import { z } from "zod";
import { IdSchema } from "./common.js";

/**
 * Uma entrada do grupo (SPEC §9.15 "Visão de grupo"): liga uma ficha `kind: "pc"` da sala à faixa
 * compacta do painel lateral. Gerenciado pelo Mestre, persistido em `Room.party` (coluna `Json`,
 * mesmo padrão de `Scene.grid`/`fog` — evolui sem migration de dado). A ORDEM do array É a ordem de
 * exibição (sem coluna `order` própria: é sempre a lista inteira da sala, pequena, reescrita de uma
 * vez em `party:reorder`, nunca uma tabela normalizada como `Scene`).
 */
export const PartyEntrySchema = z.object({
  characterId: IdSchema,
  /** true = a faixa não mostra pra jogadores; o GM ainda vê, esmaecido. */
  hidden: z.boolean().default(false),
});
export type PartyEntry = z.infer<typeof PartyEntrySchema>;

export const PartyArraySchema = z.array(PartyEntrySchema).max(60);

export const PartyAddSchema = z.object({ characterId: IdSchema });
export type PartyAddPayload = z.infer<typeof PartyAddSchema>;

export const PartyRemoveSchema = z.object({ characterId: IdSchema });
export type PartyRemovePayload = z.infer<typeof PartyRemoveSchema>;

export const PartySetHiddenSchema = z.object({ characterId: IdSchema, hidden: z.boolean() });
export type PartySetHiddenPayload = z.infer<typeof PartySetHiddenSchema>;

/** Nova ordem completa (arrastar na faixa): precisa ser uma permutação exata do grupo atual. */
export const PartyReorderSchema = z.object({ characterIds: z.array(IdSchema).min(1).max(60) });
export type PartyReorderPayload = z.infer<typeof PartyReorderSchema>;
