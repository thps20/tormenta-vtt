import { useEffect, useRef } from "react";
import type React from "react";
import { useCharacters } from "../store/characters";

/** Distância (px) a partir da qual pressionar-e-mover vira arrasto, e não clique — mesmo limiar dos outros arrastos. */
const DRAG_THRESHOLD = 4;

/**
 * Arrastar uma linha da aba Fichas até o mapa (SPEC §9.30): solta um token daquela ficha no ponto.
 * Cópia fiel de `useHandoutDrag` — pointer events, porque Konva não participa do drag nativo do
 * navegador — só que arrastando um `Character`. O alvo "mapa" (`lib/dropTargets.ts`) distingue os
 * arrastos pela FORMA do que está sendo arrastado, então os vários registros convivem no mesmo id.
 */
export function useCharacterDrag(): { onRowPointerDown: (e: React.PointerEvent, characterId: string) => void } {
  const pending = useRef<{ characterId: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const point = { x: e.clientX, y: e.clientY };
      const s = useCharacters.getState();
      if (s.drag) {
        s.moveDrag(point);
        return;
      }
      const p = pending.current;
      if (p && Math.hypot(point.x - p.x, point.y - p.y) > DRAG_THRESHOLD) {
        s.startDrag(p.characterId, point);
        s.moveDrag(point);
      }
    };
    const onUp = () => {
      pending.current = null;
      if (useCharacters.getState().drag) useCharacters.getState().endDrag();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useCharacters.getState().drag) {
        e.stopPropagation();
        pending.current = null;
        useCharacters.getState().cancelDrag();
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
      useCharacters.getState().cancelDrag();
    };
  }, []);

  const onRowPointerDown = (e: React.PointerEvent, characterId: string) => {
    if (e.button !== 0) return;
    pending.current = { characterId, x: e.clientX, y: e.clientY };
  };
  return { onRowPointerDown };
}
