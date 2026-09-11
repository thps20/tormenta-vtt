import { z } from "zod";
import { IdSchema } from "./common.js";
import { ItemCardSchema } from "./character.js";
import { HandoutCardSchema } from "./handout.js";
import { KeySchema } from "./system.js";

/**
 * Resultado de um único grupo de dados dentro da fórmula.
 * Ex.: em "2d6+3", o grupo é { count: 2, sides: 6, rolls: [4, 1] }.
 */
export const DiceGroupResultSchema = z.object({
  count: z.number().int().positive(),
  sides: z.number().int().positive(),
  rolls: z.array(z.number().int().positive()),
  /** Rolagens descartadas por modificadores (ex.: kh1 = keep highest). */
  dropped: z.array(z.number().int().positive()).default([]),
  subtotal: z.number().int(),
});
export type DiceGroupResult = z.infer<typeof DiceGroupResultSchema>;

/**
 * Quem vê uma mensagem do chat (modo de rolagem):
 *   all  = pública, todos veem;
 *   gm   = secreta, só o GM vê (um jogador que rolou NÃO vê o próprio resultado: rolagem às cegas);
 *   self = própria, só quem rolou vê.
 */
export const RollVisibilitySchema = z.enum(["all", "gm", "self"]);
export type RollVisibility = z.infer<typeof RollVisibilitySchema>;

/** Uma parcela de dano já rolada. */
export const DamageRollComponentSchema = z.object({
  damageType: KeySchema.nullable(),
  formula: z.string().min(1).max(200),
  groups: z.array(DiceGroupResultSchema),
  modifier: z.number().int(),
  total: z.number().int(),
});
export type DamageRollComponent = z.infer<typeof DamageRollComponentSchema>;

/**
 * Uma aplicação de dano/cura desta rolagem num token (token:apply-damage).
 * Acrescentado ao clicar "Confirmar" no seletor; a lista nunca é sobrescrita,
 * só cresce (permite aplicar em levas diferentes e manter o histórico no card).
 */
export const AppliedDamageSchema = z.object({
  tokenId: IdSchema,
  /** Nome do token no momento da aplicação (sobrevive a renomear/apagar o token). */
  tokenName: z.string().max(64),
  /** Já com sinal: negativo = tirou PV, positivo = curou. */
  amount: z.number().int(),
  /** Multiplicador usado no seletor (×1/×½/×2/×0); ausente = valor digitado à mão. */
  multiplier: z.enum(["1", "0.5", "2", "0"]).optional(),
});
export type AppliedDamage = z.infer<typeof AppliedDamageSchema>;

/**
 * Um alvo de uma rolagem de ataque/dano (docs/plano-alvos.md). `hit`/`reason` são calculados no
 * SERVIDOR na hora da rolagem (a partir de `rolls.attackHit`/`attackAutoHit`/`attackAutoMiss` do
 * sistema) e ficam congelados no card — mudar a Defesa do alvo depois não reescreve o chat.
 *   hit: null      sem regra de acerto no sistema, ou não deu pra avaliar (alvo sem ficha) — o
 *                  card só lista o nome, sem "Acertou/Errou".
 *   reason:
 *     "auto-hit"   attackAutoHit decidiu (T20: 20 natural) — card mostra "(N natural)", sem número do alvo.
 *     "auto-miss"  attackAutoMiss decidiu (T20: 1 natural) — idem.
 *     "compare"    attackHit decidiu pela comparação normal — `targetValue` é o stat do alvo usado.
 *     "no-rule"    nenhuma regra decidiu (mesmo caso de `hit: null`).
 */
export const RollTargetSchema = z.object({
  tokenId: IdSchema,
  /** Nome do token no momento da rolagem (sobrevive a renomear/apagar o token). */
  name: z.string().max(64),
  hit: z.boolean().nullable(),
  /**
   * Valor do stat do alvo usado na comparação (ex.: a Defesa). Ausente quando não há regra, ou
   * quando o viewer não pode ver esse número (jogador que não é GM nem dono do token alvo, ver
   * services/chatVisibility.ts#rollTargetsForViewer no servidor).
   */
  targetValue: z.number().int().optional(),
  reason: z.enum(["auto-hit", "auto-miss", "compare", "no-rule"]).default("no-rule"),
});
export type RollTarget = z.infer<typeof RollTargetSchema>;

