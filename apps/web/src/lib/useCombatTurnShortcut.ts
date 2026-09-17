import { useEffect } from "react";
import { sceneCombat, useCombat } from "../store/combat";
import { selectIsGm, selectViewedScene, useRoom } from "../store/room";
import { isTyping } from "./isTyping";

/**
 * N = Próximo turno, Shift+N = Anterior, no combate do mapa que o GM está vendo (fora de campo de
 * texto). Só GM: `combat:next`/`combat:prev` são `gmOnly` no servidor. Sem combate em andamento
 * nesse mapa, a tecla não faz nada. Um listener na janela, montado pela página da mesa (mesmo padrão
 * de `useToolShortcuts`); lê tudo das stores na hora da tecla, então não re-registra.
 */
export function useCombatTurnShortcut(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.key.toLowerCase() !== "n") return;
      const room = useRoom.getState();
      if (!selectIsGm(room)) return;
      const scene = selectViewedScene(room);
      if (!scene) return;
      const combat = sceneCombat(useCombat.getState().byScene, scene.id);
      if (!combat || combat.status === "ended") return;
      e.preventDefault();
      // "Anterior" só existe com os turnos já rodando (o servidor recusa em "rolling").
      if (e.shiftKey) {
        if (combat.status === "active") void useCombat.getState().prev(scene.id);
      } else {
        void useCombat.getState().next(scene.id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
