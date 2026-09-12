import { z } from "zod";
import { IdSchema } from "./common.js";

/**
 * Handouts (docs/SPEC.md §9.10): biblioteca de imagens/textos por sala que o GM mostra pros
 * jogadores (overlay em tela cheia) ou fixa no mapa como um pino. `kind` decide o conteúdo:
 * "image" (reaproveita o upload de mapa, POST /api/upload) ou "text" (markdown leve). Só o GM cria,
 * edita, mostra e fixa — jogador nunca vê a biblioteca (o servidor nem manda `handout:*` pra ele,
 * exceto os broadcasts de pino/chat que ele tem permissão de ver).
 */

const HandoutNameSchema = z.string().trim().min(1).max(80);
const HandoutTagSchema = z.string().trim().min(1).max(30);
const HandoutTagsSchema = z.array(HandoutTagSchema).max(10).default([]);
/** "Leve": não é a ficha inteira, mas dá pra escrever um texto de pista/nota razoável. */
const HandoutTextSchema = z.string().trim().min(1).max(20_000);

/** Campos que só existem em `kind: "image"` (mesmo formato de UploadResult: URL + dimensões).
 *  Exportado: `./pin.js` reaproveita pro pino de handout, que tem o mesmo formato. */
export const HandoutImageFieldsSchema = z.object({
  kind: z.literal("image"),
  imageUrl: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
/** Campos que só existem em `kind: "text"`. Exportado, mesmo motivo acima. */
export const HandoutTextFieldsSchema = z.object({
  kind: z.literal("text"),
  text: HandoutTextSchema,
});

/** Handout salvo na biblioteca da sala. */
export const HandoutSchema = z.discriminatedUnion("kind", [
  HandoutImageFieldsSchema.extend({ id: IdSchema, roomId: IdSchema, name: HandoutNameSchema, tags: HandoutTagsSchema, createdAt: z.string().datetime() }),
  HandoutTextFieldsSchema.extend({ id: IdSchema, roomId: IdSchema, name: HandoutNameSchema, tags: HandoutTagsSchema, createdAt: z.string().datetime() }),
]);
export type Handout = z.infer<typeof HandoutSchema>;
export type HandoutKind = Handout["kind"];

/** `handout:create` (GM). `imageUrl`/`width`/`height` vêm do upload HTTP feito antes (mesmo fluxo de `scene:setMap`). */
export const HandoutCreateSchema = z.discriminatedUnion("kind", [
  HandoutImageFieldsSchema.extend({ name: HandoutNameSchema, tags: HandoutTagsSchema }),
  HandoutTextFieldsSchema.extend({ name: HandoutNameSchema, tags: HandoutTagsSchema }),
]);
export type HandoutCreatePayload = z.infer<typeof HandoutCreateSchema>;

/** `handout:update` (GM): só nome/tags — trocar a imagem ou o texto é apagar e criar de novo. */
export const HandoutPatchSchema = z.object({ name: HandoutNameSchema.optional(), tags: HandoutTagsSchema.optional() });
export type HandoutPatch = z.infer<typeof HandoutPatchSchema>;
export const HandoutUpdateSchema = z.object({ id: IdSchema, patch: HandoutPatchSchema });
export type HandoutUpdatePayload = z.infer<typeof HandoutUpdateSchema>;

export const HandoutDeleteSchema = z.object({ id: IdSchema });
export type HandoutDeletePayload = z.infer<typeof HandoutDeleteSchema>;

/**
 * `handout:show` (GM): publica `ChatMessage{kind:"handout"}` e abre o overlay AO VIVO pra quem
 * recebe (o cliente abre sozinho ao receber a mensagem por broadcast; quem entra depois só vê a
 * miniatura no histórico do chat e clica pra abrir). `target: "all"` = sala toda; `{participantId}`
 * = sussurro visual (só aquele jogador + o GM veem a mensagem — nem card, nem placeholder pros
 * demais, ver `ChatMessage.whisperTo` em schemas/dice.ts e services/chatVisibility.ts no servidor).
 */
export const HandoutShowTargetSchema = z.union([z.literal("all"), z.object({ participantId: IdSchema })]);
export type HandoutShowTarget = z.infer<typeof HandoutShowTargetSchema>;
export const HandoutShowSchema = z.object({ id: IdSchema, target: HandoutShowTargetSchema });
export type HandoutShowPayload = z.infer<typeof HandoutShowSchema>;

/** `handout:close` (GM): fecha o overlay pra quem via a mensagem (a mensagem em si continua no chat). */
export const HandoutCloseSchema = z.object({ messageId: IdSchema });
export type HandoutClosePayload = z.infer<typeof HandoutCloseSchema>;

/** Campos comuns de uma cópia denormalizada de Handout (card do chat e pino do mapa). Exportado
 *  pelo mesmo motivo de HandoutImageFieldsSchema/HandoutTextFieldsSchema acima. */
export const HandoutCardBaseSchema = z.object({ handoutId: IdSchema, name: HandoutNameSchema });

/**
 * Cópia denormalizada de um Handout, embutida em `ChatMessage.handout` no momento de `handout:show`
 * — se o handout original for editado ou apagado depois, a mensagem já publicada NÃO muda (mesmo
 * padrão de `Combatant.name/color`, copiados do token na hora que ele entra no combate; ou do
 * `ItemCard` no chat).
 */
export const HandoutCardSchema = z.discriminatedUnion("kind", [
  HandoutCardBaseSchema.extend(HandoutImageFieldsSchema.shape),
  HandoutCardBaseSchema.extend(HandoutTextFieldsSchema.shape),
]);
export type HandoutCard = z.infer<typeof HandoutCardSchema>;

// Pino de handout no mapa: unificado com pino de nota em `./pin.js` (docs/plano-narracao.md) —
// `Pin{kind:"handout"}` carrega um `HandoutCard` (acima) por dentro. Ver pin.ts.
