import { useEffect, useRef } from "react";
import { isTyping } from "./isTyping";

export interface GmPanelShortcutHandlers {
  /** M: seletor de mapas. */
  onToggleMaps: () => void;
  /** J: galeria de handouts (H já é "Mover mapa"). */
  onToggleHandouts: () => void;
  /** B: acervo (Ctrl+B é recolher o painel lateral; B solta está livre). */
  onToggleLibrary: () => void;
}

/**
 * Letras soltas M/J/B do Mestre (fora de campo de texto, sem Ctrl/Alt/Meta, sem auto-repeat).
 * Moravam dentro de `MapSelector`/`HandoutSelector`/`LibrarySelector`: se o botão desmontasse (o
 * que a reorganização da Mesa em Bastidores × Mesa vai causar), a tecla morria junto. Aqui o
 * listener é da página, e quem é aberto por cada tecla é decisão de quem monta o hook.
 * `enabled = false` (jogador) desliga tudo. Os handlers ficam num ref: o listener registra uma vez
 * só e sempre chama a versão mais recente.
 */
export function useGmPanelShortcuts(enabled: boolean, handlers: GmPanelShortcutHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.repeat) return;
      const key = e.key.toLowerCase();
      const handler = key === "m" ? ref.current.onToggleMaps : key === "j" ? ref.current.onToggleHandouts : key === "b" ? ref.current.onToggleLibrary : null;
      if (!handler) return;
      e.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
