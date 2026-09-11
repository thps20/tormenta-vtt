import { create } from "zustand";
import type { PartyEntry } from "@tormenta-vtt/shared";
import { emitAck } from "./connection";
import { toast } from "./ui";

interface PartyState {
  /**
   * Grupo da "Visão de grupo" (SPEC §9.15), já filtrado pelo servidor pra este cliente (jogador
   * nunca recebe entrada oculta). Ordem = ordem de exibição na faixa.
   */
  entries: PartyEntry[];
  setAll: (entries: PartyEntry[]) => void;

  /** GM: PC da sala fora do grupo (ex.: sala antiga, ou removido antes). Idempotente. */
  add: (characterId: string) => Promise<boolean>;
  remove: (characterId: string) => Promise<boolean>;
  setHidden: (characterId: string, hidden: boolean) => Promise<boolean>;
  /** Nova ordem completa (arrastar na faixa). */
  reorder: (characterIds: string[]) => Promise<boolean>;
}

/** Sem otimismo — igual a `store/combat.ts#reorder`: o servidor sempre devolve `party:updated`
 *  (inclusive pra quem chamou), que é quem realmente atualiza `entries` (ver bindSocket.ts). */
async function run(p: Promise<{ ok: true; data: PartyEntry[] } | { ok: false; error: string }>): Promise<boolean> {
  const res = await p;
  if (!res.ok) toast(res.error);
  return res.ok;
}

export const useParty = create<PartyState>((set) => ({
  entries: [],
  setAll: (entries) => set({ entries }),

  add: (characterId) => run(emitAck("party:add", { characterId })),
  remove: (characterId) => run(emitAck("party:remove", { characterId })),
  setHidden: (characterId, hidden) => run(emitAck("party:set-hidden", { characterId, hidden })),
  reorder: (characterIds) => run(emitAck("party:reorder", { characterIds })),
}));
