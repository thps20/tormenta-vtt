/**
 * Encontros salvos (docs/SPEC.md §9.14): expandir uma "receita" (`SavedEncounterEntry[]`, entrada +
 * quantidade) numa lista de posições/nomes prontos para virar Character+Token, continuando a MESMA
 * espiral e a MESMA numeração da cena entre uma entrada e a próxima — assim um encontro com goblins
 * + um xamã solta tudo espalhado, sem uma espécie empilhar em cima da outra. Reaproveita
 * `findFreeCells`/`numberedNames` de `./placement.js`; nenhuma regra de posicionamento nova aqui,
 * só a orquestração de "várias entradas, uma soltura só".
 */
import type { CompendiumCreatureEntry, CompendiumEntry } from "../schemas/compendium.js";
import type { SavedEncounterEntry } from "../schemas/encounter.js";
import type { SystemDefinition } from "../schemas/system.js";
import { findFreeCells, numberedNames, type CellRect } from "./placement.js";

/** Uma criatura pronta para nascer: posição (em células) e nome já numerado. */
export interface EncounterPlacement {
  entryId: string;
  name: string;
  visible: boolean;
  col: number;
  row: number;
  cellsPerSide: number;
}

function resolveCreature(entryId: string, compendiumEntries: CompendiumEntry[]): CompendiumCreatureEntry | null {
  const entry = compendiumEntries.find((e) => e.id === entryId);
  return entry && entry.type === "creature" ? entry : null;
}

function cellsPerSideOf(def: SystemDefinition, creature: CompendiumCreatureEntry): number {
  const sizeDef = def.sizes.find((s) => s.key === creature.sheet.size);
  return Math.max(1, Math.round(sizeDef?.tokenCells ?? 1));
}

/**
 * Expande as entradas de um encontro em posições+nomes, na ordem salva. `occupied`/`existingNames`
 * são as células/nomes já na cena; cada entrada processada entra nelas antes da próxima, então a
 * segunda espécie já pula as células/nomes que a primeira usou. `missingIds` traz os `entryId` que
 * não existem mais no compêndio mesclado (ou deixaram de ser `type: "creature"`) — quem chama solta
 * o resto e avisa, em vez de falhar o encontro inteiro por uma entrada.
 */
export function expandEncounterEntries(opts: {
  encounterEntries: SavedEncounterEntry[];
  compendiumEntries: CompendiumEntry[];
  def: SystemDefinition;
  start: { col: number; row: number };
  occupied: CellRect[];
  existingNames: string[];
  bounds: { cols: number; rows: number };
  maxRadius?: number;
}): { placements: EncounterPlacement[]; missingIds: string[] } {
  const occupied = [...opts.occupied];
  const existingNames = [...opts.existingNames];
  const placements: EncounterPlacement[] = [];
  const missingIds: string[] = [];

  for (const entry of opts.encounterEntries) {
    const creature = resolveCreature(entry.entryId, opts.compendiumEntries);
    if (!creature) {
      missingIds.push(entry.entryId);
      continue;
    }
    const cellsPerSide = cellsPerSideOf(opts.def, creature);
    const positions = findFreeCells({
      start: opts.start,
      cells: cellsPerSide,
      count: entry.count,
      occupied,
      bounds: opts.bounds,
      maxRadius: opts.maxRadius,
    });
    const names = numberedNames(entry.nameOverride ?? creature.name, positions.length, existingNames);

    for (let i = 0; i < positions.length; i++) {
      const point = positions[i]!;
      const name = names[i] ?? creature.name;
      placements.push({ entryId: entry.entryId, name, visible: entry.visibleOnSpawn, col: point.col, row: point.row, cellsPerSide });
      occupied.push({ col: point.col, row: point.row, cells: cellsPerSide });
      existingNames.push(name);
    }
  }

  return { placements, missingIds };
}

/** Um valor de ND (texto livre no sistema): inteiro, ou fração simples "n/m" ("1/4", "1/2"). */
function parseChallengeValue(text: string): number | null {
  const trimmed = text.trim();
  const asNumber = Number(trimmed);
  if (trimmed !== "" && Number.isFinite(asNumber)) return asNumber;
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(trimmed);
  if (m) {
    const num = Number(m[1]);
    const den = Number(m[2]);
    if (den > 0) return num / den;
  }
  return null;
}

/**
 * Soma do ND das entradas de um encontro — só informativo (§9.5), nunca usado em cálculo de regra.
 * Best-effort: `def.creatures.ndField` é texto livre por sistema ("1/4", "1/2", "3", "20"...); um
 * valor que não é inteiro nem fração simples entra em `unparsed` e fica de fora da soma, em vez de
 * inventar zero. `total: null` quando não há nenhum valor somável (sistema sem `creatures`, entrada
 * não encontrada, ou nenhum ND parseável).
 */
export function sumChallengeRating(
  def: SystemDefinition,
  entries: SavedEncounterEntry[],
  compendiumEntries: CompendiumEntry[],
): { total: number | null; unparsed: number } {
  const ndField = def.creatures?.ndField;
  if (!ndField) return { total: null, unparsed: 0 };

  let total = 0;
  let counted = 0;
  let unparsed = 0;
  for (const entry of entries) {
    const creature = resolveCreature(entry.entryId, compendiumEntries);
    const raw = creature?.sheet.traits[ndField];
    const value = typeof raw === "string" ? parseChallengeValue(raw) : null;
    if (value === null) {
      unparsed++;
      continue;
    }
    total += value * entry.count;
    counted++;
  }
  return { total: counted > 0 ? total : null, unparsed };
}
