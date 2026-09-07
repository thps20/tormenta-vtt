/**
 * Tipo de dano resolvido contra o JSON do sistema: rótulo e cor do selo. A UI
 * nunca lê damageTypes[] direto para pintar; passa por aqui, então a regra
 * "cor própria, senão a do grupo, senão nenhuma" fica num lugar só.
 */
import type { SystemDefinition } from "../schemas/system.js";

export interface DamageTypeInfo {
  key: string;
  /** Rótulo do sistema; a própria chave quando o tipo não existe mais. */
  label: string;
  /** Hex da cor do selo; null = sem cor definida (a UI usa cinza neutro). */
  color: string | null;
  /** false quando a chave não está em damageTypes[] (tipo removido ou vindo de outro sistema). */
  known: boolean;
}

export function damageTypeInfo(def: Pick<SystemDefinition, "damageTypes" | "damageTypeGroups">, key: string): DamageTypeInfo {
  const type = def.damageTypes.find((d) => d.key === key);
  if (!type) return { key, label: key, color: null, known: false };
  const group = type.group !== undefined ? def.damageTypeGroups.find((g) => g.key === type.group) : undefined;
  return { key, label: type.label, color: type.color ?? group?.color ?? null, known: true };
}
