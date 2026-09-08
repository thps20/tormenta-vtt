/**
 * Regras puras do modo de combate (docs/plano-combate.md): ordenação, desempate,
 * surpresa, avanço de turno. Nenhuma chave de sistema aqui — tudo vem de
 * `SystemDefinition.combat`. Sem I/O: quem persiste é o servidor (services/combat.ts).
 */
import type { Character, CharacterData } from "../schemas/character.js";
import type { SystemDefinition } from "../schemas/system.js";
import { evaluateConstant } from "../dice/index.js";
import { computeCharacter, makeResolver } from "./compute.js";
import { substitutePlaceholders } from "./placeholders.js";

/** Campos mínimos que as funções de ordenação/turno precisam (servem para a linha do banco ou o objeto do fio). */
export interface CombatantCore {
  id: string;
  initiative: number | null;
  bonus: number;
  delayed: boolean;
  surprised: boolean;
  order: number;
}

/**
 * Ordem oficial: quem rolou primeiro (`initiative` desc, depois `combat.tiebreak` na ordem
 * declarada), depois os adiados (mesma ordenação entre si), depois quem não rolou (`order` asc).
 * Delayed sai da rotação de turnos (`canAct` = false) mas continua visível na lista, logo
 * antes dos não-rolados — não desce ao fim junto com "não rolou".
 */
export function sortCombatants<T extends CombatantCore>(def: SystemDefinition, list: T[]): T[] {
  const byValue = (a: T, b: T): number => {
    if (a.initiative !== b.initiative) return (b.initiative ?? 0) - (a.initiative ?? 0);
    for (const criterion of def.combat.tiebreak) {
      if (criterion === "bonus" && a.bonus !== b.bonus) return b.bonus - a.bonus;
      if (criterion === "order" && a.order !== b.order) return a.order - b.order;
    }
    return a.order - b.order;
  };
  const rolled = list.filter((c) => c.initiative !== null);
  const notRolled = list.filter((c) => c.initiative === null).sort((a, b) => a.order - b.order);
  const active = rolled.filter((c) => !c.delayed).sort(byValue);
  const delayed = rolled.filter((c) => c.delayed).sort(byValue);
  return [...active, ...delayed, ...notRolled];
}

/** Pode agir neste turno? Não rolou, está adiado, ou surpreso dentro de `combat.surprise.rounds` = não. */
export function canAct(def: SystemDefinition, c: Pick<CombatantCore, "initiative" | "delayed" | "surprised">, round: number): boolean {
  if (c.initiative === null) return false;
  if (c.delayed) return false;
  if (c.surprised && round <= def.combat.surprise.rounds) return false;
  return true;
}

export interface TurnState {
  activeCombatantId: string | null;
  round: number;
}

/**
 * `status: "rolling" -> "active"`: primeira rodada, ativo = primeiro que pode agir
 * (null se ninguém puder — ex.: todo mundo surpreso — o próximo `combat:next` avança a rodada).
 */
export function startTurns<T extends CombatantCore>(def: SystemDefinition, sorted: T[]): TurnState {
  const round = 1;
  return { activeCombatantId: sorted.find((c) => canAct(def, c, round))?.id ?? null, round };
}

/**
 * Anda na lista JÁ ORDENADA (`sortCombatants`) pulando quem não pode agir. Ao passar do
 * último, a rodada avança e volta ao primeiro (`dir = -1` faz o inverso, rodada mínima 1).
 * `sorted` vazia, ou ninguém consegue agir depois de percorrer a lista inteira algumas vezes
 * (ex.: todos surpresos): devolve `activeCombatantId: null` em vez de travar.
 * `skipIds` trata esses ids como "não pode agir" mesmo que passassem em `canAct` — usado por
 * `stateAfterRemoval` para achar quem assume quando o ativo é removido (ver mais abaixo).
 */
