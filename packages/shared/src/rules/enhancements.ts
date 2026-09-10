/**
 * Aprimoramentos de um item ativo: validar a escolha do jogador contra o item
 * e aplicar os efeitos mecânicos à fórmula de dano. Módulo separado porque
 * tanto activation.ts (custo, card) quanto rolls.ts (fórmula) precisam dele.
 */
import type { Activation, CharacterItem, DamageComponent, EnhancedField, Enhancement, EnhancementEffect, EnhancementUse } from "../schemas/character.js";
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
  /** Dados da parcela principal (tipo da ação) já com os efeitos do mesmo tipo (sem atributo/bônus). */
  formula: string;
  /** Parcelas com outro tipo de dano (uma por tipo, na ordem em que apareceram), só dados. */
  extra: DamageComponent[];
  /** Decomposição legível; null quando nenhum efeito foi aplicado. */
  breakdown: string | null;
}

const timesSuffix = (times: number): string => (times > 1 ? ` ×${times}` : "");

/**
 * Aplica os efeitos de dano à fórmula-base (já sem placeholders). damageSet
 * troca a base (mais de um é erro: o resultado precisa ser inequívoco; `times`
 * não conta no efeito, só no custo); damageDiceAdd soma dados × vezes: sem
 * `damageType` (ou igual ao da ação) entra na parcela principal; com outro tipo
 * vira/engrossa a parcela daquele tipo, para o chat mostrar "7 fogo + 14 frio".
 * `healing` = a ação é de cura: só healDiceAdd entra (na parcela principal) e
 * os efeitos de dano são ignorados. Sem efeito aplicável na escolha, devolve a
 * base intacta e breakdown null.
 */
export function applyDamageEnhancements(baseFormula: string, baseType: string | null, selected: SelectedEnhancement[], healing = false): EnhancedDamage {
  const sets = healing ? [] : selected.filter((s) => enhancementEffect(s.enhancement).kind === "damageSet");
  if (sets.length > 1) throw new EnhancementError("Mais de um aprimoramento muda o dano; escolha só um");
  const set = sets[0];
  const setEffect = set ? enhancementEffect(set.enhancement) : null;
  let formula = setEffect?.kind === "damageSet" ? setEffect.formula : baseFormula.trim();
  const extra: DamageComponent[] = [];
  const parts: string[] = [set ? `${formula} ${shortLabel(set.enhancement)}` : `${formula} base`];
  let applied = set !== undefined;
  for (const s of selected) {
    const effect = enhancementEffect(s.enhancement);
    let dice: string;
    let type: string | null;
    if (effect.kind === "healDiceAdd" && healing) {
      dice = multiplyDice(effect.dice, s.times);
      type = baseType;
    } else if (effect.kind === "damageDiceAdd" && !healing) {
      dice = multiplyDice(effect.dice, s.times);
      type = effect.damageType ?? baseType;
    } else continue;
    if (type === baseType) formula = `${formula} + ${dice}`;
    else {
      const existing = extra.find((c) => c.damageType === type);
      if (existing) existing.formula = `${existing.formula} + ${dice}`;
      else extra.push({ formula: dice, damageType: type });
    }
    parts.push(`${dice} ${shortLabel(s.enhancement)}${timesSuffix(s.times)}`);
    applied = true;
  }
  return { formula, extra, breakdown: applied ? parts.join(" + ") : null };
}

export interface EnhancedAttack {
  /** Fórmula do ataque já com o bônus dos aprimoramentos. */
  formula: string;
  /** Decomposição legível; null quando nenhum attackBonusAdd foi escolhido. */
  breakdown: string | null;
}

