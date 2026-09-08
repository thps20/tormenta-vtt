import type { Token, TokenPatch } from "@tormenta-vtt/shared";
import type { Ctx } from "../socket/ack.js";

/** GM pode tudo; jogador só mexe no token que possui. */
export function canEditToken(ctx: Pick<Ctx, "role" | "participantId">, token: Pick<Token, "ownerId">): boolean {
  return ctx.role === "gm" || (token.ownerId !== null && token.ownerId === ctx.participantId);
}

/** Campos que um jogador (dono) pode alterar. O resto (dono, visibilidade, cena...) é só do GM. */
const PLAYER_EDITABLE = new Set<keyof TokenPatch>(["id", "x", "y", "width", "height", "rotation", "conditions"]);

export function restrictPatchForRole(ctx: Ctx, patch: TokenPatch): TokenPatch {
  if (ctx.role === "gm") return patch;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (PLAYER_EDITABLE.has(k as keyof TokenPatch)) out[k] = v;
  }
  return out as TokenPatch;
}
