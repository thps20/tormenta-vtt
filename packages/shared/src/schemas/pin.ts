import { z } from "zod";
import { IdSchema } from "./common.js";
import { HandoutCardBaseSchema, HandoutImageFieldsSchema, HandoutTextFieldsSchema } from "./handout.js";
import { HexColorSchema } from "./system.js";

/**
 * Pino no mapa (docs/plano-narracao.md, unifica o antigo `HandoutPin` com o pino de nota pedido
 * pelo dono do projeto): um marcador clicável, em pixels do mapa (como token/gabarito), que o GM
 * cria. `kind` discrimina o CONTEÚDO: "image"/"text" são pino de handout (cópia denormalizada de
 * um Handout da biblioteca — mesmo formato de sempre, `HandoutCardBaseSchema` + campos de imagem
 * ou texto); "note" é um pino de nota (título + texto curto + ícone/cor, escrito direto no pino,
 * sem passar pela biblioteca). Os três compartilham geometria, `visible` (GM decide; pino
 * invisível só aparece pro GM, mesma regra de `Token.visible`) e soft delete/desfazer — um sistema
 * só de "marcador no mapa" em vez de dois quase iguais.
 */
const PinBaseSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  x: z.number().finite(),
  y: z.number().finite(),
  visible: z.boolean(),
});

const PinNoteTitleSchema = z.string().trim().min(1).max(80);
/** Mesmo limite do texto de Handout (§9.10): "leve", não a ficha inteira. */
const PinNoteTextSchema = z.string().trim().min(1).max(20_000);

/**
 * Ícone/cor de um pino de nota: `icon` é a CHAVE de um `SystemDefinition.pinIcons[]` (regra número
 * 1 — o pino não hardcoda nenhum ícone concreto), OU ausente: sem `pinIcons` no sistema, ou o GM
 * não escolheu nenhum, o cliente usa uma paleta padrão embutida (mobília de UI, não regra de
 * sistema — mesmo espírito de `TOKEN_COLORS` em `TokenInspector.tsx`). `color`, se presente, é
 * sempre um hex — resolvido no cliente a partir do ícone escolhido (ou digitado à mão via a
 * paleta padrão), nunca lido de volta do JSON do sistema no servidor.
 */
const PinNoteFieldsSchema = z.object({
  kind: z.literal("note"),
  title: PinNoteTitleSchema,
  text: PinNoteTextSchema,
  icon: z.string().min(1).max(40).optional(),
  color: HexColorSchema.optional(),
});

/** Pino de handout fixado no mapa: mesma denormalização de sempre (ver HandoutCardSchema),
 *  capturada no momento de fixar — editar o handout original depois não atualiza pinos já fixados. */
export const PinSchema = z.discriminatedUnion("kind", [
  PinBaseSchema.extend(HandoutCardBaseSchema.shape).extend(HandoutImageFieldsSchema.shape),
  PinBaseSchema.extend(HandoutCardBaseSchema.shape).extend(HandoutTextFieldsSchema.shape),
  PinBaseSchema.extend(PinNoteFieldsSchema.shape),
]);
export type Pin = z.infer<typeof PinSchema>;
export type PinKind = Pin["kind"];

/**
 * `pin:create` (GM). O discriminante de CRIAÇÃO é "handout"/"note" (o cliente só sabe qual handout
 * quer fixar; se vai virar um pino "image" ou "text" só o servidor sabe, ao consultar a biblioteca)
 * — diferente do `kind` do `Pin` já fixado, que já é "image"/"text"/"note".
 */
export const PinCreateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("handout"),
    sceneId: IdSchema,
    x: z.number().finite(),
    y: z.number().finite(),
    visible: z.boolean().default(true),
    handoutId: IdSchema,
  }),
  z
    .object({ sceneId: IdSchema, x: z.number().finite(), y: z.number().finite(), visible: z.boolean().default(true) })
    .extend(PinNoteFieldsSchema.shape),
]);
export type PinCreatePayload = z.infer<typeof PinCreateSchema>;

/**
 * `pin:update` (GM) — só pinos `kind: "note"`: título/texto/ícone/cor/visibilidade editáveis no
 * lugar (o handout continua "apagar e fixar de novo", cópia denormalizada de outra entidade).
 */
export const PinUpdateSchema = z.object({
  sceneId: IdSchema,
  pinId: IdSchema,
  patch: PinNoteFieldsSchema.omit({ kind: true }).partial().extend({ visible: z.boolean().optional() }),
});
export type PinUpdatePayload = z.infer<typeof PinUpdateSchema>;

export const PinRemoveSchema = z.object({ sceneId: IdSchema, pinId: IdSchema });
export type PinRemovePayload = z.infer<typeof PinRemoveSchema>;
