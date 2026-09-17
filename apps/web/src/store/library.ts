import { create } from "zustand";
import type { Asset, AssetCreatePayload, AssetPatch, LibraryFavorite, LibraryItem, LibraryRefKind } from "@tormenta-vtt/shared";
import { dropTargetAt, type DropPoint } from "../lib/dropTargets";
import { uploadFile } from "../lib/api";
import { emitAck } from "./connection";
import { toast } from "./ui";

/** Um upload em andamento na fila de arrastar-arquivo-pro-diálogo (docs/plano-preparo.md §1.3). */
export interface UploadQueueItem {
  id: string;
  file: File;
  status: "uploading" | "done" | "error";
  error?: string;
}

/**
 * Acervo da sala (docs/plano-preparo.md §1): biblioteca de `Asset` (mapa/token/áudio que ainda não
 * tinha tabela própria) + favoritos (que funcionam sobre os cinco tipos — asset/handout/encontro/
 * criatura/macro) + o arrasto de um item da grade do `LibraryDialog` até o mapa. Handout/encontro/
 * criatura/macro continuam em suas próprias stores (`store/handouts.ts` etc.) — `buildLibraryItems`
 * (shared) só COMBINA essas listas com `assets`/`favorites` daqui, nunca duplica dado (§1.1).
 */
interface LibraryState {
  assets: Asset[];
  assetsStatus: "idle" | "loading" | "ready" | "error";
  favorites: LibraryFavorite[];
  favoritesStatus: "idle" | "loading" | "ready" | "error";

  /** Fila de upload por arrastar-arquivo-do-SO (HTML5 drag nativo, diferente do arrasto interno
   *  abaixo) — cada entrada soma por conta própria e sai da fila ao terminar (sucesso ou erro). */
  uploads: UploadQueueItem[];

  /** Arrasto em andamento de um card do acervo até o mapa (pointer events, mesmo mecanismo de
   *  `store/handouts.ts#drag`). Guarda o `LibraryItem` inteiro — `lib/useLibraryDrag.ts` decide o
   *  que repassar a `dropTargetAt` conforme o `kind`. */
  drag: { item: LibraryItem; point: DropPoint; targetId: string | null } | null;

  loadAssets: () => Promise<void>;
  loadFavorites: () => Promise<void>;

  createAsset: (payload: AssetCreatePayload) => Promise<Asset | null>;
  updateAsset: (id: string, patch: AssetPatch) => Promise<Asset | null>;
  removeAsset: (id: string) => Promise<boolean>;
  toggleFavorite: (refKind: LibraryRefKind, refId: string, favorite: boolean) => Promise<boolean>;

  /** Sobe o arquivo por HTTP e, se der certo, cria o `Asset` (§1.3). Usado tanto pelo botão
   *  "Enviar arquivo" quanto pela fila de arrastar-do-SO (uma chamada por arquivo). */
  uploadAndCreateAsset: (file: File, override: { name: string; kind: "map" | "token" | "audio"; tags: string[] }) => Promise<Asset | null>;
  removeUpload: (uploadId: string) => void;

  startDrag: (item: LibraryItem, point: DropPoint) => void;
  moveDrag: (point: DropPoint) => void;
  endDrag: () => void;
  cancelDrag: () => void;

  // Broadcasts (bindSocket) — idempotentes, mesma função cobre o eco otimista das ações acima.
  upsertAsset: (asset: Asset) => void;
  removeAssetLocal: (id: string) => void;
  setFavorites: (favorites: LibraryFavorite[]) => void;

  reset: () => void;
}

/** O que `dropTargetAt` (lib/dropTargets.ts) reconhece por FORMA: cada alvo do mapa já existente
 *  (handout/encontro/criatura) aceita o registro ORIGINAL, não o `LibraryItem` embrulhado — então
 *  arrastar um item do acervo cujo `kind` é "handout"/"encounter"/"creature" repassa exatamente o
 *  mesmo objeto que a galeria/paleta de origem já arrastaria. "macro" não tem alvo no mapa (§1.5) e
 *  nunca deveria chegar aqui (o card nem inicia o arrasto, ver LibraryDialog); "asset" repassa o
 *  próprio Asset (novo alvo, registrado em VttCanvas).
 */
