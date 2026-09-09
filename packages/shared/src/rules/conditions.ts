/**
 * Duração de condições em rodadas (`Token.conditions[].expiresRound`, comparado a `Combat.round`).
 * Funções puras — mesmo padrão de `rules/combat.ts`: nenhuma condição específica é conhecida aqui,
 * só a mecânica genérica de "expira quando a rodada bate". Ver docs/plano-duracao-condicoes.md.
 */
import type { TokenCondition } from "../schemas/token.js";

export interface ConditionExpiry {
  /** Condições que continuam no token. */
  remaining: TokenCondition[];
  /** Condições removidas (pra virar mensagem de chat "X: Y terminou"). */
  expired: TokenCondition[];
}

/**
 * Condições que expiram ao a rodada do combate virar para `round` (`expiresRound <= round`).
 * Permanente (sem `expiresRound`) nunca expira. Usada em `combat:next`, quando a rodada avança.
 */
export function expireConditions(conditions: TokenCondition[], round: number): ConditionExpiry {
  const expired = conditions.filter((c) => c.expiresRound !== undefined && c.expiresRound <= round);
  const expiredKeys = new Set(expired);
  const remaining = conditions.filter((c) => !expiredKeys.has(c));
  return { remaining, expired };
}

/**
 * Ao encerrar o combate com `clear: true`: toda condição com duração (`expiresRound`, não importa
 * o valor) é removida — o combate acabou, então NÃO vira permanente. Condição permanente fica.
 */
export function stripTimedConditions(conditions: TokenCondition[]): ConditionExpiry {
  const expired = conditions.filter((c) => c.expiresRound !== undefined);
  const remaining = conditions.filter((c) => c.expiresRound === undefined);
  return { remaining, expired };
}

/**
 * Rodada "efetiva" pra contar duração: combate ainda rolando iniciativa (`round` 0, status
 * "rolling") conta como se já estivesse na rodada 1 — senão uma condição marcada antes do primeiro
 * "Próximo" teria `expiresRound = 0 + N` e expiraria na PRÓPRIA virada pra rodada 1 (`combat:next`
 * de rolling pra active também roda `expireConditions`), sem nunca ter valido.
 */
export function effectiveCombatRound(round: number): number {
  return Math.max(1, round);
}

/**
 * `expiresRound` a partir da rodada atual do combate + duração em rodadas (N). Único ponto que
 * deriva `expiresRound` a partir de uma duração digitada — usado pelo ConditionMenu (marcar e
 * editar duração), pra "rolling" nunca divergir do ajuste de `effectiveCombatRound` acima.
 */
export function deriveExpiresRound(round: number, durationRounds: number): number {
  return effectiveCombatRound(round) + durationRounds;
}
