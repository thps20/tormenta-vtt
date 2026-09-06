/**
 * Parser de fórmulas de dado. Puro: só transforma texto em uma árvore (AST),
 * não rola nada (o rolador está em roller.ts).
 *
 * Gramática (ver docs/SPEC.md §3.4):
 *   expr    := term (("+"|"-") term)*
 *   term    := factor (("*"|"/") factor)*
 *   factor  := ("+"|"-") factor | atom
 *   atom    := integer | dice | func "(" expr ("," expr)* ")" | "(" expr ")"
 *   dice    := [count]"d"sides [modifier]
 *   modifier:= "kh"n | "kl"n
 *   func    := "floor" | "ceil" | "abs" | "min" | "max"
 *
 * Regras:
 *   - Dados só podem ser somados/subtraídos entre si e com constantes. Dentro de
 *     "*", "/" ou funções só entram constantes ("2*1d6" é inválido). Isso mantém
 *     o resultado sempre decomponível em "grupos de dados + modificador fixo".
 *   - "/" é divisão inteira arredondada para baixo (7/2 = 3), como nas regras de mesa.
 *   - Placeholders "{...}" NÃO são tratados aqui: devem ser resolvidos antes.
 *
 * Limites: count <= 100, sides <= 1000, fórmula <= 200 chars.
 */

export const DICE_LIMITS = {
  maxCount: 100,
  maxSides: 1000,
  maxFormulaLength: 200,
} as const;

export const FORMULA_FUNCTIONS = ["floor", "ceil", "abs", "min", "max"] as const;
export type FormulaFunction = (typeof FORMULA_FUNCTIONS)[number];

export interface DiceNode {
  kind: "dice";
  count: number;
  sides: number;
  /** keep highest / keep lowest: quantos dados manter. undefined = todos. */
  keep?: { mode: "highest" | "lowest"; n: number };
}

export interface NumberNode {
  kind: "number";
  value: number;
}

export interface NegNode {
  kind: "neg";
  arg: FormulaNode;
}

export interface BinaryNode {
  kind: "binary";
  op: "+" | "-" | "*" | "/";
  left: FormulaNode;
  right: FormulaNode;
}

export interface CallNode {
  kind: "call";
  fn: FormulaFunction;
  args: FormulaNode[];
}

export type FormulaNode = DiceNode | NumberNode | NegNode | BinaryNode | CallNode;

export interface ParsedFormula {
  /** Fórmula normalizada (sem espaços, minúscula). */
  normalized: string;
  root: FormulaNode;
  /** false = só constantes (útil para stats derivados, que não podem ter dado). */
  hasDice: boolean;
}

export class DiceParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiceParseError";
  }
}

// --- Tokenizer -------------------------------------------------------------

type Token =
  | { type: "number"; value: number; text: string }
  | { type: "dice"; node: DiceNode; text: string }
  | { type: "ident"; name: string; text: string }
  | { type: "op"; value: "+" | "-" | "*" | "/" | "(" | ")" | ","; text: string };

const DICE_RE = /^(\d*)d(\d+)(?:(kh|kl)(\d+))?/;
const INT_RE = /^\d+/;
const IDENT_RE = /^[a-z_]+/;

function tokenize(input: string): Token[] {
  const src = input.toLowerCase();
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] ?? "";
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const rest = src.slice(i);

    if (ch === "{") throw new DiceParseError(`Placeholder não resolvido em "${rest.slice(0, 20)}"`);

    if ("+-*/(),".includes(ch)) {
      tokens.push({ type: "op", value: ch as "+" | "-" | "*" | "/" | "(" | ")" | ",", text: ch });
      i++;
      continue;
    }

    const dice = DICE_RE.exec(rest);
    if (dice) {
      tokens.push({ type: "dice", node: diceNode(dice), text: dice[0] });
      i += dice[0].length;
      continue;
    }

    const int = INT_RE.exec(rest);
    if (int) {
      tokens.push({ type: "number", value: Number(int[0]), text: int[0] });
      i += int[0].length;
      continue;
    }

    const ident = IDENT_RE.exec(rest);
    if (ident) {
      tokens.push({ type: "ident", name: ident[0], text: ident[0] });
      i += ident[0].length;
      continue;
    }

    throw new DiceParseError(`Caractere inválido "${ch}" em "${input.trim()}"`);
  }
  return tokens;
}

function diceNode(m: RegExpExecArray): DiceNode {
  const countStr = m[1] ?? "";
  const count = countStr === "" ? 1 : Number(countStr);
  const sides = Number(m[2] ?? "0");
  const keepMode = m[3];
  const keepStr = m[4];

  if (count < 1 || count > DICE_LIMITS.maxCount) {
    throw new DiceParseError(`Quantidade de dados deve ser entre 1 e ${DICE_LIMITS.maxCount}`);
  }
  if (sides < 2 || sides > DICE_LIMITS.maxSides) {
    throw new DiceParseError(`Lados do dado devem ser entre 2 e ${DICE_LIMITS.maxSides}`);
  }
  const node: DiceNode = { kind: "dice", count, sides };
  if (keepMode !== undefined && keepStr !== undefined) {
    const n = Number(keepStr);
    if (n < 1 || n > count) throw new DiceParseError(`"${keepMode}${n}" inválido para ${count} dado(s)`);
    node.keep = { mode: keepMode === "kh" ? "highest" : "lowest", n };
  }
  return node;
}

