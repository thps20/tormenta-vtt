/**
 * Monta a fórmula de uma rolagem pedida a partir da ficha. Puro: devolve
 * { formula, label } com os placeholders já resolvidos; quem rola é o servidor.
 */
import type { Action, Character, CharacterData, CharacterItem, CharacterRollRequest, DamageComponent } from "../schemas/character.js";
import type { SystemDefinition } from "../schemas/system.js";
import { computeCharacter, makeResolver, parseModifiers, sumModifiers, type ComputedCharacter } from "./compute.js";
import { applyAttackEnhancements, applyDamageEnhancements, EnhancementError, resolveEnhancements } from "./enhancements.js";
import { isHealingType } from "./damageTypes.js";
import { FormulaError, substitutePlaceholders } from "./placeholders.js";

export interface BuiltRoll {
  /** Fórmula pronta para o parser de dados ("1d20+7"). */
  formula: string;
  /** Rótulo para o chat ("Percepção", "Espada longa: Ataque"). */
  label: string;
  /** Resultado natural do dado a partir do qual é crítico (só ataques). */
  critThreshold?: number;
  /** Decomposição do dano ou do ataque quando aprimoramentos mudaram a fórmula ("6d6 base + 4d6 … ×2"); null = como está no item. */
  breakdown?: string | null;
  /**
   * Só ações de dano: parcelas por tipo, na ordem base → extras. `formula` acima é a
   * junção; o servidor rola cada parcela em separado para o chat mostrar o total por tipo.
   */
  damage?: DamageComponent[];
}

export class RollBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RollBuildError";
  }
}

/** Junta partes numéricas pulando zeros: ["1d8", 3, 0, -1] -> "1d8 + 3 - 1". */
function joinParts(base: string, parts: number[]): string {
  let out = base.trim();
  for (const p of parts) {
    if (p === 0) continue;
    out += p > 0 ? ` + ${p}` : ` - ${Math.abs(p)}`;
  }
  return out;
}

/** Resolve placeholders globais de uma fórmula livre (ex.: "/r 1d20+{skill.luta}"). */
export function resolveCharacterFormula(def: SystemDefinition, character: Character | CharacterData, formula: string): string {
  const computed = computeCharacter(def, character);
  return substitutePlaceholders(formula, makeResolver(computed));
}

/** Atributo que entra no dano quando a ação diz "auto" (regra damageAttribute do sistema). */
export function autoDamageAttribute(def: SystemDefinition, item: CharacterItem): string | null {
  const rule = def.damageAttribute;
  if (!rule) return null;
  const fieldValue = item.fields[rule.field];
  if (typeof fieldValue !== "string") return null;
  return rule.map[fieldValue] ?? null;
}

function attackSkillOf(item: CharacterItem): string | null {
  const atk = item.actions.find((a): a is Extract<Action, { kind: "attack" }> => a.kind === "attack");
  return atk?.skill ?? null;
}

function skillTotalWithOverride(computed: ComputedCharacter, skillKey: string, override: string | null): number {
  const skill = computed.skills[skillKey];
  if (!skill) throw new RollBuildError(`Perícia desconhecida: ${skillKey}`);
  if (!override || override === skill.attribute) return skill.total;
  const from = computed.attributes[skill.attribute] ?? 0;
  const to = computed.attributes[override];
  if (to === undefined) throw new RollBuildError(`Atributo desconhecido: ${override}`);
  return skill.total - from + to;
}

