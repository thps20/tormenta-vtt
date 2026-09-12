import { z } from "zod";
import { IdSchema } from "./common.js";
import { EnhancementUseSchema } from "./character.js";

/**
 * Macros (§9.20): barra de botões personalizados por PARTICIPANTE, persistida por sala. Uma macro
 * nunca reimplementa rolagem/uso de item — ela só guarda os parâmetros de um evento que já existe
 * e o cliente reemite na hora de executar (`chat:send`/`character:roll`/`character:use-item`), o
 * mesmo caminho que o botão manual usaria. Isso garante de graça que a EXECUÇÃO de uma macro de
 * ficha respeita a mesma permissão de sempre (`canEditCharacter`, checado por aqueles handlers) —
 * não há nenhuma rota nova que "role por dentro" da macro.
 *
 * - "roll": equivalente a digitar "/r <formula> [# label]" no chat — não depende de personagem
 *   nenhum, é uma rolagem solta (mesmo `chat:send` resolve placeholders `{...}` pela ficha do autor,
 *   se a fórmula tiver algum).
 * - "characterAction": dispara uma ação (ataque/dano/teste/fórmula) de um item de uma ficha que o
 *   autor controla — mesmo trio characterId+itemId+actionId que `character:roll{type:"action"}` já usa.
 * - "useItem": usa um item ativo (poder/magia/consumível) de uma ficha que o autor controla.
 * - "chatText": manda um texto pronto no chat, igual a digitar (herda sussurro pontual se houver
 *   um selecionado; texto é sempre público, SPEC §3.4).
 */
export const MacroActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("roll"), formula: z.string().min(1).max(200), label: z.string().max(80).optional() }),
  z.object({
    type: z.literal("characterAction"),
    characterId: IdSchema,
    itemId: IdSchema,
    actionId: IdSchema,
    enhancements: z.array(EnhancementUseSchema).default([]),
  }),
  z.object({
    type: z.literal("useItem"),
    characterId: IdSchema,
    itemId: IdSchema,
    enhancements: z.array(EnhancementUseSchema).default([]),
  }),
  z.object({ type: z.literal("chatText"), text: z.string().min(1).max(2000) }),
]);
export type MacroAction = z.infer<typeof MacroActionSchema>;

/** Chave de `lib/pinIcons.ts` (mesma paleta embutida usada pelo pino de nota) — sem sistema
 *  nenhum envolvido, é só aparência da UI, por isso vive aqui e não em SystemDefinition. */
export const MacroIconSchema = z.string().min(1).max(40);
export const MacroColorSchema = z.string().min(1).max(20);
export const MacroLabelSchema = z.string().min(1).max(40);

export const MacroSchema = z.object({
  id: IdSchema,
  label: MacroLabelSchema,
  icon: MacroIconSchema,
  color: MacroColorSchema,
  /** Posição na barra (arrastar reordena); também decide qual tecla 1..9 dispara qual macro
   *  (índice 0..8 da lista já ordenada). Renumerado 0..n-1 a cada `macro:reorder`. */
  order: z.number().int().min(0),
  action: MacroActionSchema,
});
export type Macro = z.infer<typeof MacroSchema>;

export const MacroCreateSchema = z.object({ label: MacroLabelSchema, icon: MacroIconSchema, color: MacroColorSchema, action: MacroActionSchema });
export type MacroCreatePayload = z.infer<typeof MacroCreateSchema>;

export const MacroUpdateSchema = z.object({ id: IdSchema, patch: MacroCreateSchema.partial() });
export type MacroUpdatePayload = z.infer<typeof MacroUpdateSchema>;

export const MacroRemoveSchema = z.object({ id: IdSchema });
export type MacroRemovePayload = z.infer<typeof MacroRemoveSchema>;

/** Nova ordem completa (arrastar na barra): precisa ser uma permutação exata das macros do autor. */
export const MacroReorderSchema = z.object({ macroIds: z.array(IdSchema).max(200) });
export type MacroReorderPayload = z.infer<typeof MacroReorderSchema>;
