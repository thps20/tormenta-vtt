/**
 * Aprimoramentos de um item ativo: validar a escolha do jogador contra o item
 * e aplicar os efeitos mecânicos à fórmula de dano. Módulo separado porque
 * tanto activation.ts (custo, card) quanto rolls.ts (fórmula) precisam dele.
 */
import type { CharacterItem, Enhancement, EnhancementEffect, EnhancementUse } from "../schemas/character.js";
import type { SystemDefinition } from "../schemas/system.js";

export class EnhancementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnhancementError";
  }
}

/** Um aprimoramento escolhido, já resolvido contra o item. */
export interface SelectedEnhancement {
  enhancement: Enhancement;
  times: number;
}

/** Efeito do aprimoramento; ausente = só custo. */
export const enhancementEffect = (e: Pick<Enhancement, "effect">): EnhancementEffect => e.effect ?? { kind: "costOnly" };

/**
 * Confere a escolha do jogador contra o item: cada id existe, não se repete e
 * `times` só passa de 1 em aprimoramento repetível. Seleção não vazia num
 * sistema sem activation.enhancementCost é recusada (o sistema não tem a regra).
 * Lança EnhancementError com mensagem pronta para o ack.
 */
export function resolveEnhancements(def: SystemDefinition, item: Pick<CharacterItem, "enhancements">, selection: EnhancementUse[]): SelectedEnhancement[] {
  if (selection.length === 0) return [];
  if (!def.activation.enhancementCost) throw new EnhancementError("Este sistema não tem aprimoramentos");
  const seen = new Set<string>();
  return selection.map((use) => {
    const enhancement = item.enhancements.find((e) => e.id === use.id);
    if (!enhancement) throw new EnhancementError("Aprimoramento não encontrado");
    if (seen.has(use.id)) throw new EnhancementError("Aprimoramento repetido na escolha");
    seen.add(use.id);
    if (use.times > 1 && !enhancement.repeatable) throw new EnhancementError(`"${enhancement.label || enhancement.id}" só pode ser aplicado uma vez`);
    return { enhancement, times: use.times };
  });
}

const LABEL_MAX = 40;
const shortLabel = (e: Enhancement): string => {
  const text = e.label.trim() || e.id;
  return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text;
};

/** "1d6" × 3 → "3d6". */
export function multiplyDice(dice: string, times: number): string {
  const m = /^(\d+)d(\d+)$/.exec(dice);
  if (!m) throw new EnhancementError(`Dado inválido: ${dice}`);
  return `${Number(m[1]) * times}d${m[2]}`;
}

export interface EnhancedDamage {
  /** Fórmula dos dados de dano já com os efeitos (sem atributo/bônus). */
  formula: string;
  /** Decomposição legível; null quando nenhum efeito foi aplicado. */
  breakdown: string | null;
}

/**
 * Aplica os efeitos de dano à fórmula-base (já sem placeholders). damageSet
 * troca a base (mais de um é erro: o resultado precisa ser inequívoco; `times`
 * não conta no efeito, só no custo); damageDiceAdd soma dados × vezes.
 * Sem efeito de dano na escolha, devolve a base intacta e breakdown null.
 */
export function applyDamageEnhancements(baseFormula: string, selected: SelectedEnhancement[]): EnhancedDamage {
  const sets = selected.filter((s) => enhancementEffect(s.enhancement).kind === "damageSet");
  if (sets.length > 1) throw new EnhancementError("Mais de um aprimoramento muda o dano; escolha só um");
  const set = sets[0];
  const setEffect = set ? enhancementEffect(set.enhancement) : null;
  let formula = setEffect?.kind === "damageSet" ? setEffect.formula : baseFormula.trim();
  const parts: string[] = [set ? `${formula} ${shortLabel(set.enhancement)}` : `${formula} base`];
  let applied = set !== undefined;
  for (const s of selected) {
    const effect = enhancementEffect(s.enhancement);
    if (effect.kind !== "damageDiceAdd") continue;
    const dice = multiplyDice(effect.dice, s.times);
    formula = `${formula} + ${dice}`;
    parts.push(`${dice} ${shortLabel(s.enhancement)}${s.times > 1 ? ` ×${s.times}` : ""}`);
    applied = true;
  }
  return { formula, breakdown: applied ? parts.join(" + ") : null };
}