// --- Parser (descida recursiva) --------------------------------------------

class Parser {
  private pos = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly input: string,
  ) {}

  parse(): FormulaNode {
    if (this.tokens.length === 0) throw new DiceParseError("Fórmula vazia");
    const node = this.expr();
    if (this.pos < this.tokens.length) {
      throw new DiceParseError(`Faltou operador antes de "${this.peek()?.text ?? ""}" em "${this.input}"`);
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isOp(value: string): boolean {
    const t = this.peek();
    return t?.type === "op" && t.value === value;
  }

  private expect(value: string): void {
    if (!this.isOp(value)) {
      const t = this.peek();
      throw new DiceParseError(t ? `Esperado "${value}" antes de "${t.text}"` : `Esperado "${value}" no fim de "${this.input}"`);
    }
    this.pos++;
  }

  private expr(): FormulaNode {
    let left = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = (this.peek() as Token & { type: "op" }).value as "+" | "-";
      this.pos++;
      const right = this.term();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private term(): FormulaNode {
    let left = this.factor();
    while (this.isOp("*") || this.isOp("/")) {
      const op = (this.peek() as Token & { type: "op" }).value as "*" | "/";
      this.pos++;
      const right = this.factor();
      left = { kind: "binary", op, left, right };
    }
    return left;
  }

  private factor(): FormulaNode {
    if (this.isOp("+")) {
      this.pos++;
      return this.factor();
    }
    if (this.isOp("-")) {
      this.pos++;
      return { kind: "neg", arg: this.factor() };
    }
    return this.atom();
  }

  private atom(): FormulaNode {
    const t = this.peek();
    if (!t) throw new DiceParseError(`Fórmula termina com operador: "${this.input}"`);
    this.pos++;

    if (t.type === "number") return { kind: "number", value: t.value };
    if (t.type === "dice") return t.node;

    if (t.type === "ident") {
      if (!(FORMULA_FUNCTIONS as readonly string[]).includes(t.name)) {
        throw new DiceParseError(`Termo inválido: "${t.name}"`);
      }
      this.expect("(");
      const args: FormulaNode[] = [this.expr()];
      while (this.isOp(",")) {
        this.pos++;
        args.push(this.expr());
      }
      this.expect(")");
      const fn = t.name as FormulaFunction;
      if ((fn === "min" || fn === "max") && args.length < 2) {
        throw new DiceParseError(`${fn}() precisa de pelo menos 2 argumentos`);
      }
      if ((fn === "floor" || fn === "ceil" || fn === "abs") && args.length !== 1) {
        throw new DiceParseError(`${fn}() aceita exatamente 1 argumento`);
      }
      return { kind: "call", fn, args };
    }

    if (t.type === "op" && t.value === "(") {
      const inner = this.expr();
      this.expect(")");
      return inner;
    }

    throw new DiceParseError(`Operador inesperado "${t.text}" em "${this.input}"`);
  }
}

function containsDice(node: FormulaNode): boolean {
  switch (node.kind) {
    case "dice":
      return true;
    case "number":
      return false;
    case "neg":
      return containsDice(node.arg);
    case "binary":
      return containsDice(node.left) || containsDice(node.right);
    case "call":
      return node.args.some(containsDice);
  }
}

/** Valida a regra "dado só em soma/subtração" (ver cabeçalho). */
function assertDiceOnlyAdditive(node: FormulaNode): void {
  switch (node.kind) {
    case "dice":
    case "number":
      return;
    case "neg":
      return assertDiceOnlyAdditive(node.arg);
    case "binary":
      if (node.op === "*" || node.op === "/") {
        if (containsDice(node.left) || containsDice(node.right)) {
          throw new DiceParseError(`Dados só podem ser somados ou subtraídos (não "${node.op}")`);
        }
        return;
      }
      assertDiceOnlyAdditive(node.left);
      assertDiceOnlyAdditive(node.right);
      return;
    case "call":
      if (node.args.some(containsDice)) {
        throw new DiceParseError(`${node.fn}() só aceita constantes, não dados`);
      }
      return;
  }
}

/**
 * Converte "2d6 + 3 - 1d4" em uma árvore. Lança DiceParseError se inválida.
 * `requireDice` (padrão true): rolagens precisam ter pelo menos um dado.
 */
export function parseFormula(input: string, opts: { requireDice?: boolean } = {}): ParsedFormula {
  const trimmed = input.trim();
  if (trimmed.length === 0) throw new DiceParseError("Fórmula vazia");
  if (trimmed.length > DICE_LIMITS.maxFormulaLength) {
    throw new DiceParseError(`Fórmula muito longa (máx. ${DICE_LIMITS.maxFormulaLength} caracteres)`);
  }

  const tokens = tokenize(trimmed);
  const root = new Parser(tokens, trimmed).parse();
  assertDiceOnlyAdditive(root);

  const hasDice = containsDice(root);
  if ((opts.requireDice ?? true) && !hasDice) {
    throw new DiceParseError("A fórmula precisa ter pelo menos um dado (ex.: 1d20)");
  }

  return { normalized: tokens.map((t) => t.text).join(""), root, hasDice };
}
