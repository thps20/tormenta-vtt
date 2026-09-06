/**
 * Valores iniciais de ficha e item a partir da definição do sistema.
 * Usado pelo servidor (character:create) e pelo web (novo item na ficha).
 */
import { CharacterDataSchema, CharacterItemSchema, type CharacterData, type CharacterItem } from "../schemas/character.js";
import type { SystemDefinition } from "../schemas/system.js";

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
  const fields: Record<string, string | number | boolean> = {};
  for (const f of kdef.fields) {
    if (f.default !== undefined) fields[f.key] = f.default;
    else if (f.type === "enum") fields[f.key] = f.options?.[0]?.key ?? "";
    else if (f.type === "number") fields[f.key] = 0;
    else if (f.type === "boolean") fields[f.key] = false;
    else fields[f.key] = "";
  }
  return CharacterItemSchema.parse({
    id,
    kind,
    name: kdef.label,
    fields,
    activation: kdef.hasActivation ? {} : null,
  });
}
