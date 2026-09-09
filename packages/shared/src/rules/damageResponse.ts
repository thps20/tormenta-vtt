/**
 * Sugestão de multiplicador no seletor de "Aplicar" (token:apply-damage) a partir da resposta a
 * dano de uma ficha (CharacterData.damageResponses). O servidor não muda: isto é só uma sugestão
 * de UI (o Mestre confirma ou digita outro valor à mão) — ver docs/plano-criaturas.md §0.4.
 */
import type { CharacterData, DamageResponse } from "../schemas/character.js";
import type { DamageRollComponent } from "../schemas/dice.js";
import type { SystemDefinition } from "../schemas/system.js";
import { isHealingType } from "./damageTypes.js";

/**
 * Resposta combinada de um tipo específico: `all` (regra geral, ex.: "RD 5 contra tudo") mais
 * `byType[tipo]` (regra específica, ex.: "imune a fogo"), quando existir. Reduções SOMAM (as duas
 * regras valem ao mesmo tempo); os sinalizadores (imune/vulnerável/metade) bastam um valer.
 */
function combinedResponse(responses: CharacterData["damageResponses"], damageType: string | null): DamageResponse {
  const byType = damageType !== null ? responses.byType[damageType] : undefined;
  const all = responses.all;
  return {
    reduction: all.reduction + (byType?.reduction ?? 0),
    half: all.half || (byType?.half ?? false),
    immune: all.immune || (byType?.immune ?? false),
    vulnerable: all.vulnerable || (byType?.vulnerable ?? false),
  };
}

/**
 * Frase curta pra UI ("Imune a fogo", "Resistente a fogo (RD 5)", "Vulnerável a fogo"); "" quando a
 * resposta não muda nada. Imune/vulnerável vencem "resistente" quando coincidem (não deveria
 * acontecer na prática, mas a ficha não impede escrever os dois).
 */
export function describeDamageResponse(def: SystemDefinition, damageType: string | null, r: DamageResponse): string {
  const label = damageType !== null ? def.damageTypes.find((t) => t.key === damageType)?.label : undefined;
  const suffix = label ? ` a ${label.toLowerCase()}` : "";
  if (r.immune) return `Imune${suffix}`;
  if (r.vulnerable) return `Vulnerável${suffix}`;
  if (r.half && r.reduction > 0) return `Resistente${suffix} (RD ${r.reduction}, metade)`;
  if (r.reduction > 0) return `Resistente${suffix} (RD ${r.reduction})`;
  if (r.half) return `Resistente${suffix}`;
  return "";
}

export interface DamageSuggestion {
  /** Pré-seleção no seletor de "Aplicar"; null = nenhum multiplicador simples serve (usa `amount`). */
  multiplier: "1" | "0.5" | "2" | "0" | null;
  /** Valor já ajustado, sempre calculado parcela por parcela (mesmo quando `multiplier` é null). */
  amount: number;
  /** Aviso curto, com os rótulos do sistema; "" = nada a avisar. Uma frase por parcela afetada, sem repetir. */
  note: string;
}

/**
 * Sugestão de aplicação de um card de dano num alvo, pela resposta a dano dele. Cada PARCELA do
 * card (`DamageRollComponent`, já com seu próprio `total`) é ajustada com a resposta combinada do
 * tipo dela: imune zera, vulnerável dobra, "reduz à metade" divide (piso), RD subtrai (piso 0) —
 * depois de imune/vulnerável/metade, nessa prioridade (RD sempre soma por cima). `multiplier` só
 * sai preenchido quando a conta inteira equivale a um multiplicador só (sem RD, todas as parcelas
 * com o mesmo efeito) — com RD ou parcelas de tipos diferentes, fica null e a UI usa `amount` no
 * campo de valor à mão. Cura (`isHealingType`) nunca é ajustada.
 */
export function suggestDamage(def: SystemDefinition, damage: DamageRollComponent[], responses: CharacterData["damageResponses"]): DamageSuggestion {
  const total = damage.reduce((sum, d) => sum + d.total, 0);
  if (damage.length === 0 || damage.every((d) => isHealingType(def, d.damageType))) {
    return { multiplier: "1", amount: total, note: "" };
  }

  let amount = 0;
  let sawReduction = false;
  let uniform: "1" | "0.5" | "2" | "0" | "mixed" | undefined;
  const notes: string[] = [];

  for (const d of damage) {
    const r = combinedResponse(responses, d.damageType);
    let value = d.total;
    let thisMultiplier: "1" | "0.5" | "2" | "0" = "1";
    if (r.immune) {
      value = 0;
      thisMultiplier = "0";
    } else if (r.vulnerable) {
      value *= 2;
      thisMultiplier = "2";
    } else if (r.half) {
      value = Math.floor(value / 2);
      thisMultiplier = "0.5";
    }
    if (r.reduction > 0) {
      value = Math.max(0, value - r.reduction);
      sawReduction = true;
    }
    amount += value;
    uniform = uniform === undefined ? thisMultiplier : uniform === thisMultiplier ? uniform : "mixed";

    const text = describeDamageResponse(def, d.damageType, r);
    if (text && !notes.includes(text)) notes.push(text);
  }

  const multiplier = !sawReduction && uniform && uniform !== "mixed" ? uniform : null;
  return { multiplier, amount, note: notes.join(", ") };
}
