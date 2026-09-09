import { Dna, Flame, GraduationCap, Package, Shield, Skull, Sparkles, Sword, Wand2, type LucideIcon } from "lucide-react";

/** Ícone por POSIÇÃO em itemKinds[] (o código não sabe o que é "classe" ou "arma"). */
const KIND_ICONS: LucideIcon[] = [GraduationCap, Dna, Sword, Shield, Package, Flame, Sparkles, Wand2];

export function kindIcon(index: number): LucideIcon {
  return KIND_ICONS[index % KIND_ICONS.length] ?? Package;
}

/** Ícone de uma entrada de criatura do compêndio (chip "Criaturas", preview, fantasma de arrasto). */
export const creatureIcon: LucideIcon = Skull;
