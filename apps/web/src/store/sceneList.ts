import { create } from "zustand";
import type { SceneListItem } from "@tormenta-vtt/shared";
import { emitAck } from "./connection";

/**
 * Contagens/combate de cada mapa (docs/plano-mapas.md §3, §13): dado que o cliente não tem porque
 * nunca carregou tokens/combate de um mapa que não é o ativo nem o visitado. Buscado sob demanda
 * (aba "Mapas" abre) e reatualizado nos broadcasts que podem ter mudado algo (scene:*,
 * room:activeSceneChanged) — só refaz a busca se já carregou alguma vez (`status !== "idle"`), pra
 * não gastar uma chamada à toa em toda sala com um GM que nunca abriu o painel.
 */
interface SceneListState {
  itemsBySceneId: Record<string, SceneListItem>;
  status: "idle" | "loading" | "ready" | "error";
  load: () => Promise<void>;
  /** Só refaz se já carregou alguma vez (senão o GM nem abriu o painel ainda). */
  refreshIfLoaded: () => void;
  reset: () => void;
}

export const useSceneList = create<SceneListState>((set, get) => ({
  itemsBySceneId: {},
  status: "idle",

  load: async () => {
    set({ status: "loading" });
    const res = await emitAck("scene:list", {});
    if (!res.ok) {
      set({ status: "error" });
      return;
    }
    set({ itemsBySceneId: Object.fromEntries(res.data.items.map((i) => [i.sceneId, i])), status: "ready" });
  },

  refreshIfLoaded: () => {
    if (get().status !== "idle") void get().load();
  },

  reset: () => set({ itemsBySceneId: {}, status: "idle" }),
}));