export function advanceTurn<T extends CombatantCore>(
  def: SystemDefinition,
  sorted: T[],
  state: TurnState,
  dir: 1 | -1,
  skipIds?: ReadonlySet<string>,
): TurnState {
  const n = sorted.length;
  if (n === 0) return { activeCombatantId: null, round: state.round };

  let idx = state.activeCombatantId ? sorted.findIndex((c) => c.id === state.activeCombatantId) : -1;
  let round = state.round;
  // Limite generoso: uma volta completa por rodada de surpresa, +1 pra garantir que sobra
  // pelo menos uma passada normal depois que a surpresa parar de valer.
  const maxSteps = n * (def.combat.surprise.rounds + 2);

  for (let i = 0; i < maxSteps; i++) {
    if (dir === 1) {
      if (idx + 1 >= n) {
        idx = 0;
        round += 1;
      } else {
        idx += 1;
      }
    } else {
      if (idx <= 0) {
        idx = n - 1;
        round = Math.max(1, round - 1);
      } else {
        idx -= 1;
      }
    }
    const candidate = sorted[idx];
    if (candidate && !skipIds?.has(candidate.id) && canAct(def, candidate, round)) return { activeCombatantId: candidate.id, round };
  }
  return { activeCombatantId: null, round };
}

/**
 * Estado do turno depois de remover um ou mais combatentes (`combat:remove`, ou o cascade de
 * `token:delete`). Se o ativo não está entre os removidos, nada muda. Se está, quem assume é
 * quem agiria em seguida — calculado ANTES da remoção (`combatants` ainda os inclui), pulando
 * também os outros ids removidos no mesmo lote — então o resultado sempre aponta para alguém
 * que continua no combate.
 */
export function stateAfterRemoval<T extends CombatantCore>(
  def: SystemDefinition,
  combatants: T[],
  state: TurnState,
  removedIds: ReadonlySet<string>,
): TurnState {
  if (!state.activeCombatantId || !removedIds.has(state.activeCombatantId)) return state;
  const sorted = sortCombatants(def, combatants);
  return advanceTurn(def, sorted, state, 1, removedIds);
}

/** Renumera `order` em 0..n-1 seguindo a ordem da lista recebida. Roda depois de todo add/remove/reorder/resume. */
export function normalizeOrder<T extends { order: number }>(list: T[]): T[] {
  return list.map((c, i) => ({ ...c, order: i }));
}

/**
 * Adiado "entra agora": copia `initiative`/`bonus` de quem está agindo e recebe `order`
 * imediatamente antes dele (assim, quando o turno dele passar, cai justamente em quem foi
 * interrompido). Devolve a lista com `order` renumerado; quem chama ainda precisa apontar
 * `activeCombatantId` para o combatente que retomou — ele age NA HORA, não só "é o próximo".
 */
export function resumePlacement<T extends CombatantCore>(sorted: T[], activeCombatantId: string, resumeId: string): T[] {
  const active = sorted.find((c) => c.id === activeCombatantId);
  const resuming = sorted.find((c) => c.id === resumeId);
  if (!active || !resuming) return sorted;

  const updatedResuming: T = { ...resuming, initiative: active.initiative, bonus: active.bonus, delayed: false };
  const rest = sorted.filter((c) => c.id !== resumeId);
  const activeIdx = rest.findIndex((c) => c.id === activeCombatantId);
  const spliced = [...rest.slice(0, activeIdx), updatedResuming, ...rest.slice(activeIdx)];
  return normalizeOrder(spliced);
}

/** Bônus de desempate (sem dado) de quem tem ficha vinculada — gravado em Combatant.bonus ao entrar no combate. */
export function characterTiebreakBonus(def: SystemDefinition, character: Character | CharacterData): number {
  const computed = computeCharacter(def, character);
  const formula = substitutePlaceholders(def.combat.tiebreakBonus, makeResolver(computed));
  return evaluateConstant(formula);
}

/** Fórmula de iniciativa de token SEM ficha vinculada: só `{bonus}` (digitado pelo GM) é resolvido. */
export function noSheetInitiativeFormula(def: SystemDefinition, bonus: number): string {
  return substitutePlaceholders(def.combat.initiativeNoSheet, (p) => (p === "bonus" ? bonus : undefined));
}
