import { useEffect, useRef } from "react";
import type React from "react";
import { useHandouts } from "../store/handouts";

/** Distância (px) a partir da qual um pressionar-e-mover vira arrasto, e não clique — mesmo limiar de `useCompendiumDrag`. */
const DRAG_THRESHOLD = 4;

/**
 * Arrasto de um card de handout da biblioteca pro mapa (§9.10), com pointer events — mesmo
 * mecanismo de `components/compendium/DragGhost.tsx#useCompendiumDrag` (Konva não participa do
 * drag nativo do navegador, então HTML5 drag-and-drop não serve aqui). Componente próprio (não
 * reaproveita `useCompendiumDrag` direto) porque arrasta um tipo diferente (`Handout`, não
 * `CompendiumEntry`) — o registro de alvos em `lib/dropTargets.ts` é genérico o bastante pros dois
 * conviverem sem se atrapalhar (ids de alvo diferentes: "map" pro compêndio, "map-handout" aqui).
 */
export function useHandoutDrag(): { onCardPointerDown: (e: React.PointerEvent, handoutId: string) => void } {
  const pending = useRef<{ handoutId: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const point = { x: e.clientX, y: e.clientY };
      const s = useHandouts.getState();
      if (s.drag) {
        s.moveDrag(point);
        return;
      }
      const p = pending.current;
      if (p && Math.hypot(point.x - p.x, point.y - p.y) > DRAG_THRESHOLD) {
        s.startDrag(p.handoutId, point);
        s.moveDrag(point);
      }
    };
    const onUp = () => {
      pending.current = null;
      if (useHandouts.getState().drag) useHandouts.getState().endDrag();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useHandouts.getState().drag) {
        e.stopPropagation();
        pending.current = null;
        useHandouts.getState().cancelDrag();
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
      useHandouts.getState().cancelDrag();
    };
  }, []);

  const onCardPointerDown = (e: React.PointerEvent, handoutId: string) => {
    if (e.button !== 0) return;
    pending.current = { handoutId, x: e.clientX, y: e.clientY };
  };
  return { onCardPointerDown };
}
