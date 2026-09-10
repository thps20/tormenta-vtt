import { create } from "zustand";
import type {
  Combat,
  Combatant,
  CombatAddPayload,
  CombatRollPayload,
  CombatSetInitiativePayload,
  CombatSetMovementLimitPayload,
  CombatSetMovementPayload,
  CombatSetSurprisedPayload,
  CombatStartPayload,
  Participant,
  Token,
} from "@tormenta-vtt/shared";
import { emitAck } from "./connection";
import { toast } from "./ui";

/**
 * Combate por mapa (docs/plano-mapas.md §7): não existe mais "o combate da sala" — cada mapa tem o
 * seu, e mais de um pode estar rolando ao mesmo tempo (ativar outro mapa não encerra o anterior).
 * `byScene[sceneId]` = combate daquele mapa (`undefined` = nunca chegou nenhum; `null` = chegou e
 * não há combate ali). Componentes leem o do mapa que estão VENDO (`selectViewedScene`, store/room.ts).
 */
interface CombatStoreState {
  byScene: Record<string, Combat | null>;
  setSceneState: (sceneId: string, combat: Combat | null) => void;
  /** room:join / leave: substitui tudo (só a cena ativa vem no snapshot; as demais o GM carrega ao visitar). */
  setSnapshot: (activeSceneId: string | null, combat: Combat | null) => void;

  // Ações do GM. Todas devolvem o estado completo (visão de quem chamou) no ack e no
  // broadcast; usamos o broadcast (bindSocket.ts). Sem otimismo: a ordem é regra de
  // sistema, calculada no servidor — não vale a pena reimplementar aqui.
  start: (payload: CombatStartPayload) => Promise<boolean>;
  addCombatants: (payload: CombatAddPayload) => Promise<boolean>;
  remove: (sceneId: string, combatantIds: string[]) => Promise<boolean>;
  roll: (payload: CombatRollPayload) => Promise<boolean>;
  setInitiative: (payload: CombatSetInitiativePayload) => Promise<boolean>;
  setSurprised: (payload: CombatSetSurprisedPayload) => Promise<boolean>;
  next: (sceneId: string) => Promise<boolean>;
  prev: (sceneId: string) => Promise<boolean>;
  reorder: (sceneId: string, combatantIds: string[]) => Promise<boolean>;
  delay: (sceneId: string, combatantId: string) => Promise<boolean>;
  resume: (sceneId: string, combatantId: string) => Promise<boolean>;
  end: (sceneId: string, clear?: boolean) => Promise<boolean>;
  /** GM: ajusta orçamento/gasto de deslocamento de um combatente à mão (docs/plano-movimento.md). */
  setMovement: (payload: CombatSetMovementPayload) => Promise<boolean>;
  /** GM: liga/desliga a trava de deslocamento na sala. */
  setMovementLimit: (payload: CombatSetMovementLimitPayload) => Promise<boolean>;
}

async function run<T>(p: Promise<{ ok: true; data: T } | { ok: false; error: string }>): Promise<boolean> {
  const res = await p;
  if (!res.ok) toast(res.error);
  return res.ok;
}

export const useCombat = create<CombatStoreState>((set) => ({
  byScene: {},
  setSceneState: (sceneId, combat) => set((s) => ({ byScene: { ...s.byScene, [sceneId]: combat } })),
  setSnapshot: (activeSceneId, combat) => set({ byScene: activeSceneId ? { [activeSceneId]: combat } : {} }),
  start: (payload) => run(emitAck("combat:start", payload)),
  addCombatants: (payload) => run(emitAck("combat:add", payload)),
  remove: (sceneId, combatantIds) => run(emitAck("combat:remove", { sceneId, combatantIds })),
  roll: (payload) => run(emitAck("combat:roll", payload)),
  setInitiative: (payload) => run(emitAck("combat:set-initiative", payload)),
  setSurprised: (payload) => run(emitAck("combat:set-surprised", payload)),
  next: (sceneId) => run(emitAck("combat:next", { sceneId })),
  prev: (sceneId) => run(emitAck("combat:prev", { sceneId })),
  reorder: (sceneId, combatantIds) => run(emitAck("combat:reorder", { sceneId, combatantIds })),
  delay: (sceneId, combatantId) => run(emitAck("combat:delay", { sceneId, combatantId })),
  resume: (sceneId, combatantId) => run(emitAck("combat:resume", { sceneId, combatantId })),
  end: (sceneId, clear) => run(emitAck("combat:end", { sceneId, clear: clear ?? false })),
  setMovement: (payload) => run(emitAck("combat:set-movement", payload)),
  setMovementLimit: (payload) => run(emitAck("combat:set-movement-limit", payload)),
}));

/** Combate do mapa `sceneId` (ou null se nunca chegou nenhum). Função pura para useMemo. */
export function sceneCombat(byScene: Record<string, Combat | null>, sceneId: string | null | undefined): Combat | null {
  if (!sceneId) return null;
  return byScene[sceneId] ?? null;
}

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

/**
 * Pode mover este token AGORA (teclado ou arraste)? Espelha `checkMovement` do servidor
 * (docs/plano-movimento.md §2.2/§3.2) — o servidor decide de novo, isto é só pra UI não deixar
 * começar um arraste/passo que ele vai recusar. Sem combate ativo, ou token fora da lista de
 * combatentes (D3): sempre "ok". Combatente da vez: "ok". Senão: GM sempre libera (não é dono do
 * turno de ninguém em particular, mas o servidor também libera sem consumir); jogador não pode.
 */
export function canMoveNow(state: Combat | null, token: Pick<Token, "id">, me: Participant): "ok" | "not-my-turn" {
  if (!state || state.status !== "active") return "ok";
  const combatant = state.combatants.find((c) => c.tokenId === token.id);
  if (!combatant) return "ok";
  if (state.activeCombatantId === combatant.id) return "ok";
  return me.role === "gm" ? "ok" : "not-my-turn";
}
