/**
 * computeCharacter: função PURA que transforma as entradas da ficha nos valores
 * finais (atributos com bônus, total de cada perícia, stats derivados, máximo
 * dos recursos). Servidor e cliente rodam a mesma função; o cliente só para
 * exibir, o servidor para montar rolagens.
 *
 * Ordem (cada etapa só depende das anteriores):
 *   classes → nível → modificadores (da ficha + dos itens) → atributos
 *   → equip (itens equipados) → perícias (com as concedidas por itens)
 *   → derivados → recursos (por nível de classe, quando as classes mandam).
 * Erros de fórmula não derrubam a ficha: viram `warnings` e o valor fica 0.
 */
import { DiceParseError, evaluateConstant } from "../dice/index.js";
import type { Character, CharacterData, CharacterSkill } from "../schemas/character.js";
import type { SizeDef, SkillDef, SystemDefinition } from "../schemas/system.js";
import { FormulaError, substitutePlaceholders } from "./placeholders.js";
import { parseModifierTarget, type ModifierTarget } from "./modifierTarget.js";
import { itemModifiers, listClasses, perLevelMax, skillGrants, type ClassEntry, type ItemModifier } from "./progression.js";

export interface ComputedSkill {
  key: string;
  label: string;
  /** Atributo efetivamente usado. */
  attribute: string;
  trained: boolean;
  /** Id do item que concede o treino (null = marcado na ficha ou não treinada). */
  grantedBy: string | null;
  /** false quando a perícia exige treino e o personagem não é treinado. */
  usable: boolean;
  total: number;
}

export interface ComputedResource {
  max: number;
  min: number;
  /** Conta do máximo em texto quando veio das classes; null quando digitado ou por fórmula. */
  detail: string | null;
}

