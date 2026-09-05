import { create } from "zustand";
import type { InitiativeAddPayload, InitiativeEntry, InitiativeState, InitiativeUpdatePayload } from "@tormenta-vtt/shared";
import { emitAck } from "./connection";
import { toast } from "./ui";

interface InitiativeStoreState {
  state: InitiativeState | null;
  setState: (state: InitiativeState | null) => void;

  // Ações do GM. Todas devolvem o estado completo no ack e no broadcast; usamos o broadcast.
  add: (entry: InitiativeAddPayload) => Promise<boolean>;
  update: (patch: InitiativeUpdatePayload) => Promise<boolean>;
  remove: (entryId: string) => Promise<boolean>;
  next: () => Promise<boolean>;
  prev: () => Promise<boolean>;
  reset: () => Promise<boolean>;
}

async function run(p: Promise<{ ok: true; data: InitiativeState } | { ok: false; error: string }>): Promise<boolean> {
  const res = await p;
  if (!res.ok) toast(res.error);
  return res.ok;
}

export const useInitiative = create<InitiativeStoreState>((set) => ({
  state: null,
  setState: (state) => set({ state }),
  add: (entry) => run(emitAck("initiative:add", entry)),
  update: (patch) => run(emitAck("initiative:update", patch)),
  remove: (entryId) => run(emitAck("initiative:remove", { entryId })),
  next: () => run(emitAck("initiative:next", {})),
  prev: () => run(emitAck("initiative:prev", {})),
  reset: () => run(emitAck("initiative:reset", {})),
}));

/** Ordem oficial (mesma do servidor): value desc, tiebreak desc. */
export function sortEntries(entries: InitiativeEntry[]): InitiativeEntry[] {
  return [...entries].sort((a, b) => (b.value !== a.value ? b.value - a.value : b.tiebreak - a.tiebreak));
}

/** Entrada que está agindo, ou null. */
export function currentEntry(state: InitiativeState | null): InitiativeEntry | null {
  if (!state || state.currentIndex === null) return null;
  return sortEntries(state.entries)[state.currentIndex] ?? null;
}