export function buildCharacterRoll(def: SystemDefinition, character: Character | CharacterData, request: CharacterRollRequest): BuiltRoll {
  const computed = computeCharacter(def, character);
  const resolveGlobal = makeResolver(computed);
  const mods = parseModifiers(character);

  const wrap = (fn: () => BuiltRoll): BuiltRoll => {
    try {
      return fn();
    } catch (err) {
      if (err instanceof FormulaError || err instanceof EnhancementError) throw new RollBuildError(err.message);
      throw err;
    }
  };

  switch (request.type) {
    case "attribute":
      return wrap(() => {
        const attr = def.attributes.find((a) => a.key === request.key);
        if (!attr) throw new RollBuildError(`Atributo desconhecido: ${request.key}`);
        const value = computed.attributes[attr.key] ?? 0;
        const formula = substitutePlaceholders(def.rolls.attributeCheck, (p) => (p === "attr" ? value : resolveGlobal(p)));
        return { formula, label: attr.label };
      });

    case "skill":
      return wrap(() => {
        const skill = computed.skills[request.key];
        if (!skill) throw new RollBuildError(`Perícia desconhecida: ${request.key}`);
        if (!skill.usable) throw new RollBuildError(`${skill.label} só pode ser usada por quem é treinado`);
        const formula = substitutePlaceholders(def.rolls.skillCheck, (p) => (p === "skill" ? skill.total : resolveGlobal(p)));
        return { formula, label: skill.label };
      });

    case "initiative":
      return wrap(() => ({ formula: substitutePlaceholders(def.rolls.initiative, resolveGlobal), label: "Iniciativa" }));

    case "extra":
      return wrap(() => {
        const extra = def.extraRolls.find((r) => r.key === request.key);
        if (!extra) throw new RollBuildError(`Rolagem desconhecida: ${request.key}`);
        return { formula: substitutePlaceholders(extra.formula, resolveGlobal), label: extra.label };
      });

    case "action":
      return wrap(() => {
        const item = character.items.find((i) => i.id === request.itemId);
        if (!item) throw new RollBuildError("Item não encontrado");
        const action = item.actions.find((a) => a.id === request.actionId);
        if (!action) throw new RollBuildError("Ação não encontrada");
        const label = `${item.name}: ${action.label}`;
        // Aprimoramentos escolhidos na conjuração (vazio = ação como está no item).
        const selected = resolveEnhancements(def, item, request.enhancements ?? []);

        switch (action.kind) {
          case "attack": {
            const total = skillTotalWithOverride(computed, action.skill, action.attributeOverride);
            const bonus = sumModifiers(mods, (t) => t.kind === "attack" && (t.skill === null || t.skill === action.skill));
            const base = substitutePlaceholders(def.rolls.attack ?? def.rolls.skillCheck, (p) => (p === "skill" ? total : resolveGlobal(p)));
            const enhanced = applyAttackEnhancements(joinParts(base, [action.bonus, bonus]), selected);
            return { formula: enhanced.formula, label, critThreshold: action.critRange, breakdown: enhanced.breakdown };
          }
          case "damage": {
            const attrKey = action.attribute === "auto" ? autoDamageAttribute(def, item) : action.attribute;
            const attrValue = attrKey ? (computed.attributes[attrKey] ?? 0) : 0;
            const skill = attackSkillOf(item);
            const bonus = sumModifiers(mods, (t) => t.kind === "damage" && (t.skill === null || t.skill === skill));
            // Aprimoramentos: dados primeiro, atributo e bônus depois ("6d6 + 4d6 + 3"). Dados de outro
            // tipo viram parcelas próprias, sem atributo/bônus (esses ficam só na base). Ação de cura
            // (tipo com `healing` no sistema) só recebe healDiceAdd.
            const enhanced = applyDamageEnhancements(substitutePlaceholders(action.formula, resolveGlobal), action.damageType, selected, isHealingType(def, action.damageType));
            const damage: DamageComponent[] = [{ formula: joinParts(enhanced.formula, [attrValue, action.bonus, bonus]), damageType: action.damageType }, ...enhanced.extra];
            return { formula: damage.map((d) => d.formula).join(" + "), label, breakdown: enhanced.breakdown, damage };
          }
          case "check": {
            const skill = computed.skills[action.skill];
            if (!skill) throw new RollBuildError(`Perícia desconhecida: ${action.skill}`);
            const base = substitutePlaceholders(def.rolls.skillCheck, (p) => (p === "skill" ? skill.total : resolveGlobal(p)));
            return { formula: joinParts(base, [action.bonus]), label };
          }
          case "formula": {
            const formula = substitutePlaceholders(action.formula, resolveGlobal);
            // damageType definido = liga o "Aplicar" no chat (uma parcela só, sem atributo/bônus/aprimoramentos).
            if (action.damageType === null) return { formula, label };
            return { formula, label, damage: [{ formula, damageType: action.damageType }] };
          }
        }
      });
  }
}
