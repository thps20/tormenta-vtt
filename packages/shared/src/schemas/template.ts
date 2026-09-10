import { z } from "zod";
import { IdSchema } from "./common.js";

/**
 * Gabaritos de área de efeito no mapa (docs/plano-gabaritos.md): círculo, cone, linha e quadrado,
 * no estilo Foundry. Efêmeros por sessão (não vão ao banco, ver `apps/server/src/services/templates.ts`),
 * sincronizados via socket. Geometria em PIXELS DO MAPA, como token/fog — `angle`/`width` de
 * cone/linha são copiados de `SystemDefinition.templates` (padrão do sistema, ou do preset
 * escolhido) no momento da criação, pra o gabarito continuar correto mesmo se o JSON mudar depois.
 */

const TemplateBaseSchema = z.object({
  id: IdSchema,
  /** Quem criou (sempre o participantId de quem chamou template:upsert, nunca confiado do payload). */
  ownerId: IdSchema,
  /** Origem do gabarito, em pixels do mapa: centro (círculo/quadrado) ou vértice/ponta (cone/linha). */
  x: z.number().finite(),
  y: z.number().finite(),
  /** Direção em radianos (0 = eixo +x). Só importa em cone/linha/quadrado; círculo ignora. */
  rotation: z.number().finite().default(0),
  /** Rótulo opcional (nome da magia/preset), mostrado no gabarito. */
  label: z.string().max(60).default(""),
});

export const TemplateSchema = z.discriminatedUnion("shape", [
  TemplateBaseSchema.extend({ shape: z.literal("circle"), r: z.number().positive() }),
  TemplateBaseSchema.extend({ shape: z.literal("cone"), length: z.number().positive(), angle: z.number().positive().max(180) }),
  TemplateBaseSchema.extend({ shape: z.literal("line"), length: z.number().positive(), width: z.number().positive() }),
  TemplateBaseSchema.extend({ shape: z.literal("square"), side: z.number().positive() }),
]);
export type Template = z.infer<typeof TemplateSchema>;
export type TemplateShape = Template["shape"];

/**
 * `template:upsert`: cria (id novo) ou edita (mover/girar) um gabarito existente. `live` marca eco
 * de arraste/rotação em andamento (mesmo papel de `TokenPatch.live`) — não muda nada no servidor
 * hoje (não há histórico de gabarito), mas mantém o contrato simétrico ao de token.
 */
export const TemplateUpsertSchema = z.object({ sceneId: IdSchema, template: TemplateSchema, live: z.boolean().optional() });
export type TemplateUpsertPayload = z.infer<typeof TemplateUpsertSchema>;

export const TemplateRemoveSchema = z.object({ sceneId: IdSchema, templateId: IdSchema });
export type TemplateRemovePayload = z.infer<typeof TemplateRemoveSchema>;

/** Guarda-corpo (mesmo espírito de FOG_SHAPES_MAX): evita um mapa acumular gabaritos sem limite. */
export const TEMPLATE_MAX_PER_SCENE = 200;
