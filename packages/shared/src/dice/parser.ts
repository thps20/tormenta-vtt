/**
 * Parser de fórmulas de dado. Puro: só transforma texto em uma estrutura,
 * não rola nada (o rolador está em roller.ts).
 *
 * Gramática (ver docs/SPEC.md §3.4):
 *   formula := term (("+"|"-") term)*
 *   term    := dice | integer
 *   dice    := [count]"d"sides [modifier]
 *   modifier:= "kh"n | "kl"n
 *
 * Limites: count <= 100, sides <= 1000, fórmula <= 200 chars.
 */

export const DICE_LIMITS = {
  maxCount: 100,
  maxSides: 1000,
  maxFormulaLength: 200,
} as const;

export interface DiceTerm {
  kind: "dice";
  /** Sinal do termo: +1 ou -1. */
  sign: 1 | -1;
  count: number;
  sides: number;
  /** keep highest / keep lowest: quantos dados manter. undefined = todos. */
  keep?: { mode: "highest" | "lowest"; n: number };
}

export interface ConstantTerm {
  kind: "constant";
  sign: 1 | -1;
  value: number;
}

export type FormulaTerm = DiceTerm | ConstantTerm;

export interface ParsedFormula {
  /** Fórmula normalizada (sem espaços, minúscula). */
  normalized: string;
  terms: FormulaTerm[];
}

export class DiceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiceParseError";
  }
}

// Um termo: dado ("2d6kh1", "d20") ou inteiro ("3").
const DICE_RE = /^(\d*)d(\d+)(?:(kh|kl)(\d+))?$/;
const INT_RE = /^\d+$/;

/**
 * Converte "2d6 + 3 - 1d4" em termos tipados. Lança DiceParseError se inválida.
 */
export function parseFormula(input: string): ParsedFormula {
  // Só remove espaços ao redor dos operadores: "2d6 + 3" ok, "2d6 3" inválido.
  const normalized = input.trim().replace(/\s*([+-])\s*/g, "$1").toLowerCase();
  if (normalized.length === 0) throw new DiceParseError("Fórmula vazia");
  if (normalized.length > DICE_LIMITS.maxFormulaLength) {
    throw new DiceParseError(`Fórmula muito longa (máx. ${DICE_LIMITS.maxFormulaLength} caracteres)`);
  }

  // Quebra em pedaços preservando os sinais: "2d6+3-1d4" -> ["2d6", "+", "3", "-", "1d4"]
  const pieces = normalized.split(/([+-])/).filter((p) => p !== "");
  const terms: FormulaTerm[] = [];
  let sign: 1 | -1 = 1;
  let expectTerm = true;

  for (const piece of pieces) {
    if (piece === "+" || piece === "-") {
      if (!expectTerm) {
        // Operador após um termo: normal.
        sign = piece === "-" ? -1 : 1;
        expectTerm = true;
        continue;
      }
      // Sinal unário no início ("-2") ou operador duplicado ("2d6+-3").
      if (terms.length === 0) {
        sign = piece === "-" ? -1 : 1;
        continue;
      }
      throw new DiceParseError(`Operador inesperado em "${input}"`);
    }

    if (!expectTerm) throw new DiceParseError(`Faltou operador antes de "${piece}"`);
    terms.push(parseTerm(piece, sign));
    sign = 1;
    expectTerm = false;
  }

  if (expectTerm) throw new DiceParseError(`Fórmula termina com operador: "${input}"`);
  if (!terms.some((t) => t.kind === "dice")) {
    throw new DiceParseError("A fórmula precisa ter pelo menos um dado (ex.: 1d20)");
  }

  return { normalized, terms };
}

function parseTerm(piece: string, sign: 1 | -1): FormulaTerm {
  if (/\s/.test(piece)) throw new DiceParseError(`Faltou operador em "${piece}"`);
  if (INT_RE.test(piece)) {
    return { kind: "constant", sign, value: Number(piece) };
  }

  const m = DICE_RE.exec(piece);
  if (!m) throw new DiceParseError(`Termo inválido: "${piece}"`);

  const countStr = m[1] ?? "";
  const sidesStr = m[2] ?? "";
  const keepMode = m[3];
  const keepStr = m[4];

  const count = countStr === "" ? 1 : Number(countStr);
  const sides = Number(sidesStr);

  if (count < 1 || count > DICE_LIMITS.maxCount) {
    throw new DiceParseError(`Quantidade de dados deve ser entre 1 e ${DICE_LIMITS.maxCount}`);
  }
  if (sides < 2 || sides > DICE_LIMITS.maxSides) {
    throw new DiceParseError(`Lados do dado devem ser entre 2 e ${DICE_LIMITS.maxSides}`);
  }

  const term: DiceTerm = { kind: "dice", sign, count, sides };

  if (keepMode !== undefined && keepStr !== undefined) {
    const n = Number(keepStr);
    if (n < 1 || n > count) {
      throw new DiceParseError(`"${keepMode}${n}" inválido para ${count} dado(s)`);
    }
    term.keep = { mode: keepMode === "kh" ? "highest" : "lowest", n };
  }

  return term;
}
