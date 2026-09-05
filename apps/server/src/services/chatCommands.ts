/**
 * Interpreta o texto digitado no chat.
 *   "/r 2d6+3 # Ataque"  -> rolagem pública com rótulo
 *   "/gr 1d20"           -> rolagem secreta (GM + autor)
 *   qualquer outra coisa -> texto
 * Só interpreta; quem rola é o handler, usando o parser do shared.
 */
export type ChatCommand =
  | { kind: "text"; text: string }
  | { kind: "roll"; formula: string; label?: string; secret: boolean };

const ROLL_RE = /^\/(r|roll|gr)\s+(.+)$/i;

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

  return { kind: "roll", formula, label: label || undefined, secret: cmd === "gr" };
}
