/**
 * Rolador: executa uma fórmula já parseada. Recebe o gerador de números
 * aleatórios por parâmetro para os testes serem determinísticos.
 * Sem I/O: quem persiste/monta o ChatMessage é o servidor.
 */
import type { DiceGroupResult } from "../schemas/dice.js";
import { parseFormula, type ParsedFormula } from "./parser.js";

/** Retorna um número em [0, 1), igual a Math.random. */
export type Rng = () => number;

export interface RollOutcome {
  /** Fórmula normalizada que foi rolada. */
  formula: string;
  groups: DiceGroupResult[];
  /** Soma das constantes (ex.: +5 -2 => 3). */
  modifier: number;
  total: number;
}

/** Rola um dado de N lados: inteiro em [1, sides]. */
function rollDie(sides: number, rng: Rng): number {
  return Math.floor(rng() * sides) + 1;
}

export function rollParsed(parsed: ParsedFormula, rng: Rng = Math.random): RollOutcome {
  const groups: DiceGroupResult[] = [];
  let modifier = 0;
  let total = 0;

  for (const term of parsed.terms) {
    if (term.kind === "constant") {
      modifier += term.sign * term.value;
      total += term.sign * term.value;
      continue;
    }

    const all = Array.from({ length: term.count }, () => rollDie(term.sides, rng));
    let kept = all;
    let dropped: number[] = [];

    if (term.keep) {
      // Ordena uma cópia e separa os mantidos dos descartados.
      const sorted = [...all].sort((a, b) => (term.keep!.mode === "highest" ? b - a : a - b));
      kept = sorted.slice(0, term.keep.n);
      dropped = sorted.slice(term.keep.n);
    }

    const subtotal = term.sign * kept.reduce((acc, v) => acc + v, 0);
    groups.push({ count: term.count, sides: term.sides, rolls: kept, dropped, subtotal });
    total += subtotal;
  }

  return { formula: parsed.normalized, groups, modifier, total };
}

/** Atalho: parseia e rola. Lança DiceParseError se a fórmula for inválida. */
export function roll(formula: string, rng: Rng = Math.random): RollOutcome {
  return rollParsed(parseFormula(formula), rng);
}