function dragPayloadOf(item: LibraryItem): unknown {
  switch (item.kind) {
    case "asset":
      return item.asset;
    case "handout":
      return item.handout;
    case "encounter":
      return item.encounter;
    case "creature":
      return item.entry;
    case "macro":
      return null;
  }
}

export const useLibrary = create<LibraryState>((set, get) => ({
  assets: [],
  assetsStatus: "idle",
  favorites: [],
  favoritesStatus: "idle",
  uploads: [],
  drag: null,

  loadAssets: async () => {
    if (get().assetsStatus === "loading") return;
    set({ assetsStatus: "loading" });
    const res = await emitAck("asset:list", {});
    if (!res.ok) {
      set({ assetsStatus: "error" });
      toast(res.error);
      return;
    }
    set({ assets: res.data, assetsStatus: "ready" });
  },

  loadFavorites: async () => {
    if (get().favoritesStatus === "loading") return;
    set({ favoritesStatus: "loading" });
    const res = await emitAck("library:favorites", {});
    if (!res.ok) {
      set({ favoritesStatus: "error" });
      toast(res.error);
      return;
    }
    set({ favorites: res.data, favoritesStatus: "ready" });
  },

  createAsset: async (payload) => {
    const res = await emitAck("asset:create", payload);
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsertAsset(res.data);
    return res.data;
  },

  updateAsset: async (id, patch) => {
    const res = await emitAck("asset:update", { id, patch });
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsertAsset(res.data);
    return res.data;
  },

  removeAsset: async (id) => {
    const res = await emitAck("asset:delete", { id });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    get().removeAssetLocal(id);
    return true;
  },

  toggleFavorite: async (refKind, refId, favorite) => {
    const res = await emitAck("library:favorite-set", { refKind, refId, favorite });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    set({ favorites: res.data });
    return true;
  },

  uploadAndCreateAsset: async (file, override) => {
    const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    set((s) => ({ uploads: [...s.uploads, { id: uploadId, file, status: "uploading" }] }));
    try {
      const uploaded = await uploadFile(file);
      const payload: AssetCreatePayload =
        "kind" in uploaded && uploaded.kind === "audio"
          ? { kind: "audio", name: override.name, url: uploaded.url, durationMs: null, tags: override.tags }
          : "width" in uploaded
            ? { kind: override.kind === "audio" ? "token" : override.kind, name: override.name, url: uploaded.url, width: uploaded.width, height: uploaded.height, tags: override.tags }
            : (() => {
                throw new Error("Resposta de upload inesperada");
              })();
      const asset = await get().createAsset(payload);
      set((s) => ({ uploads: asset ? s.uploads.filter((u) => u.id !== uploadId) : s.uploads.map((u) => (u.id === uploadId ? { ...u, status: "error", error: "Falha ao salvar no acervo" } : u)) }));
      return asset;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha no envio";
      set((s) => ({ uploads: s.uploads.map((u) => (u.id === uploadId ? { ...u, status: "error", error: message } : u)) }));
      toast(message);
      return null;
    }
  },

  removeUpload: (uploadId) => set((s) => ({ uploads: s.uploads.filter((u) => u.id !== uploadId) })),

  startDrag: (item, point) => set({ drag: { item, point, targetId: null } }),
  moveDrag: (point) => {
    const { drag } = get();
    if (!drag) return;
    const payload = dragPayloadOf(drag.item);
    set({ drag: { ...drag, point, targetId: payload ? (dropTargetAt(point, payload)?.id ?? null) : null } });
  },
  endDrag: () => {
    const { drag } = get();
    set({ drag: null });
    if (!drag) return;
    const payload = dragPayloadOf(drag.item);
    if (!payload) return;
    const target = dropTargetAt(drag.point, payload);
    target?.onDrop(payload, drag.point);
  },
  cancelDrag: () => set({ drag: null }),

  upsertAsset: (asset) => set((s) => ({ assets: s.assets.some((a) => a.id === asset.id) ? s.assets.map((a) => (a.id === asset.id ? asset : a)) : [...s.assets, asset] })),
  removeAssetLocal: (id) => set((s) => ({ assets: s.assets.filter((a) => a.id !== id) })),
  setFavorites: (favorites) => set({ favorites }),

  reset: () => set({ assets: [], assetsStatus: "idle", favorites: [], favoritesStatus: "idle", uploads: [], drag: null }),
}));
