import { create } from "zustand";
import type { CompendiumSpawnCreaturePayload, Token, TokenCreate, TokenPatch } from "@tormenta-vtt/shared";
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
  /**
   * `scene:enter` (docs/plano-mapas.md §5): substitui os tokens de UM mapa — tira do store os que
   * ele tinha daquele `sceneId` e insere os que vieram, nunca faz merge (senão um token apagado
   * enquanto o GM estava fora ficaria fantasma). Tokens de outros mapas (o GM pode ter visitado
   * vários) não são tocados.
   */
  replaceScene: (sceneId: string, tokens: Token[]) => void;
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
  /**
   * Arraste em grupo ao soltar (2+ tokens selecionados movidos juntos): um único token:update-many,
   * tudo-ou-nada, em vez de N chamadas de patch() — o servidor empilha UMA entrada de histórico pro
   * lote inteiro (docs/plano-desfazer.md §3). Otimista com ack e reversão de todos.
   */
  patchMany: (patches: TokenPatch[]) => Promise<boolean>;
  create: (data: TokenCreate) => Promise<Token | null>;
  /**
   * Solta N cópias de uma criatura do compêndio na cena (GM). O servidor decide as posições
   * (findFreeCells a partir do ponto pedido) e cria ficha + token por cópia numa transação; devolve
   * os tokens criados (pode ser menos que o pedido, se a espiral estourar o raio máximo — sem erro).
   * Sem otimismo: character:created/token:created chegam pelo broadcast normal (upsert idempotente).
   */
  spawnFromCompendium: (payload: CompendiumSpawnCreaturePayload) => Promise<Token[] | null>;
  delete: (tokenId: string) => Promise<boolean>;
  /**
   * Apagar em lote (Delete/Backspace com vários selecionados, lixeira do NpcQuickCard): um único
   * token:delete-many, tudo-ou-nada — o servidor empilha UMA entrada de histórico pro lote inteiro
   * (docs/plano-desfazer.md §2), em vez de uma por token.
   */
  deleteMany: (tokenIds: string[]) => Promise<boolean>;
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
  // live: true — eco "ao vivo" do arraste: o servidor aplica e faz broadcast normalmente, mas
  // nunca empilha histórico por causa disso (docs/plano-desfazer.md §3). Só o patch final do
  // gesto (patch()/patchMany() abaixo, sem live) conta como "o usuário decidiu mover pra cá".
  for (const [id, { x, y }] of pendingMoves) void emitAck("token:update", { id, x, y, live: true });
  pendingMoves.clear();
}, 33);

/** Mescla otimista de um patch no token local, sem os campos que são só transporte pro servidor
 *  (`live`, `dragFrom` — nunca fizeram parte do Token de verdade, ver TokenPatchSchema). */
function applyPatchLocally(previous: Token, patch: TokenPatch): Token {
  const { live: _live, dragFrom: _dragFrom, ...fields } = patch;
  return { ...previous, ...fields };
}

/**
 * Alvo do revert quando o servidor recusa o patch final de um gesto (arraste ou rajada de
 * teclado). `previous` é o valor ATUAL do store no momento da chamada — durante um gesto, já foi
 * atualizado várias vezes por `moveLive` (ecos "ao vivo", sem ack: `flushMoves` não espera
 * resposta, então um eco recusado no meio do gesto — ex.: o turno mudou de mão, ver
 * docs/revisao-movimento.md — nunca é percebido pelo cliente). Se isso aconteceu, `previous` já
 * está fora de sincronia com o que o servidor tem de verdade, e reverter pra ele deixaria o token
 * "preso" numa posição que só existe localmente. `patch.dragFrom` (x/y de onde o gesto começou,
 * mandado pelo drag de VttCanvas e pela rajada de teclado) é o ponto que o servidor CONFIRMOU por
 * último antes do gesto — reverter pra ele é sempre seguro, mesmo com ecos ao vivo perdidos pelo
 * caminho. Patches sem `dragFrom` (edição avulsa, não um gesto) continuam revertendo pra `previous`.
 */
function revertTarget(previous: Token, patch: TokenPatch): Token {
  return patch.dragFrom ? { ...previous, x: patch.dragFrom.x, y: patch.dragFrom.y } : previous;
}

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
  replaceScene: (sceneId, tokens) =>
    set((s) => {
      const kept: Record<string, Token> = {};
      for (const [id, t] of Object.entries(s.byId)) if (t.sceneId !== sceneId) kept[id] = t;
      for (const t of tokens) kept[t.id] = t;
      const stillThere = new Set(Object.keys(kept));
      return { byId: kept, ...selection(s.selectedIds.filter((id) => stillThere.has(id))) };
    }),
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
    set((s) => ({ byId: { ...s.byId, [patch.id]: applyPatchLocally(previous, patch) } }));
    // 2. ack
    const res = await emitAck("token:update", patch);
    if (!res.ok) {
      // 3. reverte (pro início do gesto quando souber onde foi — ver revertTarget)
      set((s) => ({ byId: { ...s.byId, [patch.id]: revertTarget(previous, patch) } }));
      toast(res.error);
      return false;
    }
    return true;
  },

  patchMany: async (patches) => {
    const ids = patches.map((p) => p.id);
    const previous = new Map(ids.map((id) => [id, get().byId[id]]));
    if ([...previous.values()].some((t) => t === undefined)) return false;
    for (const id of ids) {
      if (get().draggingIds[id]) {
        pendingMoves.delete(id);
        stopDragging(id);
      }
    }
    if (pendingMoves.size === 0) flushMoves.cancel();
    // 1. otimista
    set((s) => {
      const byId = { ...s.byId };
      for (const patch of patches) byId[patch.id] = applyPatchLocally(byId[patch.id] as Token, patch);
      return { byId };
    });
    // 2. ack
    const res = await emitAck("token:update-many", { patches });
    if (!res.ok) {
      // 3. reverte todos (pro início do gesto quando souber onde foi — ver revertTarget)
      set((s) => {
        const byId = { ...s.byId };
        for (const patch of patches) {
          const t = previous.get(patch.id);
          if (t) byId[patch.id] = revertTarget(t, patch);
        }
        return { byId };
      });
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

  spawnFromCompendium: async (payload) => {
    const res = await emitAck("compendium:spawn-creature", payload);
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    // Os broadcasts character:created/token:created também chegam; o upsert é idempotente.
    for (const token of res.data) get().upsert(token);
    if (res.data[0]) get().select(res.data[0].id);
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

  deleteMany: async (tokenIds) => {
    const previous = tokenIds.map((id) => get().byId[id]).filter((t): t is Token => t !== undefined);
    if (previous.length === 0) return false;
    for (const id of tokenIds) {
      if (get().draggingIds[id]) {
        pendingMoves.delete(id);
        stopDragging(id);
      }
    }
    if (pendingMoves.size === 0) flushMoves.cancel();
    for (const id of tokenIds) get().remove(id);
    const res = await emitAck("token:delete-many", { tokenIds });
    if (!res.ok) {
      for (const t of previous) get().upsert(t);
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
