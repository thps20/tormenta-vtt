/**
 * Placeholders de fórmula: "{attr.for}", "{halfLevel}", "{equip.defense}"...
 * Este módulo só sabe achar e substituir placeholders; quem sabe o VALOR de
 * cada um é o computeCharacter (rules/compute.ts). Assim o parser de dados
 * continua genérico e sem conhecimento de ficha.
 */

/** "{caminho}" onde caminho é letras/dígitos/_/./:/* (ex.: attr.for, skill.oficio:alquimia). */
const PLACEHOLDER_RE = /\{([a-zA-Z][a-zA-Z0-9_.:*]*)\}/g;

export class FormulaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FormulaError";
  }
}

/** Lista os caminhos usados numa fórmula (sem repetição, na ordem de aparição). */
export function collectPlaceholders(formula: string): string[] {
  const out: string[] = [];
  for (const m of formula.matchAll(PLACEHOLDER_RE)) {
    const path = m[1] ?? "";
    if (!out.includes(path)) out.push(path);
  }
  return out;
}

/**
 * Substitui cada "{caminho}" pelo número devolvido por `resolve`. Números negativos
 * viram "(-3)" para a fórmula continuar válida ("1d20 + (-3)").
 * Lança FormulaError se algum caminho não for reconhecido (resolve devolve undefined).
 */
export function substitutePlaceholders(formula: string, resolve: (path: string) => number | undefined): string {
  return formula.replace(PLACEHOLDER_RE, (_match, path: string) => {
    const value = resolve(path);
    if (value === undefined) throw new FormulaError(`Placeholder desconhecido: {${path}}`);
    if (!Number.isFinite(value)) throw new FormulaError(`Placeholder {${path}} não tem valor numérico`);
    return value < 0 ? `(${value})` : String(value);
  });
}
