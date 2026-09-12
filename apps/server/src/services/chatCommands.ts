/**
 * Interpreta o texto digitado no chat.
 *   "/r 2d6+3 # Ataque"  -> rolagem no modo atual do autor, com rótulo
 *   "/gmr 1d20"          -> força rolagem secreta (só o GM vê); "/gr" é sinônimo
 *   "/pr 1d20"           -> força rolagem pública
 *   "/w Fulano oi"       -> sussurro de texto pra quem tem esse nickname (docs/plano-narracao.md)
 *   qualquer outra coisa -> texto
 * Só interpreta; quem rola/resolve nickname é o handler, usando o parser do shared e a lista de
 * participantes. `visibility` ausente = usar o modo de rolagem que veio no payload.
 */
import type { RollVisibility } from "@tormenta-vtt/shared";

export type ChatCommand =
  | { kind: "text"; text: string }
  | { kind: "roll"; formula: string; label?: string; visibility?: RollVisibility }
  | { kind: "whisper"; targetNickname: string; text: string };

const ROLL_RE = /^\/(r|roll|gmr|gr|pr)\s+(.+)$/i;
/** Nickname de uma palavra só (sem espaço) — mesma limitação de "/r <fórmula>" não aceitar rótulo
 *  antes do "#": simples de digitar, e o seletor "para" cobre nickname com espaço sem precisar de /w. */
const WHISPER_RE = /^\/w\s+(\S+)\s+(.+)$/i;

const FORCED: Record<string, RollVisibility | undefined> = { gmr: "gm", gr: "gm", pr: "all" };

export function parseChatCommand(raw: string): ChatCommand {
  const text = raw.trim();

  const w = WHISPER_RE.exec(text);
  if (w) return { kind: "whisper", targetNickname: w[1] ?? "", text: (w[2] ?? "").trim() };

  const m = ROLL_RE.exec(text);
  if (!m) return { kind: "text", text };

  const cmd = (m[1] ?? "").toLowerCase();
  const rest = m[2] ?? "";
  // Rótulo opcional após "#".
  const hash = rest.indexOf("#");
  const formula = (hash >= 0 ? rest.slice(0, hash) : rest).trim();
  const label = hash >= 0 ? rest.slice(hash + 1).trim().slice(0, 80) : "";

  return { kind: "roll", formula, label: label || undefined, visibility: FORCED[cmd] };
}

/**
 * Resolve o nickname digitado em "/w <nickname> ..." pra um participantId da sala
 * (case-insensitive — nicknames não são normalizados na hora de entrar na sala, então "Fulano" e
 * "fulano" devem ambos funcionar). Pura (sem Prisma) pra testar as bordas sem banco:
 *   - nenhum participante com esse nickname -> erro pedindo pro autor conferir o nome.
 *   - mais de um (nada impede dois jogadores com o mesmo nickname na sala) -> erro pedindo pra usar
 *     o seletor "para" (que lista por participantId, sem ambiguidade) em vez do comando de texto.
 */
export function resolveWhisperTarget(
  nickname: string,
  participants: { id: string; nickname: string }[],
): { ok: true; participantId: string } | { ok: false; error: string } {
  const matches = participants.filter((p) => p.nickname.toLowerCase() === nickname.toLowerCase());
  if (matches.length === 0) return { ok: false, error: `Ninguém com o nickname "${nickname}" nesta sala` };
  if (matches.length > 1) return { ok: false, error: `Mais de uma pessoa se chama "${nickname}" — use o seletor "para" ao lado do modo de rolagem` };
  return { ok: true, participantId: matches[0]!.id };
}
