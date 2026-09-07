/**
 * Registro dos compêndios por sistema. Só o SERVIDOR importa este módulo (subpath
 * "@tormenta-vtt/shared/compendium"): ele fica fora do index.ts de propósito
 * para o web não empacotar os JSONs, já que o cliente recebe as entradas por
 * socket (compendium:list).
 *
 * Os arquivos vivem em systems/<id>/compendium/ e são lidos do disco:
 * - `custom.json`: array de entradas editadas à mão (seed confirmado no livro,
 *   ajustes). Tem PRECEDÊNCIA: uma entrada com o mesmo id em outro arquivo é
 *   ignorada.
 * - demais `*.json`: gerados por scripts/import-foundry-compendium.ts, no formato
 *   `{ "$generated": "...", "entries": [...] }` (um array simples também vale).
 * - `descriptions.local.json` (ignorado pelo git): `{ "<id>": "texto" }` com as
 *   descrições; quando existe, preenche `description` das entradas.
 * Novo sistema = nova pasta com JSONs; nada para registrar aqui.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CompendiumEntrySchema, type CompendiumEntry, type CompendiumSource } from "../schemas/compendium.js";
import { validateCompendiumEntry } from "../rules/compendium.js";
import { getSystemDefinition } from "../systems.js";

const systemsDir = fileURLToPath(new URL("../../systems/", import.meta.url));
const cache = new Map<string, CompendiumSource>();

export const CUSTOM_FILE = "custom.json";
export const DESCRIPTIONS_FILE = "descriptions.local.json";

/** Pasta do compêndio de um sistema (pode não existir). */
export function compendiumDir(systemId: string): string {
  return join(systemsDir, systemId, "compendium");
}

/** Lista as entradas brutas de um arquivo do compêndio, aceitando array ou `{ entries }`. */
export function readCompendiumFile(path: string): unknown[] {
  const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "object" && raw !== null && Array.isArray((raw as { entries?: unknown }).entries)) {
    return (raw as { entries: unknown[] }).entries;
  }
  throw new Error(`Compêndio: "${path}" não é um array nem um objeto { entries: [] }`);
}

/** Arquivos de entradas da pasta (sem os `*.local.json`), com custom.json primeiro. */
export function listCompendiumFiles(systemId: string): string[] {
  const dir = compendiumDir(systemId);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".local.json"))
    .sort((a, b) => (a === CUSTOM_FILE ? -1 : b === CUSTOM_FILE ? 1 : a.localeCompare(b)));
  return files.map((f) => join(dir, f));
}

/** Descrições locais (`{ id: texto }`), ou um mapa vazio se o arquivo não existe. */
export function readLocalDescriptions(systemId: string): Record<string, string> {
  const path = join(compendiumDir(systemId), DESCRIPTIONS_FILE);
  if (!existsSync(path)) return {};
  const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`Compêndio: "${path}" deve ser um objeto { id: texto }`);
  const out: Record<string, string> = {};
  for (const [id, text] of Object.entries(raw as Record<string, unknown>)) if (typeof text === "string") out[id] = text;
  return out;
}

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

/**
 * Lê todos os arquivos da pasta aplicando a precedência de custom.json e as
 * descrições locais. Cada arquivo é validado separadamente (o erro diz qual);
 * ids repetidos DENTRO de um arquivo falham, entre arquivos vence custom.json e,
 * fora dele, o primeiro arquivo em ordem alfabética.
 */
export function loadCompendiumEntries(systemId: string): CompendiumEntry[] {
  const descriptions = readLocalDescriptions(systemId);
  const byId = new Map<string, CompendiumEntry>();
  for (const path of listCompendiumFiles(systemId)) {
    let entries: CompendiumEntry[];
    try {
      entries = validateCompendiumEntries(systemId, readCompendiumFile(path));
    } catch (e) {
      throw new Error(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const entry of entries) {
      if (byId.has(entry.id)) continue;
      const description = entry.description || descriptions[entry.id] || "";
      byId.set(entry.id, description === entry.description ? entry : CompendiumEntrySchema.parse({ ...entry, description }));
    }
  }
  return [...byId.values()];
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
    entries: loadCompendiumEntries(systemId),
  };
  cache.set(systemId, source);
  return source;
}
