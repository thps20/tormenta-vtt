/**
 * Registro dos sistemas disponíveis. Server e web importam daqui, então os
 * dois leem exatamente a mesma definição (validada uma vez, na primeira chamada).
 * Novo sistema = novo JSON em systems/ + uma linha no `sources` abaixo.
 */
import tormenta20 from "../systems/tormenta20.json" with { type: "json" };
import { validateSystemDefinition, type SystemDefinition } from "./schemas/system.js";

const sources: Record<string, unknown> = { tormenta20 };
const cache = new Map<string, SystemDefinition>();

export function listSystemIds(): string[] {
  return Object.keys(sources);
}

/** Devolve a definição validada ou lança se o id não existir. */
export function getSystemDefinition(id: string): SystemDefinition {
  const cached = cache.get(id);
  if (cached) return cached;
  const raw = sources[id];
  if (raw === undefined) throw new Error(`Sistema desconhecido: "${id}"`);
  const def = validateSystemDefinition(raw);
  cache.set(id, def);
  return def;
}
