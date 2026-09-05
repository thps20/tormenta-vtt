import { randomBytes, randomInt } from "node:crypto";

/** Letras sem I/O/0/1 para o código ser fácil de ditar em voz. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Código de convite curto (6 chars). Colisão é tratada pelo @unique do banco. */
export function generateInviteCode(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

/** Segredo do GM: 32 bytes aleatórios em hex (64 chars). */
export function generateGmSecret(): string {
  return randomBytes(32).toString("hex");
}
