import { create } from "zustand";
import type { Token, TokenCreate, TokenPatch } from "@tormenta-vtt/shared";
import { throttle } from "../lib/throttle";
import { emitAck } from "./connection";
import { toast } from "./ui";

interface TokensState {
  byId: Record<string, Token>;
  selectedId: string | null;
  /** Pedido de "centralizar no token" (ex.: clique na iniciativa). nonce muda a cada pedido. */
  focusRequest: { tokenId: string; nonce: number } | null;

  setAll: (tokens: Token[]) => void;
  upsert: (token: Token) => void;
  remove: (tokenId: string) => void;
  select: (tokenId: string | null) => void;
  focus: (tokenId: string) => void;

  /** Durante o arraste: aplica local e emite com throttle (sem reverter). */
  moveLive: (tokenId: string, x: number, y: number) => void;
  /** Ao soltar / redimensionar / editar: otimista com ack e reversão. */
  patch: (patch: TokenPatch) => Promise<boolean>;
  create: (data: TokenCreate) => Promise<Token | null>;
  delete: (tokenId: string) => Promise<boolean>;
}

/** Máx. ~30 emissões por segundo enquanto arrasta (SPEC §3.3). */
const emitMoveThrottled = throttle((tokenId: string, x: number, y: number) => {
  void emitAck("token:update", { id: tokenId, x, y });
}, 33);

export const useTokens = create<TokensState>((set, get) => ({
  byId: {},
  selectedId: null,
  focusRequest: null,

  setAll: (tokens) => set({ byId: Object.fromEntries(tokens.map((t) => [t.id, t])) }),
  upsert: (token) => set((s) => ({ byId: { ...s.byId, [token.id]: token } })),
  remove: (tokenId) =>
    set((s) => {
      const { [tokenId]: _removed, ...rest } = s.byId;
      return { byId: rest, selectedId: s.selectedId === tokenId ? null : s.selectedId };
    }),
  select: (tokenId) => set({ selectedId: tokenId }),
  focus: (tokenId) => set((s) => ({ selectedId: tokenId, focusRequest: { tokenId, nonce: (s.focusRequest?.nonce ?? 0) + 1 } })),

  moveLive: (tokenId, x, y) => {
    const t = get().byId[tokenId];
    if (!t) return;
    set((s) => ({ byId: { ...s.byId, [tokenId]: { ...t, x, y } } }));
    emitMoveThrottled(tokenId, x, y);
  },

  patch: async (patch) => {
    const previous = get().byId[patch.id];
    if (!previous) return false;
    // 1. otimista
    set((s) => ({ byId: { ...s.byId, [patch.id]: { ...previous, ...patch } } }));
    // 2. ack
    const res = await emitAck("token:update", patch);
    if (!res.ok) {
      // 3. reverte
      set((s) => ({ byId: { ...s.byId, [patch.id]: previous } }));
      toast(res.error);
      return false;
    }
    return true;
  },

  create: async (data) => {
    const res = await emitAck("token:create", data);
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    // O broadcast token:created também chega; o upsert é idempotente.
    get().upsert(res.data);
    return res.data;
  },

  delete: async (tokenId) => {
    const previous = get().byId[tokenId];
    if (!previous) return false;
    get().remove(tokenId);
    const res = await emitAck("token:delete", { tokenId });
    if (!res.ok) {
      get().upsert(previous);
      toast(res.error);
      return false;
    }
    return true;
  },
}));

/** Lista ordenada por zIndex, filtrada pela cena. */
export function selectSceneTokens(sceneId: string | null | undefined) {
  return (s: TokensState): Token[] =>
    Object.values(s.byId)
      .filter((t) => t.sceneId === sceneId)
      .sort((a, b) => a.zIndex - b.zIndex);
}
