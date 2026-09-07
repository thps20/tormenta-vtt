/**
 * Rolador: avalia uma fórmula já parseada. Recebe o gerador de números
 * aleatórios por parâmetro para os testes serem determinísticos.
 * Sem I/O: quem persiste/monta o ChatMessage é o servidor.
 */
import type { DiceGroupResult } from "../schemas/dice.js";
import { DiceParseError, parseFormula, type FormulaNode, type ParsedFormula } from "./parser.js";

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

/** Valor parcial durante a avaliação: soma dos grupos de dados + constante. */
interface Value {
  groups: DiceGroupResult[];
  constant: number;
}

/** Rola um dado de N lados: inteiro em [1, sides]. */
function rollDie(sides: number, rng: Rng): number {
  return Math.floor(rng() * sides) + 1;
}

function asConstant(v: Value, what: string): number {
  // O parser já garante isso; a checagem protege contra árvores montadas à mão.
  if (v.groups.length > 0) throw new DiceParseError(`${what} só aceita constantes, não dados`);
  return v.constant;
}

function evaluate(node: FormulaNode, rng: Rng): Value {
  switch (node.kind) {
    case "number":
      return { groups: [], constant: node.value };

    case "dice": {
      const all = Array.from({ length: node.count }, () => rollDie(node.sides, rng));
      let kept = all;
      let dropped: number[] = [];
      if (node.keep) {
        // Ordena uma cópia e separa os mantidos dos descartados.
        const sorted = [...all].sort((a, b) => (node.keep!.mode === "highest" ? b - a : a - b));
        kept = sorted.slice(0, node.keep.n);
        dropped = sorted.slice(node.keep.n);
      }
      const subtotal = kept.reduce((acc, v) => acc + v, 0);
      return { groups: [{ count: node.count, sides: node.sides, rolls: kept, dropped, subtotal }], constant: 0 };
    }

    case "neg": {
      const v = evaluate(node.arg, rng);
      return { groups: v.groups.map((g) => ({ ...g, subtotal: -g.subtotal })), constant: -v.constant };
    }

    case "binary": {
      const l = evaluate(node.left, rng);
      const r = evaluate(node.right, rng);
      switch (node.op) {
        case "+":
          return { groups: [...l.groups, ...r.groups], constant: l.constant + r.constant };
        case "-":
          return {
            groups: [...l.groups, ...r.groups.map((g) => ({ ...g, subtotal: -g.subtotal }))],
            constant: l.constant - r.constant,
          };
        case "*":
          return { groups: [], constant: asConstant(l, '"*"') * asConstant(r, '"*"') };
        case "/": {
          const divisor = asConstant(r, '"/"');
          if (divisor === 0) throw new DiceParseError("Divisão por zero");
          // Divisão inteira arredondada para baixo (regra de mesa).
          return { groups: [], constant: Math.floor(asConstant(l, '"/"') / divisor) };
        }
      }
      break;
    }

    case "call": {
      const args = node.args.map((a) => asConstant(evaluate(a, rng), `${node.fn}()`));
      switch (node.fn) {
        case "floor":
          return { groups: [], constant: Math.floor(args[0] ?? 0) };
        case "ceil":
          return { groups: [], constant: Math.ceil(args[0] ?? 0) };
        case "abs":
          return { groups: [], constant: Math.abs(args[0] ?? 0) };
        case "min":
          return { groups: [], constant: Math.min(...args) };
        case "max":
          return { groups: [], constant: Math.max(...args) };
      }
    }
  }
  throw new DiceParseError("Nó de fórmula desconhecido");
}

export function rollParsed(parsed: ParsedFormula, rng: Rng = Math.random): RollOutcome {
  const v = evaluate(parsed.root, rng);
  const diceTotal = v.groups.reduce((acc, g) => acc + g.subtotal, 0);
  return { formula: parsed.normalized, groups: v.groups, modifier: v.constant, total: diceTotal + v.constant };
}

/**
 * Rola várias fórmulas como uma rolagem só (parcelas de dano por tipo): `formula`
 * é a junção ("6d6 + 1 + 4d6"), groups/modifier/total somam tudo e `parts` guarda
 * cada parcela na ordem recebida. Rolar em separado é o mesmo que rolar junto: cada
 * dado é independente; só muda que dá para saber quanto cada parcela rendeu.
 */
export function rollParsedMany(parsed: ParsedFormula[], rng: Rng = Math.random): RollOutcome & { parts: RollOutcome[] } {
  const parts = parsed.map((p) => rollParsed(p, rng));
  return {
    formula: parts.map((p) => p.formula).join(" + "),
    groups: parts.flatMap((p) => p.groups),
    modifier: parts.reduce((acc, p) => acc + p.modifier, 0),
    total: parts.reduce((acc, p) => acc + p.total, 0),
    parts,
  };
}

/** Atalho: parseia e rola. Lança DiceParseError se a fórmula for inválida. */
export function roll(formula: string, rng: Rng = Math.random): RollOutcome {
  return rollParsed(parseFormula(formula), rng);
}

/**
 * Avalia uma expressão SEM dados (ex.: "10 + floor(5/2)"). Usada para stats
 * derivados da ficha (Defesa, CD...). Lança DiceParseError se houver dado.
 */
export function evaluateConstant(formula: string): number {
  const parsed = parseFormula(formula, { requireDice: false });
  if (parsed.hasDice) throw new DiceParseError(`"${formula}" não pode conter dados`);
  return evaluate(parsed.root, () => 0).constant;
}
