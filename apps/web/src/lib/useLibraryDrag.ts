import { useEffect, useRef } from "react";
import type React from "react";
import type { LibraryItem } from "@tormenta-vtt/shared";
import { useLibrary } from "../store/library";

/** Mesmo limiar de `useHandoutDrag`/`useCompendiumDrag` — pressionar-e-mover só vira arrasto (e
 *  não clique) depois de passar dessa distância. */
const DRAG_THRESHOLD = 4;

/**
 * Arrasto genérico de um card da grade do `LibraryDialog` até o mapa (docs/plano-preparo.md §1.5):
 * mesmo mecanismo de pointer events de `useHandoutDrag`, generalizado pro `LibraryItem` combinado
 * (asset/handout/encontro/criatura/macro). O card de uma macro nunca inicia o arrasto — macro não
 * tem "lugar" no mapa (§1.5); os outros repassam o registro ORIGINAL a `dropTargetAt`
 * (`store/library.ts#dragPayloadOf`), então os alvos que `VttCanvas` já reconhece por forma
 * (handout/encontro/criatura) continuam funcionando sem duplicar nenhum alvo novo.
 */
export function useLibraryDrag(): { onCardPointerDown: (e: React.PointerEvent, item: LibraryItem) => void } {
  const pending = useRef<{ item: LibraryItem; x: number; y: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const point = { x: e.clientX, y: e.clientY };
      const s = useLibrary.getState();
      if (s.drag) {
        s.moveDrag(point);
        return;
      }
      const p = pending.current;
      if (p && Math.hypot(point.x - p.x, point.y - p.y) > DRAG_THRESHOLD) {
        s.startDrag(p.item, point);
        s.moveDrag(point);
      }
    };
    const onUp = () => {
      pending.current = null;
      if (useLibrary.getState().drag) useLibrary.getState().endDrag();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useLibrary.getState().drag) {
        e.stopPropagation();
        pending.current = null;
        useLibrary.getState().cancelDrag();
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey, true);
      useLibrary.getState().cancelDrag();
    };
  }, []);

  const onCardPointerDown = (e: React.PointerEvent, item: LibraryItem) => {
    if (e.button !== 0 || item.kind === "macro") return;
    pending.current = { item, x: e.clientX, y: e.clientY };
  };
  return { onCardPointerDown };
}
