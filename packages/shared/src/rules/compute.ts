/**
 * computeCharacter: função PURA que transforma as entradas da ficha nos valores
 * finais (atributos com bônus, total de cada perícia, stats derivados, máximo
 * dos recursos). Servidor e cliente rodam a mesma função; o cliente só para
 * exibir, o servidor para montar rolagens.
 *
 * Ordem (cada etapa só depende das anteriores):
 *   nível → modificadores → atributos → equip (itens equipados) → perícias
 *   → derivados → recursos.
 * Erros de fórmula não derrubam a ficha: viram `warnings` e o valor fica 0.
 */
import { DiceParseError, evaluateConstant } from "../dice/index.js";
import type { Character, CharacterData, CharacterSkill } from "../schemas/character.js";
import type { SizeDef, SkillDef, SystemDefinition } from "../schemas/system.js";
import { FormulaError, substitutePlaceholders } from "./placeholders.js";
import { parseModifierTarget, type ModifierTarget } from "./modifierTarget.js";

export interface ComputedSkill {
  key: string;
  label: string;
  /** Atributo efetivamente usado. */
  attribute: string;
  trained: boolean;
  /** false quando a perícia exige treino e o personagem não é treinado. */
  usable: boolean;
  total: number;
}

export interface ComputedCharacter {
  level: number;
  halfLevel: number;
  trainedBonus: number;
  attributes: Record<string, number>;
  equip: Record<string, number>;
  skills: Record<string, ComputedSkill>;
  derived: Record<string, number>;
  resources: Record<string, { max: number; min: number }>;
  warnings: string[];
}

/** Modificadores já interpretados (só os habilitados). */
export interface ParsedModifier {
  target: ModifierTarget;
  value: number;
}

export function parseModifiers(data: Pick<CharacterData, "modifiers">): ParsedModifier[] {
  const out: ParsedModifier[] = [];
  for (const m of data.modifiers) {
    if (!m.enabled) continue;
    const target = parseModifierTarget(m.target);
    if (target) out.push({ target, value: m.value });
  }
  return out;
}

export function sumModifiers(mods: ParsedModifier[], pred: (t: ModifierTarget) => boolean): number {
  return mods.reduce((acc, m) => (pred(m.target) ? acc + m.value : acc), 0);
}

/** Bônus de treino pela tabela trainedBonus[] (maior minLevel <= nível). */
export function trainedBonusFor(def: SystemDefinition, level: number): number {
  let bonus = 0;
  let best = -Infinity;
  for (const t of def.trainedBonus) {
    if (t.minLevel <= level && t.minLevel > best) {
      best = t.minLevel;
      bonus = t.bonus;
    }
  }
  return bonus;
}

/** Definição da perícia para uma chave de instância ("oficio:alquimia" -> oficio). */
export function skillDefFor(def: SystemDefinition, instanceKey: string): SkillDef | undefined {
  const base = instanceKey.split(":")[0];
  return def.skills.find((s) => s.key === base);
}

/** Chaves de perícia que a ficha deve listar: fixas + variantes que o personagem tem. */
export function listSkillKeys(def: SystemDefinition, data: Pick<CharacterData, "skills">): string[] {
  const keys: string[] = [];
  for (const s of def.skills) {
    if (!s.variants) keys.push(s.key);
    else {
      for (const k of Object.keys(data.skills)) {
        if (k.startsWith(`${s.key}:`)) keys.push(k);
      }
    }
  }
  return keys;
}

function safeEval(formula: string, resolve: (path: string) => number | undefined, where: string, warnings: string[]): number {
  try {
    return evaluateConstant(substitutePlaceholders(formula, resolve));
  } catch (err) {
    if (err instanceof FormulaError || err instanceof DiceParseError) {
      warnings.push(`${where}: ${err.message}`);
      return 0;
    }
    throw err;
  }
}

/** Soma/min/max dos stats dos itens equipados, com default quando nenhum item define o stat. */
function computeEquip(def: SystemDefinition, data: CharacterData): Record<string, number> {
  const out: Record<string, number> = {};
  const kinds = new Map(def.itemKinds.map((k) => [k.key, k]));
  for (const stat of def.equipStats) {
    const values: number[] = [];
    for (const item of data.items) {
      if (!item.equipped || item.quantity === 0) continue;
      if (kinds.get(item.kind)?.physical === false) continue;
      const v = item.statBonuses[stat.key];
      if (v !== undefined) values.push(v);
    }
    if (values.length === 0) out[stat.key] = stat.default;
    else if (stat.aggregate === "sum") out[stat.key] = values.reduce((a, b) => a + b, 0);
    else if (stat.aggregate === "min") out[stat.key] = Math.min(...values);
    else out[stat.key] = Math.max(...values);
  }
  return out;
}

