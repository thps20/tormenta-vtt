import { useEffect } from "react";
import { useCompendium } from "../store/compendium";
import { isOpenPaletteShortcut } from "./compendium";
import { isTyping } from "./isTyping";

/**
 * Ctrl+Espaço (e os atalhos alternativos, ver isOpenPaletteShortcut) abre a paleta do compêndio
 * flutuando sobre o mapa quando a Mesa está em foco: nenhuma ficha aberta, nenhum modal.
 * `blocked` cobre os dois (a ficha tem o atalho dela, no drawer — os dois nunca disputam a mesma
 * tecla porque um deles sempre está desarmado). `initialKind` é o chip inicial (Criaturas pro GM).
 */
export function useMapPaletteShortcut(blocked: boolean, initialKind: string | null): void {
  useEffect(() => {
    if (blocked) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || !isOpenPaletteShortcut(e, isTyping(e.target))) return;
      e.preventDefault();
      if (!useCompendium.getState().isOpen) useCompendium.getState().open("map", initialKind);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [blocked, initialKind]);
}