export const DiceRollSchema = z.object({
  id: IdSchema,
  roomId: IdSchema,
  /** Quem rolou. */
  participantId: IdSchema,
  nickname: z.string(),
  /** Fórmula rolada (normalizada), ex.: "1d20+5"; dano com várias parcelas junta todas ("6d6 + 1 + 4d6"). */
  formula: z.string().min(1).max(600),
  /** Rótulo opcional, ex.: "Ataque com espada". */
  label: z.string().max(80).optional(),
  groups: z.array(DiceGroupResultSchema),
  /** Modificador fixo total (ex.: +3). */
  modifier: z.number().int(),
  total: z.number().int(),
  /** Rolagem feita a partir de uma ficha. */
  characterId: IdSchema.optional(),
  /** Resultado natural do dado a partir do qual é crítico (ataques com margem ampliada). Ausente = máximo do dado. */
  critThreshold: z.number().int().optional(),
  /**
   * Crítico CONFIRMADO (SPEC §9.13, "Rolar dano junto com o ataque"): true = o natural do d20 caiu
   * na margem de crítico (critThreshold) E `rolls.critical` do sistema confirmou — o dano em
   * `damage[]` já veio com os dados multiplicados por `critMult` da ação. false (padrão) com o d20
   * na margem mas sem `rolls.critical` (ou sem `damage` junto) = "possível crítico": o card só
   * sinaliza, sem multiplicar nada — o Mestre decide à mão. Só faz sentido junto de `damage`.
   */
  criticalConfirmed: z.boolean().default(false),
  /**
   * Rolagem de dano da ficha: uma parcela por tipo de dano, cada uma rolada em separado
   * (groups/modifier/total acima são a junção). A UI mostra "21 (7 fogo + 14 frio)".
   * Ausente = rolagem sem tipo (teste, ataque, /r).
   */
  damage: z.array(DamageRollComponentSchema).optional(),
  /** Dano/cura já aplicado em tokens a partir deste card (token:apply-damage). */
  applied: z.array(AppliedDamageSchema).default([]),
  /**
   * Resultado natural do d20 (docs/plano-alvos.md), só em rolagens de ATAQUE (`type: "attack"` da
   * ação) — usado por `rolls.attackAutoHit`/`attackAutoMiss` e pelo card pra mostrar "(20 natural)"/
   * "(1 natural)". `null` = rolagem sem alvo, ou não é ataque.
   */
  natural: z.number().int().nullable().default(null),
  /** Alvos marcados pelo autor no momento da rolagem (vazio = sem alvo, card como sempre). */
  targets: z.array(RollTargetSchema).default([]),
  createdAt: z.string().datetime(),
});
export type DiceRoll = z.infer<typeof DiceRollSchema>;

/**
 * Uma rolagem tem ataque E dano juntos (SPEC §9.13, "Rolar dano junto com o ataque") quando tem
 * `damage[]` E `critThreshold` setado — só uma ação de ATAQUE seta `critThreshold`, então as duas
 * coisas juntas só acontecem nesse modo (sem precisar de um campo à parte só para marcar isso). Uma
 * ação de dano avulsa (ou `formula` com `damageType`) nunca tem `critThreshold`.
 */
export function isCombinedAttackRoll(roll: Pick<DiceRoll, "damage" | "critThreshold">): boolean {
  return (roll.damage?.length ?? 0) > 0 && roll.critThreshold !== undefined;
}

/**
 * Uma linha de um card de iniciativa em lote (`ChatMessage{kind:"initiative-batch"}`,
 * combat:roll rolando mais de um combatente de uma vez). `formula`/`result` ausentes = o
 * viewer não pode ver o valor (mesma regra all/gm/self de sempre); a linha em si só existe
 * na cópia de quem vê o token (`tokenId`) — quem não vê, a linha nem chega (não vira
 * placeholder), ver services/chatVisibility.ts.
 */
export const InitiativeBatchEntrySchema = z.object({
  combatantId: IdSchema,
  tokenId: IdSchema,
  name: z.string().max(64),
  formula: z.string().min(1).max(200).optional(),
  result: z.number().int().optional(),
});
export type InitiativeBatchEntry = z.infer<typeof InitiativeBatchEntrySchema>;

/** Entradas já ordenadas pelo resultado (maior primeiro). */
export const InitiativeBatchSchema = z.object({
  round: z.number().int(),
  entries: z.array(InitiativeBatchEntrySchema),
});
export type InitiativeBatch = z.infer<typeof InitiativeBatchSchema>;

export const ChatMessageSchema = z.object({
  id: IdSchema,
  roomId: IdSchema,
  participantId: IdSchema,
  nickname: z.string(),
  /**
   * Texto puro, rolagem, aviso do sistema, card de item usado (character:use-item), lote de
   * iniciativa (combat:roll rolando vários combatentes de uma vez, ver `initiativeBatch`) ou
   * handout mostrado pelo GM (handout:show, ver `handout`).
   */
  kind: z.enum(["text", "roll", "system", "item", "initiative-batch", "handout"]),
  text: z.string().max(2000).optional(),
  roll: DiceRollSchema.optional(),
  item: ItemCardSchema.optional(),
  initiativeBatch: InitiativeBatchSchema.optional(),
  /** Cópia denormalizada do handout mostrado (handout:show), quando kind == "handout". */
  handout: HandoutCardSchema.optional(),
  /**
   * Token ao qual esta rolagem está ligada (combatente de combat:roll, ou personagem com
   * token vinculado na cena ativa). Quem não pode ver esse token (oculto ou sob a névoa) não
   * recebe a mensagem — nem o card, nem o placeholder — independente de `visibility`; só o
   * GM recebe sempre. Ver services/chatVisibility.ts no servidor. null = sem token, regra normal.
   */
  tokenId: IdSchema.nullable().default(null),
  /** Quem recebe a mensagem (servidor filtra no broadcast e no snapshot). "Revelar" (GM) muda para "all". */
  visibility: RollVisibilitySchema.default("all"),
  /**
   * Sussurro visual (handout:show "para X"): setado, a mensagem só existe pro GM e para este
   * participante — nem card, nem placeholder pros demais, igual ao gate de `tokenId` acima, mas
   * por PESSOA em vez de por token. Independente de `visibility` (que fica "all" nesse caso).
   * Só handout usa por enquanto; campo genérico caso outra coisa precise de sussurro no futuro.
   */
  whisperTo: IdSchema.nullable().default(null),
  createdAt: z.string().datetime(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
