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
  /** Token que este cliente está arrastando agora (ecos de posição dele são ignorados). */
  draggingId: string | null;

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
  /** Vincula/desvincula uma ficha (otimista com reversão). */
  linkCharacter: (tokenId: string, characterId: string | null) => Promise<boolean>;
}

/** Máx. ~30 emissões por segundo enquanto arrasta (SPEC §3.3). */
const emitMoveThrottled = throttle((tokenId: string, x: number, y: number) => {
  void emitAck("token:update", { id: tokenId, x, y });
}, 33);

export const useTokens = create<TokensState>((set, get) => ({
  byId: {},
  selectedId: null,
  focusRequest: null,
  draggingId: null,

  setAll: (tokens) => set({ byId: Object.fromEntries(tokens.map((t) => [t.id, t])) }),
  upsert: (token) =>
    set((s) => {
      // Enquanto arrastamos, o servidor devolve (eco) posições já antigas; se aplicássemos,
      // o token pularia para trás a cada eco. Mantemos a posição local até soltar.
      const local = s.byId[token.id];
      const merged = s.draggingId === token.id && local ? { ...token, x: local.x, y: local.y } : token;
      return { byId: { ...s.byId, [token.id]: merged } };
    }),
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
    set((s) => ({ byId: { ...s.byId, [tokenId]: { ...t, x, y } }, draggingId: tokenId }));
    emitMoveThrottled(tokenId, x, y);
  },

  patch: async (patch) => {
    const previous = get().byId[patch.id];
    if (!previous) return false;
    if (get().draggingId === patch.id) {
      // Soltou: descarta um envio "ao vivo" pendente, que chegaria depois da posição final.
      emitMoveThrottled.cancel();
      set({ draggingId: null });
    }
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

  linkCharacter: async (tokenId, characterId) => {
    const previous = get().byId[tokenId];
    if (!previous) return false;
    set((s) => ({ byId: { ...s.byId, [tokenId]: { ...previous, characterId } } }));
    const res = await emitAck("token:link-character", { tokenId, characterId });
    if (!res.ok) {
      set((s) => ({ byId: { ...s.byId, [tokenId]: previous } }));
      toast(res.error);
      return false;
    }
    return true;
  },

  delete: async (tokenId) => {
    const previous = get().byId[tokenId];
    if (!previous) return false;
    if (get().draggingId === tokenId) {
      emitMoveThrottled.cancel();
      set({ draggingId: null });
    }
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

/**
 * Lista ordenada por zIndex, filtrada pela cena. Função pura para usar com useMemo;
 * NÃO use como seletor do hook (devolve array novo a cada chamada => loop de render).
 */
export function sceneTokens(byId: Record<string, Token>, sceneId: string | null | undefined): Token[] {
  return Object.values(byId)
    .filter((t) => t.sceneId === sceneId)
    .sort((a, b) => a.zIndex - b.zIndex);
}
