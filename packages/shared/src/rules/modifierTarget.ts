/**
 * Alvo de um modificador: um seletor textual validado por regex.
 * O código interpreta a FORMA do seletor sem conhecer nenhuma chave concreta
 * (as chaves vêm do JSON do sistema e da ficha).
 *
 *   attr.<key>            valor de um atributo
 *   skill.<key>           uma perícia (aceita variante: skill.oficio:alquimia)
 *   skill.*               todas as perícias
 *   skill[tag=<tag>]      perícias com a tag (ex.: skill[tag=resistencia])
 *   derived.<key>         stat derivado (Defesa, CD...)
 *   resource.<key>.max    máximo de um recurso (PV, PM...)
 *   attack                todas as rolagens de ataque
 *   attack.<skill>        ataques feitos com a perícia
 *   damage                todo dano
 *   damage.<skill>        dano de ataques feitos com a perícia
 */
import { z } from "zod";
import type { SystemDefinition } from "../schemas/system.js";

const KEY = "[a-z][a-zA-Z0-9_]*";
const SKILL_KEY = `${KEY}(?::[a-z0-9_]+)?`;

export const MODIFIER_TARGET_RE = new RegExp(
  `^(?:attr\\.${KEY}|skill\\.(?:\\*|${SKILL_KEY})|skill\\[tag=${KEY}\\]|derived\\.${KEY}|resource\\.${KEY}\\.max|attack(?:\\.${SKILL_KEY})?|damage(?:\\.${SKILL_KEY})?)$`,
);

export const ModifierTargetSchema = z
  .string()
  .regex(MODIFIER_TARGET_RE, "Alvo inválido (ex.: attr.for, skill.luta, skill[tag=ataque], derived.defense, resource.pv.max, attack, damage.luta)");

export type ModifierTarget =
  | { kind: "attr"; key: string }
  | { kind: "skill"; key: string }
  | { kind: "skillAll" }
  | { kind: "skillTag"; tag: string }
  | { kind: "derived"; key: string }
  | { kind: "resourceMax"; key: string }
  | { kind: "attack"; skill: string | null }
  | { kind: "damage"; skill: string | null };

/** Converte o seletor em estrutura. Devolve null se não casar com a gramática. */
export function parseModifierTarget(target: string): ModifierTarget | null {
  if (!MODIFIER_TARGET_RE.test(target)) return null;
  const tag = /^skill\[tag=(.+)\]$/.exec(target);
  if (tag) return { kind: "skillTag", tag: tag[1] ?? "" };
  if (target === "skill.*") return { kind: "skillAll" };
  const [head, ...rest] = target.split(".");
  const key = rest.join(".");
  switch (head) {
    case "attr":
      return { kind: "attr", key };
    case "skill":
      return { kind: "skill", key };
    case "derived":
      return { kind: "derived", key };
    case "resource":
      return { kind: "resourceMax", key: rest[0] ?? "" };
    case "attack":
      return { kind: "attack", skill: key || null };
    case "damage":
      return { kind: "damage", skill: key || null };
    default:
      return null;
  }
}

/** Rótulo legível para a UI, usando os labels do JSON do sistema. */
export function describeModifierTarget(target: string, def: SystemDefinition): string {
  const t = parseModifierTarget(target);
  if (!t) return target;
  const skillLabel = (key: string) => {
    const [base, variant] = key.split(":");
    const label = def.skills.find((s) => s.key === base)?.label ?? key;
    return variant ? `${label} (${variant})` : label;
  };
  switch (t.kind) {
    case "attr":
      return def.attributes.find((a) => a.key === t.key)?.label ?? target;
    case "skill":
      return skillLabel(t.key);
    case "skillAll":
      return "Todas as perícias";
    case "skillTag":
      return `Perícias [${t.tag}]`;
    case "derived":
      return def.derived.find((d) => d.key === t.key)?.label ?? target;
    case "resourceMax":
      return `${def.resources.find((r) => r.key === t.key)?.label ?? t.key} (máx.)`;
    case "attack":
      return t.skill ? `Ataque (${skillLabel(t.skill)})` : "Ataque";
    case "damage":
      return t.skill ? `Dano (${skillLabel(t.skill)})` : "Dano";
  }
}

/** Lista de alvos válidos para o sistema (para um <select> na UI). */
export function listModifierTargets(def: SystemDefinition): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  for (const a of def.attributes) out.push({ value: `attr.${a.key}`, label: a.label });
  out.push({ value: "skill.*", label: "Todas as perícias" });
  const tags = new Set(def.skills.flatMap((s) => s.tags));
  for (const tag of tags) out.push({ value: `skill[tag=${tag}]`, label: `Perícias [${tag}]` });
  for (const s of def.skills) if (!s.variants) out.push({ value: `skill.${s.key}`, label: s.label });
  for (const d of def.derived) out.push({ value: `derived.${d.key}`, label: d.label });
  for (const r of def.resources) out.push({ value: `resource.${r.key}.max`, label: `${r.label} (máx.)` });
  out.push({ value: "attack", label: "Ataque" });
  out.push({ value: "damage", label: "Dano" });
  for (const key of def.attackSkills) {
    const label = def.skills.find((s) => s.key === key)?.label ?? key;
    out.push({ value: `attack.${key}`, label: `Ataque (${label})` });
    out.push({ value: `damage.${key}`, label: `Dano (${label})` });
  }
  return out;
}
