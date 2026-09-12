/**
 * Interpreta o texto digitado no chat.
 *   "/r 2d6+3 # Ataque"    -> rolagem no modo atual do autor, com rótulo
 *   "/gmr 1d20"            -> força rolagem secreta (só o GM vê); "/gr" é sinônimo
 *   "/pr 1d20"             -> força rolagem pública
 *   "/w Fulano oi"         -> sussurro de texto pra quem tem esse nickname (docs/plano-narracao.md)
 *   "/w \"Ana Maria\" oi"  -> nickname de mais de uma palavra, entre aspas
 *   "/w Ana Maria oi"      -> sem aspas: casa o MAIOR prefixo que é nickname de alguém da sala
 *                             (guloso — "Ana Maria" antes de "Ana", se as duas existirem)
 *   qualquer outra coisa   -> texto
 * Só interpreta; quem rola é o handler, usando o parser do shared. A resolução de nickname
 * PRECISA da lista de participantes da sala (pra saber onde o nickname termina e a mensagem
 * começa) — por isso, ao contrário de `/r`/`/gmr`/`/pr`, `/w` já sai daqui resolvido pro
 * `participantId` (ou um erro), não só "separado". `visibility` ausente = usar o modo de rolagem
 * que veio no payload.
 */
import type { RollVisibility } from "@tormenta-vtt/shared";

export type ChatCommand =
  | { kind: "text"; text: string }
  | { kind: "roll"; formula: string; label?: string; visibility?: RollVisibility }
  | { kind: "whisper"; targetNickname: string; participantId: string; text: string }
  /** `/w` reconhecido (tem a CARA de um sussurro — nickname + mensagem, ou "nickname" entre
   *  aspas + mensagem) mas o nickname não resolveu: nenhum participante com esse nome, ou mais de
   *  um. Diferente de "não parece um /w" (esse cai em `text`, mesmo padrão de sempre) — aqui o
   *  autor claramente tentou sussurrar, então o handler deve recusar com erro, NUNCA mandar como
   *  texto normal (o autor pensaria que sussurrou quando na verdade todo mundo leu). */
  | { kind: "whisper-error"; error: string };

const ROLL_RE = /^\/(r|roll|gmr|gr|pr)\s+(.+)$/i;
/** "/w " seguido de qualquer coisa — só pra saber que É uma tentativa de sussurro; a forma exata
 *  (aspas ou não, quantas palavras) é decidida por `splitWhisper` abaixo. */
const WHISPER_PREFIX_RE = /^\/w\s+(.+)$/i;
/** Nickname entre aspas: tudo até o próximo `"` é o nickname (mesmo com espaço dentro). */
const WHISPER_QUOTED_RE = /^"([^"]+)"\s+(.+)$/;

const FORCED: Record<string, RollVisibility | undefined> = { gmr: "gm", gr: "gm", pr: "all" };

export function parseChatCommand(raw: string, participants: { id: string; nickname: string }[] = []): ChatCommand {
  const text = raw.trim();

  const wPrefix = WHISPER_PREFIX_RE.exec(text);
  if (wPrefix) {
    const split = splitWhisper(wPrefix[1]!, participants);
    // `null` = não tinha CARA de sussurro completo (ex.: "/w Fulano" sem mensagem nenhuma depois) —
    // cai pra texto normal, mesmo comportamento de antes de `/w` existir resolver nickname.
    if (split) {
      if (!split.ok) return { kind: "whisper-error", error: split.error };
      return { kind: "whisper", targetNickname: split.nickname, participantId: split.participantId, text: split.text };
    }
  }

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
 * Separa "<nickname> <mensagem>" (o texto já sem o "/w " da frente) num nickname resolvido e o
 * resto. `null` = não tem cara de sussurro completo (não vale a pena tentar — nem aspas fechando,
 * nem duas palavras pelo menos), quem chama trata como se `/w` nem tivesse casado.
 */
function splitWhisper(
  rest: string,
  participants: { id: string; nickname: string }[],
): { ok: true; nickname: string; participantId: string; text: string } | { ok: false; error: string } | null {
  const quoted = WHISPER_QUOTED_RE.exec(rest);
  if (quoted) {
    const nickname = quoted[1]!;
    const text = quoted[2]!.trim();
    const resolved = resolveWhisperTarget(nickname, participants);
    return resolved.ok ? { ok: true, nickname, participantId: resolved.participantId, text } : { ok: false, error: resolved.error };
  }

  const words = rest.split(/\s+/).filter((w) => w.length > 0);
  if (words.length < 2) return null; // "/w Fulano" sozinho: não parece um comando completo.

  // Guloso: tenta o prefixo mais LONGO primeiro (todas as palavras menos a última), depois vai
  // encurtando. Sempre deixa ao menos 1 palavra pra mensagem. A primeira vez que um prefixo bate
  // com ALGUM nickname da sala decide — se bater com mais de um (nickname duplicado), é ambíguo e
  // PARA aqui (não tenta um prefixo mais curto pra "desambiguar": greedy nesse sentido também).
  for (let k = words.length - 1; k >= 1; k--) {
    const candidate = words.slice(0, k).join(" ");
    const resolved = resolveWhisperTarget(candidate, participants);
    if (resolved.ok) return { ok: true, nickname: candidate, participantId: resolved.participantId, text: words.slice(k).join(" ") };
    if (resolved.reason === "ambiguous") return { ok: false, error: resolved.error };
    // reason === "not-found": este prefixo não é nickname de ninguém, tenta um mais curto.
  }
  // Nenhum prefixo bateu com nickname nenhum: reporta o palpite mais completo (todas as palavras
  // menos a última), que é o que um humano lendo a mensagem também assumiria ser o nickname.
  return { ok: false, error: `Ninguém com o nickname "${words.slice(0, -1).join(" ")}" nesta sala` };
}

/**
 * Resolve um nickname (já isolado, aspeado ou não) pra um participantId da sala (case-insensitive
 * — nicknames não são normalizados na hora de entrar na sala, então "Fulano" e "fulano" devem
 * ambos funcionar). Pura (sem Prisma) pra testar as bordas sem banco. `reason` (só quando
 * `ok: false`) é o motivo em forma de código, pra `splitWhisper` decidir se tenta um prefixo mais
 * curto (`"not-found"`) ou desiste na hora (`"ambiguous"`) — `error` é sempre o texto pro ack.
 */
export function resolveWhisperTarget(
  nickname: string,
  participants: { id: string; nickname: string }[],
): { ok: true; participantId: string } | { ok: false; error: string; reason: "not-found" | "ambiguous" } {
  const matches = participants.filter((p) => p.nickname.toLowerCase() === nickname.toLowerCase());
  if (matches.length === 0) return { ok: false, reason: "not-found", error: `Ninguém com o nickname "${nickname}" nesta sala` };
  if (matches.length > 1) {
    return { ok: false, reason: "ambiguous", error: `Mais de uma pessoa se chama "${nickname}" — use o seletor "para" ao lado do modo de rolagem` };
  }
  return { ok: true, participantId: matches[0]!.id };
}
