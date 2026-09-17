import { create } from "zustand";
import type { DiceGroupResult } from "@tormenta-vtt/shared";
import { toast } from "./ui";

/** Um pedido de animação 3D (docs/SPEC.md, modo "3D" de animação de rolagem). */
export interface DiceOverlay3DRequest {
  id: string;
  groups: DiceGroupResult[];
}

interface DiceOverlay3DState {
  /** Fila FIFO; `DiceOverlay3D.tsx` só processa `queue[0]` por vez. */
  queue: DiceOverlay3DRequest[];
  /**
   * true depois que carregar/inicializar a lib (`@3d-dice/dice-box-threejs`) falhou uma vez
   * nesta sessão (WebGL indisponível, erro de rede, exceção em runtime) — dali em diante os
   * pedidos caem direto na animação "simples" do cartão (RollCardMessage), sem tentar de novo:
   * a rolagem NUNCA quebra por causa disso, o resultado já veio do servidor e o cartão sempre
   * mostra ele. `markUnavailable` também dispara o aviso, só na primeira vez.
   */
  unavailable: boolean;
  enqueue: (req: DiceOverlay3DRequest) => void;
  /** Remove o pedido da frente da fila (terminou, foi pulado por clique, ou não deu certo). */
  dequeue: () => void;
  markUnavailable: () => void;
}

export const useDiceOverlay3D = create<DiceOverlay3DState>((set, get) => ({
  queue: [],
  unavailable: false,
  enqueue: (req) => set((s) => ({ queue: [...s.queue, req] })),
  dequeue: () => set((s) => ({ queue: s.queue.slice(1) })),
  markUnavailable: () => {
    if (get().unavailable) return;
    set({ unavailable: true });
    toast("Não consegui carregar os dados 3D — usando a animação simples nesta sessão.", "info");
  },
}));
