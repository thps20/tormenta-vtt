/**
 * Interpreta o texto digitado no chat.
 *   "/r 2d6+3 # Ataque"  -> rolagem no modo atual do autor, com rótulo
 *   "/gmr 1d20"          -> força rolagem secreta (só o GM vê); "/gr" é sinônimo
 *   "/pr 1d20"           -> força rolagem pública
 *   qualquer outra coisa -> texto
 * Só interpreta; quem rola é o handler, usando o parser do shared.
 * `visibility` ausente = usar o modo de rolagem que veio no payload.
 */
import type { RollVisibility } from "@tormenta-vtt/shared";

export type ChatCommand =
  | { kind: "text"; text: string }
  | { kind: "roll"; formula: string; label?: string; visibility?: RollVisibility };

const ROLL_RE = /^\/(r|roll|gmr|gr|pr)\s+(.+)$/i;

const FORCED: Record<string, RollVisibility | undefined> = { gmr: "gm", gr: "gm", pr: "all" };

export function parseChatCommand(raw: string): ChatCommand {
  const text = raw.trim();
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
