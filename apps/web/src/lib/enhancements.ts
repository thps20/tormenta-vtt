import { enhancementEffect, type Enhancement, type EnhancementEffect, type EnhancementEffectKind, type SystemDefinition } from "@tormenta-vtt/shared";

type DefLike = Pick<SystemDefinition, "activation">;

const optionLabel = (options: { key: string; label: string }[], key: string): string => options.find((o) => o.key === key)?.label ?? key;
const withValue = (value: number | undefined, label: string): string => (value !== undefined && value > 0 ? `${value} ${label}` : label);
const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

/**
 * Texto curto do que a automação fará com o efeito ("+1d6 dano", "CD +2",
 * "alcance Longo (90 m)"). "" quando não há automação: só custo ou descritivo
 * (ver isManualEffect). Rótulos de unidade e tipo vêm do JSON do sistema.
 */
export function describeEffect(def: DefLike, e: Pick<Enhancement, "effect">): string {
  const effect = enhancementEffect(e);
  switch (effect.kind) {
    case "costOnly":
    case "text":
      return "";
    case "damageDiceAdd":
      // Com tipo próprio, o selo colorido ao lado diz o tipo (EffectDamageType), então aqui só os dados.
      return effect.damageType === undefined ? `+${effect.dice} dano` : `+${effect.dice}`;
    case "damageSet":
      return `dano = ${effect.formula}`;
    case "healDiceAdd":
      return `+${effect.dice} cura`;
    case "dcAdd":
      return `CD ${signed(effect.value)}`;
    case "attackBonusAdd":
      return `ataque ${signed(effect.value)}`;
    case "rangeSet":
      return `alcance ${withValue(effect.value, optionLabel(def.activation.rangeUnits, effect.units))}`;
    case "durationSet":
      return `duração ${withValue(effect.value, optionLabel(def.activation.durationUnits, effect.units))}`;
    case "areaSet":
      return `área ${effect.text || "—"}`;
    case "targetsAdd":
      return `+${effect.count} alvo${effect.count > 1 ? "s" : ""}`;
  }
}

/** true quando o efeito não automatiza nada (só custo ou descritivo): o jogador aplica à mão. */
export const isManualEffect = (e: Pick<Enhancement, "effect">): boolean => {
  const kind = enhancementEffect(e).kind;
  return kind === "costOnly" || kind === "text";
};

/** Opções do seletor de efeito no editor da ficha. Alcance/duração só quando o sistema tem unidades para escolher. */
export function effectKindOptions(def: DefLike): { value: EnhancementEffectKind; label: string }[] {
  const all: { value: EnhancementEffectKind; label: string }[] = [
    { value: "costOnly", label: "só custo" },
    { value: "damageDiceAdd", label: "dano +XdY" },
    { value: "damageSet", label: "dano = fórmula" },
    { value: "healDiceAdd", label: "cura +XdY" },
    { value: "dcAdd", label: "CD +N" },
    { value: "attackBonusAdd", label: "ataque +N" },
    { value: "rangeSet", label: "alcance =" },
    { value: "durationSet", label: "duração =" },
    { value: "areaSet", label: "área =" },
    { value: "targetsAdd", label: "+N alvos" },
    { value: "text", label: "descritivo" },
  ];
  return all.filter((o) => (o.value === "rangeSet" ? def.activation.rangeUnits.length > 0 : o.value === "durationSet" ? def.activation.durationUnits.length > 0 : true));
}

/**
 * Efeito ao trocar o tipo no editor: mantém o valor quando o tipo é o mesmo,
 * senão começa com um valor válido para o schema (dados "1d6", número 1,
 * primeira unidade do sistema, texto vazio).
 */
export function effectForKind(def: DefLike, kind: EnhancementEffectKind, current: EnhancementEffect): EnhancementEffect | undefined {
  if (kind === current.kind) return current;
  switch (kind) {
    case "costOnly":
      return undefined;
    case "damageDiceAdd":
      return { kind, dice: "1d6" };
    case "damageSet":
      return { kind, formula: "1d6" };
    case "healDiceAdd":
      return { kind, dice: "1d8" };
    case "dcAdd":
    case "attackBonusAdd":
      return { kind, value: 1 };
    case "rangeSet":
      return { kind, units: def.activation.rangeUnits[0]?.key ?? "" };
    case "durationSet":
      return { kind, units: def.activation.durationUnits[0]?.key ?? "" };
    case "areaSet":
    case "text":
      return { kind, text: "" };
    case "targetsAdd":
      return { kind, count: 1 };
  }
}