export function computeCharacter(def: SystemDefinition, character: Character | CharacterData): ComputedCharacter {
  const warnings: string[] = [];
  const data: CharacterData = character;

  // Nível. (level.source = "classes" chega na fase 4; por ora o valor é o digitado.)
  const level = Math.max(0, Math.min(def.level.max, data.level));
  const halfLevel = Math.floor(level / 2);
  const trainedBonus = trainedBonusFor(def, level);
  const mods = parseModifiers(data);

  // Atributos: base (ou default do sistema) + modificadores.
  const attributes: Record<string, number> = {};
  for (const a of def.attributes) {
    const base = data.attributes[a.key]?.base ?? a.default;
    attributes[a.key] = base + sumModifiers(mods, (t) => t.kind === "attr" && t.key === a.key);
  }

  const equip = computeEquip(def, data);
  const size: SizeDef | undefined = def.sizes.find((s) => s.key === data.size);
  const spellcastingAttr = data.spellcastingAttribute ? (attributes[data.spellcastingAttribute] ?? 0) : 0;

  // Resolvedor global: o que qualquer fórmula pode usar (skills/derived/resources
  // entram conforme vão sendo calculados).
  const skills: Record<string, ComputedSkill> = {};
  const derived: Record<string, number> = {};
  const resources: Record<string, { max: number; min: number }> = {};
  const resolveGlobal = (path: string): number | undefined => {
    if (path === "level") return level;
    if (path === "halfLevel") return halfLevel;
    if (path === "trainedBonus") return trainedBonus;
    if (path === "spellcastingAttr") return spellcastingAttr;
    const [head, key, tail] = path.split(".");
    if (key === undefined) return undefined;
    if (head === "attr" && tail === undefined) return attributes[key];
    if (head === "equip" && tail === undefined) return equip[key];
    if (head === "skill" && tail === undefined) return skills[key]?.total;
    if (head === "derived" && tail === undefined) return derived[key];
    if (head === "resource" && tail === "max") return resources[key]?.max;
    return undefined;
  };

  // Perícias.
  for (const key of listSkillKeys(def, data)) {
    const sdef = skillDefFor(def, key);
    if (!sdef) continue;
    const cs: CharacterSkill = data.skills[key] ?? { trained: false, other: 0, attribute: null };
    const attrKey = cs.attribute && attributes[cs.attribute] !== undefined ? cs.attribute : sdef.attribute;
    const resolve = (path: string): number | undefined => {
      switch (path) {
        case "attr":
          return attributes[attrKey] ?? 0;
        case "trained":
          return cs.trained ? trainedBonus : 0;
        case "sizeMod":
          return sdef.sizeModifier ? (size?.skillModifier ?? 0) : 0;
        case "armorPenalty":
          return sdef.armorPenalty ? (equip["armorPenalty"] ?? 0) : 0;
        default:
          return resolveGlobal(path);
      }
    };
    const base = safeEval(def.skillTotal, resolve, `perícia ${key}`, warnings);
    const bonus = sumModifiers(
      mods,
      (t) =>
        t.kind === "skillAll" ||
        (t.kind === "skill" && t.key === key) ||
        (t.kind === "skillTag" && sdef.tags.includes(t.tag)),
    );
    const variant = key.includes(":") ? (cs.label ?? key.split(":")[1] ?? "") : "";
    skills[key] = {
      key,
      label: variant ? `${sdef.label} (${variant})` : sdef.label,
      attribute: attrKey,
      trained: cs.trained,
      usable: !sdef.trainedOnly || cs.trained,
      total: base + cs.other + bonus,
    };
  }

  // Derivados, na ordem do JSON (um pode usar o anterior).
  for (const d of def.derived) {
    const override = d.editable ? data.derivedOverrides[d.key] : undefined;
    const base = override ?? safeEval(d.formula, resolveGlobal, `derivado ${d.key}`, warnings);
    derived[d.key] = base + sumModifiers(mods, (t) => t.kind === "derived" && t.key === d.key);
  }

  // Recursos: máximo digitado ou por fórmula, + modificadores; mínimo por fórmula.
  for (const r of def.resources) {
    const cr = data.resources[r.key];
    const baseMax = cr?.maxOverride ?? (r.maxFormula ? safeEval(r.maxFormula, resolveGlobal, `recurso ${r.key}`, warnings) : 0);
    const max = baseMax + sumModifiers(mods, (t) => t.kind === "resourceMax" && t.key === r.key);
    const min = r.minFormula
      ? safeEval(r.minFormula, (p) => (p === "max" ? max : resolveGlobal(p)), `recurso ${r.key} (mín.)`, warnings)
      : 0;
    resources[r.key] = { max, min };
  }

  return { level, halfLevel, trainedBonus, attributes, equip, skills, derived, resources, warnings };
}

/** Resolvedor de placeholders globais a partir de uma ficha já computada (para /r no chat). */
export function makeResolver(computed: ComputedCharacter): (path: string) => number | undefined {
  return (path) => {
    if (path === "level") return computed.level;
    if (path === "halfLevel") return computed.halfLevel;
    if (path === "trainedBonus") return computed.trainedBonus;
    const [head, key, tail] = path.split(".");
    if (key === undefined) return undefined;
    if (head === "attr" && tail === undefined) return computed.attributes[key];
    if (head === "equip" && tail === undefined) return computed.equip[key];
    if (head === "skill" && tail === undefined) return computed.skills[key]?.total;
    if (head === "derived" && tail === undefined) return computed.derived[key];
    if (head === "resource" && tail === "max") return computed.resources[key]?.max;
    return undefined;
  };
}
