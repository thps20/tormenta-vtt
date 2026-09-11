/**
 * Alvos marcados por um usuário (docs/plano-alvos.md): efêmeros e por participante, nunca
 * persistidos. Este módulo é só regra pura:
 *   - quem mira quem (toggle por Alt/tecla Y, gabarito de área);
 *   - se um ataque acerta um alvo, a partir de `SystemDefinition.rolls.attackHit`/`attackAutoHit`/
 *     `attackAutoMiss` (nunca hardcoded — regra número 1 do projeto).
 */
import { evaluateConstant } from "../dice/index.js";
import type { DiceGroupResult } from "../schemas/dice.js";
import type { Template } from "../schemas/template.js";
import { substitutePlaceholders } from "./placeholders.js";
import { tokensInTemplate } from "./templates.js";
import { makeResolver, type ComputedCharacter } from "./compute.js";

const HIT_OPERATORS = ["==", ">=", "<=", ">", "<"] as const;
export type HitOperator = (typeof HIT_OPERATORS)[number];

export interface HitRule {
  left: string;
  op: HitOperator;
  right: string;
}

/**
 * "{total} >= {target.derived.defense}" -> { left, op, right }. Exige exatamente UM operador de
 * comparação na fórmula inteira (nunca dois, nunca zero) — a mensagem de erro diz o que corrigir
 * no JSON, mesmo espírito de `validateSystemDefinition`.
 */
export function parseHitRule(rule: string): HitRule {
  for (const op of HIT_OPERATORS) {
    const idx = rule.indexOf(op);
    if (idx === -1) continue;
    const left = rule.slice(0, idx).trim();
    const right = rule.slice(idx + op.length).trim();
    if (!left || !right) continue;
    if (HIT_OPERATORS.some((other) => left.includes(other) || right.includes(other))) {
      throw new Error(`fórmula de acerto precisa de exatamente um operador de comparação: "${rule}"`);
    }
    return { left, op, right };
  }
  throw new Error(`fórmula de acerto precisa de um operador de comparação (==, >=, <=, >, <): "${rule}"`);
}

export interface HitEvalContext {
  total?: number;
  natural?: number;
}

/**
 * Resolve um lado da comparação: {total}/{natural} do contexto, {target.<caminho>} via
 * `resolveTarget` (ausente = alvo sem ficha, ou placeholder sem valor). Nunca lança —
 * `undefined` = não deu para calcular.
 */
function evaluateHitSide(side: string, ctx: HitEvalContext, resolveTarget?: (path: string) => number | undefined): number | undefined {
  try {
    const substituted = substitutePlaceholders(side, (path) => {
      if (path === "total") return ctx.total;
      if (path === "natural") return ctx.natural;
      if (path.startsWith("target.")) return resolveTarget?.(path.slice("target.".length));
      return undefined;
    });
    return evaluateConstant(substituted);
  } catch {
    return undefined;
  }
}

function compareHit(op: HitOperator, left: number, right: number): boolean {
  switch (op) {
    case "==":
      return left === right;
    case ">=":
      return left >= right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case "<":
      return left < right;
  }
}

export interface HitEvalResult {
  hit: boolean;
  /** Valor do lado que referencia o alvo ({target.*}) — ausente se nenhum lado referenciar. */
  targetValue?: number;
}

/** `null` = não deu pra avaliar (alvo sem ficha, ou algum placeholder sem valor) — nunca lança. */
export function evaluateHitRule(ruleStr: string, ctx: HitEvalContext, resolveTarget?: (path: string) => number | undefined): HitEvalResult | null {
  const rule = parseHitRule(ruleStr);
  const left = evaluateHitSide(rule.left, ctx, resolveTarget);
  const right = evaluateHitSide(rule.right, ctx, resolveTarget);
  if (left === undefined || right === undefined) return null;
  const targetValue = rule.left.includes("{target.") ? left : rule.right.includes("{target.") ? right : undefined;
  return { hit: compareHit(rule.op, left, right), targetValue };
}

