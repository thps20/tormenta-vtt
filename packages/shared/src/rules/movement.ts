/**
 * Regras puras do orçamento de deslocamento por turno (docs/plano-movimento.md). Sem I/O: o
 * servidor valida e persiste (apps/server/src/services/movement.ts), o web desenha o mesmo cálculo
 * ao vivo (preview de arraste/teclado, barra do painel) — as duas pontas rodam estas funções, nunca
 * reimplementam a conta. Tudo em CÉLULAS na entrada; a saída já converte para a unidade do jogo
 * (grid.cellSize) quando o sistema declara `movement`.
 */
import { measureCellsFrom } from "./measure.js";
import type { SystemDefinition } from "../schemas/system.js";

type MovementSystem = Pick<SystemDefinition, "movement" | "grid">;

/** Estado de deslocamento de UM combatente no turno atual. */
export interface MovementState {
  /** Gasto acumulado, na unidade do jogo (m em T20). */
  used: number;
  /** Diagonais já contadas no turno (regra 1-2-1, ver measureCellsFrom). */
  diagonals: number;
}

export const EMPTY_MOVEMENT: MovementState = { used: 0, diagonals: 0 };

/**
 * Modificador de orçamento de deslocamento. Nada no sistema gera isto ainda (é o gancho para
 * condições como Lento/Imóvel automatizarem o efeito depois, docs/plano-movimento.md — fora deste
 * plano): `computeMovementBudget` já aceita a lista, só ninguém a preenche por enquanto.
 */
export type MovementModifier =
  | { kind: "set"; value: number } // define a base (forma alternativa, montaria)
  | { kind: "add"; value: number } // +3 m
  | { kind: "multiply"; value: number } // 0.5 = metade (Lento)
  | { kind: "block" }; // 0 (Imóvel)

/** Orçamento final: aplica `modifiers` na ordem set → add → multiply → block; nunca negativo. */
export function computeMovementBudget(base: number, modifiers: MovementModifier[]): number {
  let value = base;
  for (const m of modifiers) {
    switch (m.kind) {
      case "set":
        value = m.value;
        break;
      case "add":
        value += m.value;
        break;
      case "multiply":
        value *= m.value;
        break;
      case "block":
        value = 0;
        break;
    }
  }
  return Math.max(0, value);
}

/**
 * Base do orçamento antes de modificadores: override do GM (`combat:set-movement`) → `derived` da
 * ficha vinculada → `movement.default` do sistema (token sem ficha). `null` = sistema sem regra de
 * deslocamento (`movement` ausente): quem chama sabe que não deve mostrar barra/caminho/bloqueio.
 */
export function movementBase(def: MovementSystem, opts: { override?: number | null; derived?: Record<string, number> | null }): number | null {
  if (!def.movement) return null;
  if (opts.override !== undefined && opts.override !== null) return opts.override;
  const fromSheet = opts.derived?.[def.movement.derived];
  return fromSheet !== undefined ? fromSheet : def.movement.default;
}

/** Regra de diagonais que vale para o movimento: `movement.diagonals`, senão `grid.diagonals` (D1). */
function diagonalRule(def: MovementSystem) {
  return def.movement?.diagonals ?? def.grid?.diagonals ?? "chebyshev";
}

/** Custo (na unidade do jogo) de andar (dxCells, dyCells) a partir do estado atual do turno — e as
 *  diagonais que esse passo somaria, pra `applyStep` acumular certo. `null` sem `movement`/`grid`
 *  (não dá pra converter célula em metro). */
export function stepCost(def: MovementSystem, state: MovementState, dxCells: number, dyCells: number): { cost: number; diagonals: number } | null {
  if (!def.movement || !def.grid) return null;
  const measured = measureCellsFrom(dxCells, dyCells, diagonalRule(def), state.diagonals);
  return { cost: measured.cells * def.grid.cellSize, diagonals: measured.diagonals };
}

/** Estado depois de confirmar um passo (dxCells, dyCells) — soma ao gasto e às diagonais do turno. */
export function applyStep(def: MovementSystem, state: MovementState, dxCells: number, dyCells: number): MovementState {
  const step = stepCost(def, state, dxCells, dyCells);
  if (!step) return state;
  return { used: state.used + step.cost, diagonals: step.diagonals };
}

/** Epsilon para comparar floats de deslocamento (a regra `euclidean` gera irracionais). */
const EPSILON = 1e-6;

/** Quanto ainda cabe no turno (nunca negativo). */
export function movementRemaining(budget: number, state: MovementState): number {
  return Math.max(0, budget - state.used);
}

/** O próximo passo (dxCells, dyCells) cabe no orçamento? */
export function fitsInBudget(def: MovementSystem, budget: number, state: MovementState, dxCells: number, dyCells: number): boolean {
  const step = stepCost(def, state, dxCells, dyCells);
  if (!step) return true;
  return step.cost <= movementRemaining(budget, state) + EPSILON;
}
