/**
 * Valores iniciais de ficha e item a partir da definição do sistema.
 * Usado pelo servidor (character:create) e pelo web (novo item na ficha).
 */
import { CharacterDataSchema, CharacterItemSchema, type CharacterData, type CharacterItem } from "../schemas/character.js";
import type { SystemDefinition } from "../schemas/system.js";
import { emptyFieldValue } from "./progression.js";

export function createDefaultCharacterData(def: SystemDefinition): CharacterData {
  const attributes = Object.fromEntries(def.attributes.map((a) => [a.key, { base: a.default }]));
  const resources = Object.fromEntries(def.resources.map((r) => [r.key, { current: 0, temp: 0, maxOverride: null }]));
  // Tamanho "neutro": o primeiro com modificador 0, senão o primeiro da lista.
  const size = (def.sizes.find((s) => s.skillModifier === 0) ?? def.sizes[0])?.key ?? null;
  return CharacterDataSchema.parse({ attributes, resources, size });
}

/** Item novo do tipo `kind`, com os campos no default declarado no JSON. */
export function createDefaultItem(def: SystemDefinition, kind: string, id: string): CharacterItem {
  const kdef = def.itemKinds.find((k) => k.key === kind);
  if (!kdef) throw new Error(`Tipo de item desconhecido: ${kind}`);
  const fields: CharacterItem["fields"] = {};
  for (const f of kdef.fields) {
    fields[f.key] = f.default !== undefined ? f.default : emptyFieldValue(def, f);
  }
  // Tipo "arma" no sentido genérico: declara o campo que decide o atributo do dano.
  // Nasce com uma ação de ataque (primeira perícia de ataque) e uma de dano.
  const isWeaponLike = def.damageAttribute !== undefined && kdef.fields.some((f) => f.key === def.damageAttribute?.field);
  const attackSkill = def.attackSkills[0];
  const actions =
    isWeaponLike && attackSkill
      ? [
          { id: `${id}-atk`, label: "Ataque", kind: "attack", skill: attackSkill },
          { id: `${id}-dmg`, label: "Dano", kind: "damage", formula: "1d6" },
        ]
      : [];
  return CharacterItemSchema.parse({
    id,
    kind,
    name: kdef.label,
    fields,
    actions,
    activation: kdef.hasActivation ? {} : null,
  });
}
