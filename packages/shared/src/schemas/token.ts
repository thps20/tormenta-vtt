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
  /**
   * Lado do token em células (token não quadrado não é suportado): fonte da verdade do tamanho.
   * Os pixels (`tokenPixelSize`, `rules/placement.ts`) são sempre `cells × cellSize do grid ATUAL`
   * — nunca gravados, pra não existir "converter tamanho ao trocar de grid" (bug histórico,
   * docs/plano-mapas.md/docs/plano-grid.md). Mínimo 1 (mesmo token minúsculo ocupa 1 célula na
   * espiral de posicionamento); 20 é só sanidade (colossal em T20 = 6).
   */
  cells: z.number().int().min(1).max(20).default(1),
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

/** Atualização parcial (arrastar manda só x/y; redimensionar manda cells, sempre inteiro). */
export const TokenPatchSchema = TokenSchema.omit({ characterId: true })
  .partial()
  .required({ id: true })
  .extend({
    /**
     * true só nos ecos "ao vivo" do arraste (~30/s, sem ack — store/tokens.ts#flushMoves): o
     * servidor aplica e faz broadcast normalmente, mas NUNCA empilha histórico por causa disso
     * (docs/plano-desfazer.md §3) — só o patch final do gesto (soltar/redimensionar, sem este
     * campo) conta como "o usuário decidiu mover pra cá". Nunca persistido nem serializado de volta.
     */
    live: z.boolean().optional(),
    /**
     * Posição capturada pelo CLIENTE no início do gesto de arraste (VttCanvas#handleTokenDragStart),
     * mandada só no patch final (soltar). Existe porque os ecos `live` acima já escrevem no banco
     * durante o arraste — se o "antes" do histórico fosse lido do banco no momento do commit final,
     * seria a posição de ~33ms atrás (o último eco), não a de início do gesto: Ctrl+Z desfaria só o
     * último pedacinho do arraste, não o arraste inteiro (docs/plano-desfazer.md §3, achado testando
     * com CDP). Usado SÓ pro diff de histórico (packages/shared não sabe de histórico; quem lê isto
     * é apps/server/src/socket/token.ts) — nunca entra no `data` do `prisma.token.update`.
     */
    dragFrom: z.object({ x: z.number(), y: z.number() }).optional(),
  });
export type TokenPatch = z.infer<typeof TokenPatchSchema>;
