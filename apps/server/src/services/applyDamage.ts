/**
 * Regra de permissão de token:apply-damage: separada do handler (que faz I/O
 * no Prisma) pra dar pra testar sem banco/servidor. GM sempre pode; jogador só
 * no token que possui. Além disso, o alvo precisa ter PV pra mexer: ficha
 * vinculada exige que o sistema defina `tokenBar`; token solto exige `hp`.
 */
import { damageRollSign, suggestDamage, type DamageResponses, type DamageRollComponent, type SystemDefinition } from "@tormenta-vtt/shared";
import type { Ctx } from "../socket/ack.js";
import { canEditToken } from "./permissions.js";

/** `hp` só precisa dizer se está definido (null ou não) — o valor cru do Prisma serve. */
interface ApplyDamageTargetToken {
  name: string;
  ownerId: string | null;
  characterId: string | null;
  hp: unknown;
}

export function checkApplyDamageTarget(
  ctx: Pick<Ctx, "role" | "participantId">,
  token: ApplyDamageTargetToken,
  def: Pick<SystemDefinition, "tokenBar">,
): string | null {
  if (!canEditToken(ctx, token)) return `Você não controla o token "${token.name}"`;
  if (token.characterId) {
    if (!def.tokenBar) return `O sistema não define barra de PV pra aplicar em "${token.name}"`;
  } else if (!token.hp) {
    return `"${token.name}" não tem PV definido`;
  }
  return null;
}

/**
 * Decomposição (bruto, ajuste) gravada em `AppliedDamage` ao confirmar um `token:apply-damage`
 * (docs/plano-criaturas.md §0.3-0.4, decisão revista): usa a MESMA `suggestDamage` do shared que já
 * sugeria o multiplicador no seletor — agora também chamada aqui, no servidor, pra registrar a
 * conta de verdade no card, mesmo que o Mestre tenha confirmado outro valor. `raw` = total bruto da
 * rolagem, já com sinal (dano negativo/cura positiva, `damageRollSign`); `adjustment` = quanto a
 * resistência do alvo (`responses`) mudaria esse bruto, também com sinal — NÃO é `amount - raw`: o
 * que foi de fato aplicado (`amount`, no card) é o que o Mestre confirmou, que pode divergir do
 * sugerido. Alvo sem ficha (token solto): `responses` neutra (`DamageResponsesSchema.parse({})`),
 * `adjustment` sempre 0.
 */
export function computeDamageBreakdown(
  def: SystemDefinition,
  damage: DamageRollComponent[],
  responses: DamageResponses,
): { raw: number; adjustment: number } {
  const sign = damageRollSign(def, damage);
  const suggestion = suggestDamage(def, damage, responses);
  const raw = sign * suggestion.raw;
  const suggested = sign * suggestion.amount;
  return { raw, adjustment: suggested - raw };
}