/** Soma os attackBonusAdd (× vezes) à fórmula de ataque já resolvida ("1d20 + 7" → "1d20 + 7 + 2"). */
export function applyAttackEnhancements(baseFormula: string, selected: SelectedEnhancement[]): EnhancedAttack {
  const base = baseFormula.trim();
  const parts: string[] = [`${base} base`];
  let bonus = 0;
  for (const s of selected) {
    const effect = enhancementEffect(s.enhancement);
    if (effect.kind !== "attackBonusAdd") continue;
    const value = effect.value * s.times;
    bonus += value;
    parts.push(`${value >= 0 ? "+" : ""}${value} ${shortLabel(s.enhancement)}${timesSuffix(s.times)}`);
  }
  if (parts.length === 1) return { formula: base, breakdown: null };
  const formula = bonus === 0 ? base : `${base} ${bonus > 0 ? "+" : "-"} ${Math.abs(bonus)}`;
  return { formula, breakdown: parts.join(" ") };
}

export interface EnhancedActivation {
  range: Activation["range"];
  duration: Activation["duration"];
  area: Activation["area"];
  target: string;
  /** Soma à CD de resistência (dcAdd × vezes). */
  dcBonus: number;
  /** Soma ao ataque (attackBonusAdd × vezes); só para marcar o card, a fórmula vem de applyAttackEnhancements. */
  attackBonus: number;
  /** O que mudou em relação ao bloco de ativação do item, sem repetição. */
  enhanced: EnhancedField[];
}

const TARGET_MAX = 200;

/**
 * Aplica ao bloco de ativação os efeitos que só mudam o que o card exibe.
 * rangeSet/durationSet/areaSet trocam o valor (dois do mesmo tipo é erro,
 * como damageSet; `times` não conta); targetsAdd e dcAdd somam × vezes.
 * Não valida `units` contra o sistema: chave desconhecida aparece como está.
 */
export function applyActivationEnhancements(activation: Activation, selected: SelectedEnhancement[]): EnhancedActivation {
  const single = <K extends EnhancementEffect["kind"]>(kind: K, what: string): Extract<EnhancementEffect, { kind: K }> | undefined => {
    const found = selected.filter((s) => enhancementEffect(s.enhancement).kind === kind);
    if (found.length > 1) throw new EnhancementError(`Mais de um aprimoramento muda ${what}; escolha só um`);
    const first = found[0];
    return first ? (enhancementEffect(first.enhancement) as Extract<EnhancementEffect, { kind: K }>) : undefined;
  };
  const range = single("rangeSet", "o alcance");
  const duration = single("durationSet", "a duração");
  const area = single("areaSet", "a área");
  let targets = 0;
  let dcBonus = 0;
  let attackBonus = 0;
  for (const s of selected) {
    const effect = enhancementEffect(s.enhancement);
    if (effect.kind === "targetsAdd") targets += effect.count * s.times;
    else if (effect.kind === "dcAdd") dcBonus += effect.value * s.times;
    else if (effect.kind === "attackBonusAdd") attackBonus += effect.value * s.times;
  }
  const enhanced: EnhancedField[] = [];
  if (range) enhanced.push("range");
  if (duration) enhanced.push("duration");
  if (area) enhanced.push("area");
  if (targets > 0) enhanced.push("target");
  if (dcBonus !== 0) enhanced.push("dc");
  if (attackBonus !== 0) enhanced.push("attack");
  const extraTargets = `+${targets} alvo${targets > 1 ? "s" : ""}`;
  const target = targets > 0 ? (activation.target.trim() ? `${activation.target.trim()}, ${extraTargets}` : extraTargets).slice(0, TARGET_MAX) : activation.target;
  return {
    range: range ? { units: range.units, value: range.value ?? 0 } : activation.range,
    duration: duration ? { units: duration.units, value: duration.value ?? 0 } : activation.duration,
    // areaSet sempre sobrescreve com texto livre, mesmo quando o item tinha uma forma estruturada
    // (o aprimoramento descreve a área nova por extenso — ex.: "muda a área para um cone de 18 m").
    area: area ? { kind: "text" as const, text: area.text } : activation.area,
    target,
    dcBonus,
    attackBonus,
    enhanced,
  };
}
