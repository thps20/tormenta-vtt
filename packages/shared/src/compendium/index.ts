/**
 * Registro dos compêndios por sistema. Só o SERVIDOR importa este módulo (subpath
 * "@tormenta-vtt/shared/compendium"): ele fica fora do index.ts de propósito
 * para o web não empacotar os JSONs, já que o cliente recebe as entradas por
 * socket (compendium:list). Novo sistema = novos JSONs + uma linha em `sources`.
 */
import { CompendiumEntrySchema, type CompendiumEntry, type CompendiumSource } from "../schemas/compendium.js";
import { validateCompendiumEntry } from "../rules/compendium.js";
import { getSystemDefinition } from "../systems.js";
import t20Classes from "../../systems/tormenta20/compendium/classes.json" with { type: "json" };
import t20Races from "../../systems/tormenta20/compendium/races.json" with { type: "json" };
import t20Weapons from "../../systems/tormenta20/compendium/weapons.json" with { type: "json" };
import t20Armor from "../../systems/tormenta20/compendium/armor.json" with { type: "json" };
import t20Spells from "../../systems/tormenta20/compendium/spells.json" with { type: "json" };
import t20Powers from "../../systems/tormenta20/compendium/powers.json" with { type: "json" };

const sources: Record<string, unknown[]> = {
  tormenta20: [t20Classes, t20Races, t20Weapons, t20Armor, t20Spells, t20Powers].flat(),
};
const cache = new Map<string, CompendiumSource>();

/**
 * Valida uma lista bruta de entradas contra o sistema (Zod + coerência com o
 * JSON do sistema + ids únicos). Lança na primeira falha, dizendo qual entrada.
 */
export function validateCompendiumEntries(systemId: string, raw: unknown[]): CompendiumEntry[] {
  const def = getSystemDefinition(systemId);
  const seen = new Set<string>();
  return raw.map((item, index) => {
    const parsed = CompendiumEntrySchema.safeParse(item);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const id = typeof item === "object" && item !== null && "id" in item ? String((item as { id: unknown }).id) : `#${index}`;
      throw new Error(`Compêndio "${systemId}", entrada "${id}": ${first?.path.join(".")} ${first?.message}`);
    }
    const err = validateCompendiumEntry(def, parsed.data);
    if (err) throw new Error(`Compêndio "${systemId}", ${err}`);
    if (seen.has(parsed.data.id)) throw new Error(`Compêndio "${systemId}": id duplicado "${parsed.data.id}"`);
    seen.add(parsed.data.id);
    return parsed.data;
  });
}

/** Compêndio do sistema, validado uma vez e cacheado. Sistema sem compêndio = fonte vazia. */
export function getSystemCompendium(systemId: string): CompendiumSource {
  const cached = cache.get(systemId);
  if (cached) return cached;
  const def = getSystemDefinition(systemId);
  const source: CompendiumSource = {
    id: `system:${systemId}`,
    label: def.name,
    priority: 0,
    entries: validateCompendiumEntries(systemId, sources[systemId] ?? []),
  };
  cache.set(systemId, source);
  return source;
}
