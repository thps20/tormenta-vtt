import React from "react";
import { damageTypeInfo, type DamageComponent, type EnhancementEffect, type SystemDefinition } from "@tormenta-vtt/shared";

type DefLike = Pick<SystemDefinition, "damageTypes" | "damageTypeGroups"> | null;

/** Cor do selo quando o sistema não define uma (zinc-400). */
const NEUTRAL = "#a1a1aa";

interface DamageTypeBadgeProps {
  /** Definição do sistema (null fora de uma sala: o selo sai neutro com a chave como texto). */
  def: DefLike;
  /** Chave em damageTypes[]; null = sem tipo, não renderiza nada. */
  type: string | null;
  className?: string;
}

/**
 * Selo colorido de um tipo de dano: fundo com a cor a ~20% e texto na cor cheia
 * (funciona sobre o tema escuro). A cor vem do JSON do sistema via damageTypeInfo
 * (própria, senão a do grupo); sem cor definida, cinza neutro.
 */
export const DamageTypeBadge: React.FC<DamageTypeBadgeProps> = ({ def, type, className }) => {
  if (type === null) return null;
  const info = def ? damageTypeInfo(def, type) : { label: type, color: null };
  const color = info.color ?? NEUTRAL;
  return (
    <span
      className={`inline-flex items-center px-1.5 py-px rounded text-[10px] font-serif font-semibold leading-tight whitespace-nowrap align-middle ${className ?? ""}`}
      // Hex de 8 dígitos: "33" = ~20% de opacidade.
      style={{ backgroundColor: `${color}33`, color }}
      data-damage-type={type}
    >
      {info.label}
    </span>
  );
};

interface DamageFormulaProps {
  def: DefLike;
  /** Parcelas por tipo, na ordem base → extras. */
  components: Pick<DamageComponent, "formula" | "damageType">[];
}

/** "6d6 + 1 [Fogo] + 4d6 [Frio]": cada parcela com o selo do seu tipo, separadas por " + ". */
export const DamageFormula: React.FC<DamageFormulaProps> = ({ def, components }) => (
  <>
    {components.map((c, i) => (
      <React.Fragment key={i}>
        {i > 0 && " + "}
        <span>{c.formula}</span>
        {c.damageType !== null && (
          <>
            {" "}
            <DamageTypeBadge def={def} type={c.damageType} />
          </>
        )}
      </React.Fragment>
    ))}
  </>
);

/** Selo do tipo de dano de um efeito damageDiceAdd com tipo próprio; nada nos demais (o extra herda o tipo da ação). */
export const EffectDamageType: React.FC<{ def: DefLike; effect: EnhancementEffect }> = ({ def, effect }) =>
  effect.kind === "damageDiceAdd" && effect.damageType !== undefined ? <DamageTypeBadge def={def} type={effect.damageType} className="shrink-0" /> : null;
