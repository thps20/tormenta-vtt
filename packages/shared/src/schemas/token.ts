import { z } from "zod";
import { IdSchema } from "./common.js";
import { KeySchema } from "./system.js";

export const TokenHpSchema = z.object({ current: z.number().int(), max: z.number().int().min(0) });
export type TokenHp = z.infer<typeof TokenHpSchema>;

/** Condição com duração: `expiresRound` comparado a `Combat.round` (ver rules/conditions.ts).
 *  Ausente = permanente (nunca expira sozinha). */
export const TokenConditionSchema = z.object({
  key: KeySchema,
  expiresRound: z.number().int().min(1).optional(),
});
export type TokenCondition = z.infer<typeof TokenConditionSchema>;

/**
 * Aceita a forma antiga de `Token.conditions` (string = chave, condição permanente) e a forma nova
 * (`{ key, expiresRound? }`): `z.preprocess` normaliza string -> `{ key }` ANTES de validar, então
 * uma ficha salva antes desta mudança (banco com `Token.conditions` em texto puro, ou qualquer
 * outro lugar que ainda mande a forma antiga) continua válida sem migration de dado no JSON —
 * depois do parse, `Token.conditions` é sempre `TokenCondition[]`.
 */
export const TokenConditionEntrySchema = z.preprocess(
  (val) => (typeof val === "string" ? { key: val } : val),
  TokenConditionSchema,
);

export const TokenSchema = z.object({
  id: IdSchema,
  sceneId: IdSchema,
  name: z.string().min(1).max(64),
  /** URL da imagem do token; null = desenha um círculo com a inicial do nome. */
  imageUrl: z.string().nullable(),
  /** Posição do canto superior esquerdo, em pixels do mapa. */
  x: z.number(),
  y: z.number(),
  /** Tamanho em pixels do mapa (um token 1x1 no grid = cellSize x cellSize). */
  width: z.number().positive(),
  height: z.number().positive(),
  rotation: z.number().default(0),
  /** Ordem de desenho: maior = por cima. */
  zIndex: z.number().int().default(0),
  /** Se false, só o GM vê. */
  visible: z.boolean().default(true),
  /** Participante que "controla" o token (pode arrastar). null = só o GM. */
  ownerId: IdSchema.nullable(),
  color: z.string().default("#e11d48"),
  /** Ficha vinculada (ver token:link-character). null = sem ficha. */
  characterId: IdSchema.nullable().default(null),
  /**
   * PV do token "solto" (sem ficha), editado no Inspector (GM). Ignorado enquanto
   * characterId aponta pra uma ficha: aí quem manda é o recurso `tokenBar` dela.
   * null = PV não definido (token não aparece como alvo de token:apply-damage).
   */
  hp: TokenHpSchema.nullable().default(null),
  /**
   * Condições ativas (chaves de conditions[] do sistema, ver SystemDefinitionSchema), cada uma com
   * duração opcional em rodadas — ver TokenConditionEntrySchema acima. Só marcador visual + duração
   * por enquanto, sem automação de regra (conditions[].modifiers ainda não é lido em lugar nenhum).
   * Se a chave existe de verdade no sistema da sala é conferido no handler (aqui é só a forma),
   * igual a ownerId/characterId.
   */
  conditions: z.array(TokenConditionEntrySchema).default([]),
});
export type Token = z.infer<typeof TokenSchema>;

/** Payload de criação: servidor gera o id. O vínculo com ficha é feito depois, por token:link-character. */
export const TokenCreateSchema = TokenSchema.omit({ id: true, characterId: true });
export type TokenCreate = z.infer<typeof TokenCreateSchema>;

/** Atualização parcial (arrastar manda só x/y; redimensionar manda width/height). */
export const TokenPatchSchema = TokenSchema.omit({ characterId: true }).partial().required({ id: true });
export type TokenPatch = z.infer<typeof TokenPatchSchema>;
