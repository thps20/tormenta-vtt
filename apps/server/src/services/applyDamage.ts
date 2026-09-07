/**
 * Regra de permissão de token:apply-damage: separada do handler (que faz I/O
 * no Prisma) pra dar pra testar sem banco/servidor. GM sempre pode; jogador só
 * no token que possui. Além disso, o alvo precisa ter PV pra mexer: ficha
 * vinculada exige que o sistema defina `tokenBar`; token solto exige `hp`.
 */
import type { SystemDefinition } from "@tormenta-vtt/shared";
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