/** Caminho dentro de "{target.<caminho>}" na fórmula (ex.: "derived.defense"); null = nenhum lado referencia o alvo. */
function targetPlaceholderPath(rule: HitRule): string | null {
  const m = /\{target\.([a-zA-Z0-9_.:]+)\}/.exec(`${rule.left} ${rule.right}`);
  return m?.[1] ?? null;
}

/** Sistema mínimo que `hitRuleTargetLabel` precisa (evita importar o `SystemDefinition` inteiro). */
export interface HitRuleLabelSource {
  derived: { key: string; label: string }[];
  attributes: { key: string; label: string }[];
  resources: { key: string; label: string }[];
}

/** Rótulo do stat do alvo usado na comparação, na linguagem do sistema ("Defesa" em T20); "alvo" sem match. */
export function hitRuleTargetLabel(def: HitRuleLabelSource, ruleStr: string): string {
  let rule: HitRule;
  try {
    rule = parseHitRule(ruleStr);
  } catch {
    return "alvo";
  }
  const path = targetPlaceholderPath(rule);
  if (!path) return "alvo";
  const [kind, key] = path.split(".");
  if (kind === "derived") return def.derived.find((d) => d.key === key)?.label ?? "alvo";
  if (kind === "attr") return def.attributes.find((a) => a.key === key)?.label ?? "alvo";
  if (kind === "resource") return def.resources.find((r) => r.key === key)?.label ?? "alvo";
  return "alvo";
}

/**
 * Resolve "{target.<caminho>}" contra a ficha COMPUTADA do alvo. `innerPath` tem exatamente 2
 * segmentos ("kind.key"): "derived.defense", "attr.des", "skill.luta", "equip.defense" resolvem
 * igual aos placeholders globais de sempre; "resource.<key>" é o MÁXIMO do recurso (equivalente a
 * "{resource.<key>.max}" nas fórmulas globais, só que sem o ".max" — não há alvo pra "custo").
 */
export function resolveTargetPlaceholder(computed: ComputedCharacter, innerPath: string): number | undefined {
  const parts = innerPath.split(".");
  if (parts.length !== 2) return undefined;
  const [kind, key] = parts;
  if (kind === "resource") return makeResolver(computed)(`resource.${key}.max`);
  return makeResolver(computed)(innerPath);
}

/**
 * Resultado natural do d20 de uma rolagem de ataque ("1d20+7 legal", "2d20kh1+7" com vantagem):
 * primeiro grupo de 20 lados, o maior valor MANTIDO (kh/kl já descartou o resto no rolador).
 * `null` = a fórmula não tinha d20 nenhum (não devia acontecer numa ação de ataque; defensivo).
 */
export function naturalD20(groups: DiceGroupResult[]): number | null {
  const group = groups.find((g) => g.sides === 20);
  if (!group || group.rolls.length === 0) return null;
  return Math.max(...group.rolls);
}

/** Alt (sem Shift) = vira o único alvo (ou limpa, se já era o único); Shift+Alt = entra/sai da lista. */
export function toggleTarget(current: string[], tokenId: string, additive: boolean): string[] {
  if (additive) return current.includes(tokenId) ? current.filter((id) => id !== tokenId) : [...current, tokenId];
  return current.length === 1 && current[0] === tokenId ? [] : [tokenId];
}

/** Tira ids que não existem mais (token apagado, saiu de vista...). */
export function pruneTargets(targetIds: string[], existingIds: Set<string>): string[] {
  return targetIds.filter((id) => existingIds.has(id));
}

/** Tokens dentro do gabarito, em ordem estável (por nome) — mesma regra de `tokensInTemplate`. */
export function targetsFromTemplate<T extends { id: string; name: string; x: number; y: number; width: number; height: number }>(
  tokens: T[],
  template: Template,
  cellSizePx: number,
): string[] {
  const inside = tokensInTemplate(tokens, template, cellSizePx);
  return tokens
    .filter((t) => inside.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => t.id);
}
