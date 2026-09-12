import { create } from "zustand";

/** Toasts de erro/aviso (ex.: ack { ok:false } que fez reverter uma mudança). */
export interface Toast {
  id: number;
  message: string;
  kind: "error" | "info";
}

/** Retângulo em coordenadas de TELA (`getBoundingClientRect`), cantos absolutos. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface UiState {
  toasts: Toast[];
  push: (message: string, kind?: Toast["kind"]) => void;
  dismiss: (id: number) => void;
  /**
   * Retângulo da imagem do mapa em tela (considerando zoom/pan do Stage), publicado pelo VttCanvas
   * a cada mudança de zoom/pan/tamanho do container (throttled lá). Só serve pra decidir se as
   * barras flutuantes (Toolbar, HUD inferior) ficam translúcidas por estarem sobre o mapa — ver
   * lib/useBarTranslucency. Muda com frequência durante um arrasto de pan; fica numa store à parte
   * (em vez de estado do RoomPage) pra só os componentes que leem isso re-renderizarem, não a
   * página toda. null = sem mapa carregado (ou canvas desmontado).
   */
  mapScreenRect: ScreenRect | null;
  setMapScreenRect: (rect: ScreenRect | null) => void;
}

let nextId = 1;

export const useUi = create<UiState>((set) => ({
  toasts: [],
  push: (message, kind = "error") => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, kind }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  mapScreenRect: null,
  setMapScreenRect: (mapScreenRect) => set({ mapScreenRect }),
}));

export const toast = (message: string, kind?: Toast["kind"]) => useUi.getState().push(message, kind);
