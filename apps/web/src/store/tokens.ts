import { create } from "zustand";
import type { Token, TokenCreate, TokenPatch } from "@tormenta-vtt/shared";
import { throttle } from "../lib/throttle";
import { emitAck } from "./connection";
import { toast } from "./ui";

interface TokensState {
  byId: Record<string, Token>;
  /** Todos os tokens selecionados (caixa de seleção / shift+clique). */
  selectedIds: string[];
  /** O selecionado quando há exatamente UM (inspector, redimensionar, iniciativa). null com 0 ou vários. */
  selectedId: string | null;
  /** Pedido de "centralizar no token" (ex.: clique na iniciativa). nonce muda a cada pedido. */
  focusRequest: { tokenId: string; nonce: number } | null;
  /** Tokens que este cliente está arrastando agora (ecos de posição deles são ignorados). */
  draggingIds: Record<string, true>;

  setAll: (tokens: Token[]) => void;
  upsert: (token: Token) => void;
  remove: (tokenId: string) => void;
  select: (tokenId: string | null) => void;
  selectMany: (tokenIds: string[]) => void;
  /** Shift+clique: entra ou sai da seleção. */
  toggleSelect: (tokenId: string) => void;
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

/**
 * Posições ainda não enviadas dos tokens em arraste. Um único throttle envia
 * TODAS a cada ~33 ms (SPEC §3.3): com um throttle por chamada, ao mover um
 * grupo só o último token de cada rajada seria enviado.
 */
const pendingMoves = new Map<string, { x: number; y: number }>();
const flushMoves = throttle(() => {
  for (const [id, { x, y }] of pendingMoves) void emitAck("token:update", { id, x, y });
  pendingMoves.clear();
}, 33);

/** Seleção derivada: selectedId só vale com exatamente um token. */
const selection = (ids: string[]) => ({ selectedIds: ids, selectedId: ids.length === 1 ? (ids[0] ?? null) : null });

function stopDragging(tokenId: string): void {
  useTokens.setState((s) => {
    const { [tokenId]: _done, ...rest } = s.draggingIds;
    return { draggingIds: rest };
  });
}

export const useTokens = create<TokensState>((set, get) => ({
  byId: {},
  selectedIds: [],
  selectedId: null,
  focusRequest: null,
  draggingIds: {},

  setAll: (tokens) => set({ byId: Object.fromEntries(tokens.map((t) => [t.id, t])) }),
  upsert: (token) =>
    set((s) => {
      // Enquanto arrastamos, o servidor devolve (eco) posições já antigas; se aplicássemos,
      // o token pularia para trás a cada eco. Mantemos a posição local até soltar.
      const local = s.byId[token.id];
      const merged = s.draggingIds[token.id] && local ? { ...token, x: local.x, y: local.y } : token;
      return { byId: { ...s.byId, [token.id]: merged } };
    }),
  remove: (tokenId) =>
    set((s) => {
      const { [tokenId]: _removed, ...rest } = s.byId;
      return { byId: rest, ...selection(s.selectedIds.filter((id) => id !== tokenId)) };
    }),
  select: (tokenId) => set(selection(tokenId ? [tokenId] : [])),
  selectMany: (tokenIds) => set(selection(tokenIds)),
  toggleSelect: (tokenId) =>
    set((s) => selection(s.selectedIds.includes(tokenId) ? s.selectedIds.filter((id) => id !== tokenId) : [...s.selectedIds, tokenId])),
  focus: (tokenId) => set((s) => ({ ...selection([tokenId]), focusRequest: { tokenId, nonce: (s.focusRequest?.nonce ?? 0) + 1 } })),

  moveLive: (tokenId, x, y) => {
    const t = get().byId[tokenId];
    if (!t) return;
    set((s) => ({ byId: { ...s.byId, [tokenId]: { ...t, x, y } }, draggingIds: { ...s.draggingIds, [tokenId]: true } }));
    pendingMoves.set(tokenId, { x, y });
    flushMoves();
  },

  patch: async (patch) => {
    const previous = get().byId[patch.id];
    if (!previous) return false;
    if (get().draggingIds[patch.id]) {
      // Soltou: descarta o envio "ao vivo" pendente deste token, que chegaria depois da posição final.
      pendingMoves.delete(patch.id);
      if (pendingMoves.size === 0) flushMoves.cancel();
      stopDragging(patch.id);
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
    if (get().draggingIds[tokenId]) {
      pendingMoves.delete(tokenId);
      if (pendingMoves.size === 0) flushMoves.cancel();
      stopDragging(tokenId);
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
