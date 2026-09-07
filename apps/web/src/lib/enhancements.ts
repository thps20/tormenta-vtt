import { enhancementEffect, type Enhancement, type EnhancementEffect } from "@tormenta-vtt/shared";

/** Texto curto do efeito mecânico de um aprimoramento ("" para só custo). */
export function describeEffect(e: Pick<Enhancement, "effect">): string {
  const effect = enhancementEffect(e);
  switch (effect.kind) {
    case "costOnly":
      return "";
    case "damageDiceAdd":
      return `+${effect.dice} dano`;
    case "damageSet":
      return `dano = ${effect.formula}`;
  }
}

/** Opções do seletor de efeito no editor da ficha. */
export const EFFECT_KIND_OPTIONS: { value: EnhancementEffect["kind"]; label: string }[] = [
  { value: "costOnly", label: "só custo" },
  { value: "damageDiceAdd", label: "dano +XdY" },
  { value: "damageSet", label: "dano = fórmula" },
];

/** Efeito ao trocar o tipo no editor: mantém o valor quando o tipo é o mesmo, senão começa com "1d6" (o schema não aceita vazio). */
export function effectForKind(kind: EnhancementEffect["kind"], current: EnhancementEffect): EnhancementEffect | undefined {
  if (kind === current.kind) return current;
  if (kind === "costOnly") return undefined;
  if (kind === "damageDiceAdd") return { kind, dice: "1d6" };
  return { kind, formula: "1d6" };
}