export interface ComputedCharacter {
  level: number;
  /** "classes" = nível e recursos por nível vêm dos itens de classe; "manual" = digitados. */
  levelSource: "classes" | "manual";
  classes: ClassEntry[];
  halfLevel: number;
  trainedBonus: number;
  attributes: Record<string, number>;
  /** Modificadores gerados por itens ativos (raça etc.), já somados em `attributes`. */
  itemModifiers: ItemModifier[];
  equip: Record<string, number>;
  /** Campos number do item de raça ativo, já com o default de quem não tem raça (ver computeRace). */
  race: Record<string, number>;
  skills: Record<string, ComputedSkill>;
  derived: Record<string, number>;
  resources: Record<string, ComputedResource>;
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

/**
 * Campos NUMBER do item de raça ATIVO (def.race.kind), pra "{race.<campo>}" nas fórmulas
 * (docs/plano-movimento.md: derived.movement lê {race.movement}). Campo ausente no item, ou ficha
 * sem esse item (sem raça escolhida): cai no `default` do campo no itemKinds (0 se não houver) —
 * mesmo espírito de computeEquip acima, sem raça = usa o default declarado no sistema.
 */
function computeRace(def: SystemDefinition, data: CharacterData): Record<string, number> {
  const out: Record<string, number> = {};
  if (!def.race) return out;
  const kind = def.itemKinds.find((k) => k.key === def.race?.kind);
  if (!kind) return out;
  const item = data.items.find((i) => i.kind === kind.key);
  for (const field of kind.fields) {
    if (field.type !== "number") continue;
    const fallback = typeof field.default === "number" ? field.default : 0;
    const raw = item?.fields[field.key];
    out[field.key] = typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
  }
  return out;
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

  // Classes e nível: as classes mandam quando o sistema diz, há ao menos uma e a ficha não está em modo manual.
  const classes = listClasses(def, data);
  const usesClasses = def.level.source === "classes" && classes.length > 0 && !data.manualProgression;
  const rawLevel = usesClasses ? classes.reduce((acc, c) => acc + c.levels, 0) : data.level;
  const level = Math.max(0, Math.min(def.level.max, rawLevel));
  const halfLevel = Math.floor(level / 2);
  const trainedBonus = trainedBonusFor(def, level);

  // Modificadores da ficha + os gerados por itens ativos (raça, equipamento com bônus de atributo).
  const fromItems = itemModifiers(def, data);
  const mods: ParsedModifier[] = [...parseModifiers(data)];
  for (const m of fromItems) {
    const target = parseModifierTarget(m.target);
    if (target) mods.push({ target, value: m.value });
  }
  const grants = skillGrants(def, data);

  // Atributos: base (ou default do sistema) + modificadores.
  const attributes: Record<string, number> = {};
  for (const a of def.attributes) {
    const base = data.attributes[a.key]?.base ?? a.default;
    attributes[a.key] = base + sumModifiers(mods, (t) => t.kind === "attr" && t.key === a.key);
  }

  const equip = computeEquip(def, data);
  const race = computeRace(def, data);
  const size: SizeDef | undefined = def.sizes.find((s) => s.key === data.size);
  const spellcastingAttr = data.spellcastingAttribute ? (attributes[data.spellcastingAttribute] ?? 0) : 0;

  // Resolvedor global: o que qualquer fórmula pode usar (skills/derived/resources
  // entram conforme vão sendo calculados).
  const skills: Record<string, ComputedSkill> = {};
  const derived: Record<string, number> = {};
  const resources: Record<string, ComputedResource> = {};
  const resolveGlobal = (path: string): number | undefined => {
    if (path === "level") return level;
    if (path === "halfLevel") return halfLevel;
    if (path === "trainedBonus") return trainedBonus;
    if (path === "spellcastingAttr") return spellcastingAttr;
    const [head, key, tail] = path.split(".");
    if (key === undefined) return undefined;
    if (head === "attr" && tail === undefined) return attributes[key];
    if (head === "equip" && tail === undefined) return equip[key];
    if (head === "race" && tail === undefined) return race[key];
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
    // Treino marcado na ficha ou concedido por um item (classe, raça).
    const grant = cs.trained ? undefined : grants.get(key);
    const trained = cs.trained || grant !== undefined;
    const resolve = (path: string): number | undefined => {
      switch (path) {
        case "attr":
          return attributes[attrKey] ?? 0;
        case "trained":
          return trained ? trainedBonus : 0;
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
      trained,
      grantedBy: grant?.itemId ?? null,
      usable: !sdef.trainedOnly || trained,
      total: base + cs.other + bonus,
    };
  }

  // Derivados, na ordem do JSON (um pode usar o anterior).
  for (const d of def.derived) {
    const override = d.editable ? data.derivedOverrides[d.key] : undefined;
    const base = override ?? safeEval(d.formula, resolveGlobal, `derivado ${d.key}`, warnings);
    derived[d.key] = base + sumModifiers(mods, (t) => t.kind === "derived" && t.key === d.key);
  }

  // Recursos: por nível de classe (quando as classes mandam e o recurso tem perLevel),
  // senão máximo digitado ou por fórmula; + modificadores; mínimo por fórmula.
  for (const r of def.resources) {
    const cr = data.resources[r.key];
    let baseMax: number;
    let detail: string | null = null;
    if (usesClasses && r.perLevel) {
      const byLevel = perLevelMax(def, r, classes, data, attributes);
      baseMax = byLevel.max;
      detail = byLevel.detail;
    } else {
      baseMax = cr?.maxOverride ?? (r.maxFormula ? safeEval(r.maxFormula, resolveGlobal, `recurso ${r.key}`, warnings) : 0);
    }
    const max = baseMax + sumModifiers(mods, (t) => t.kind === "resourceMax" && t.key === r.key);
    const min = r.minFormula
      ? safeEval(r.minFormula, (p) => (p === "max" ? max : resolveGlobal(p)), `recurso ${r.key} (mín.)`, warnings)
      : 0;
    resources[r.key] = { max, min, detail };
  }

  return {
    level,
    levelSource: usesClasses ? "classes" : "manual",
    classes,
    halfLevel,
    trainedBonus,
    attributes,
    itemModifiers: fromItems,
    equip,
    race,
    skills,
    derived,
    resources,
    warnings,
  };
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
    if (head === "race" && tail === undefined) return computed.race[key];
    if (head === "skill" && tail === undefined) return computed.skills[key]?.total;
    if (head === "derived" && tail === undefined) return computed.derived[key];
    if (head === "resource" && tail === "max") return computed.resources[key]?.max;
    return undefined;
  };
}
