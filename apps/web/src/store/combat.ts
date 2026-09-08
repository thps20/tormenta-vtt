import { create } from "zustand";
import type {
  Combat,
  Combatant,
  CombatAddPayload,
  CombatRollPayload,
  CombatSetInitiativePayload,
  CombatSetSurprisedPayload,
  CombatStartPayload,
  Participant,
} from "@tormenta-vtt/shared";
import { emitAck } from "./connection";
import { toast } from "./ui";

interface CombatStoreState {
  state: Combat | null;
  setState: (state: Combat | null) => void;

  // Ações do GM. Todas devolvem o estado completo (visão de quem chamou) no ack e no
  // broadcast; usamos o broadcast (bindSocket.ts). Sem otimismo: a ordem é regra de
  // sistema, calculada no servidor — não vale a pena reimplementar aqui.
  start: (payload: CombatStartPayload) => Promise<boolean>;
  addCombatants: (payload: CombatAddPayload) => Promise<boolean>;
  remove: (combatantIds: string[]) => Promise<boolean>;
  roll: (payload: CombatRollPayload) => Promise<boolean>;
  setInitiative: (payload: CombatSetInitiativePayload) => Promise<boolean>;
  setSurprised: (payload: CombatSetSurprisedPayload) => Promise<boolean>;
  next: () => Promise<boolean>;
  prev: () => Promise<boolean>;
  reorder: (combatantIds: string[]) => Promise<boolean>;
  delay: (combatantId: string) => Promise<boolean>;
  resume: (combatantId: string) => Promise<boolean>;
  end: (clear?: boolean) => Promise<boolean>;
}

async function run<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<boolean> {
  const res = await p;
  if (!res.ok) toast(res.error);
  return res.ok;
}

export const useCombat = create<CombatStoreState>((set) => ({
  state: null,
  setState: (state) => set({ state }),
  start: (payload) => run(emitAck("combat:start", payload)),
  addCombatants: (payload) => run(emitAck("combat:add", payload)),
  remove: (combatantIds) => run(emitAck("combat:remove", { combatantIds })),
  roll: (payload) => run(emitAck("combat:roll", payload)),
  setInitiative: (payload) => run(emitAck("combat:set-initiative", payload)),
  setSurprised: (payload) => run(emitAck("combat:set-surprised", payload)),
  next: () => run(emitAck("combat:next", {})),
  prev: () => run(emitAck("combat:prev", {})),
  reorder: (combatantIds) => run(emitAck("combat:reorder", { combatantIds })),
  delay: (combatantId) => run(emitAck("combat:delay", { combatantId })),
  resume: (combatantId) => run(emitAck("combat:resume", { combatantId })),
  end: (clear) => run(emitAck("combat:end", { clear: clear ?? false })),
}));

/** Combatente que está agindo agora, ou null. O servidor já manda a lista ordenada. */
export function activeCombatant(state: Combat | null): Combatant | null {
  if (!state?.activeCombatantId) return null;
  return state.combatants.find((c) => c.id === state.activeCombatantId) ?? null;
}

/**
 * "É meu" = o token do combatente é meu. Não cobre o caso raro de um token sem dono ligado a
 * uma ficha que é minha (o servidor aceita rolar/adiar nesse caso via `self`/dono da ficha;
 * o cliente não tem essa informação sem consultar characters — ver docs/revisao-combate.md).
 */
function isMine(c: Combatant, me: Participant): boolean {
  return c.ownerId === me.id;
}

/** Meus combatentes que ainda faltam rolar (faixa "Combate iniciado — role sua iniciativa"). */
export function myPendingCombatants(state: Combat | null, me: Participant): Combatant[] {
  if (!state) return [];
  return state.combatants.filter((c) => !c.rolled && isMine(c, me));
}

/** É o meu turno agora? (banner "É o seu turno" + botão Adiar). */
export function isMyTurn(state: Combat | null, me: Participant): boolean {
  const active = activeCombatant(state);
  return active !== null && isMine(active, me);
}
