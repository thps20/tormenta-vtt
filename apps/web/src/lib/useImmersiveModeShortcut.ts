import { useEffect } from "react";
import { isTyping } from "./isTyping";

/**
 * Atalhos do modo imersivo (docs/SPEC.md §9.22): Shift+F alterna entrar/sair, Esc só sai (nunca
 * entra — mesmo padrão de `useSidePanelShortcut`, isTyping protege o chat). Shift+F não disputa com
 * o F de "Névoa" da barra de ferramentas: `useToolShortcuts` ignora combinações com Shift ao mapear
 * tecla → modo, exatamente pra abrir espaço pra este atalho.
 */
export function useImmersiveModeShortcut(active: boolean, onToggle: () => void, onExit: () => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (!e.ctrlKey && !e.metaKey && !e.altKey && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        onToggle();
        return;
      }
      if (e.key === "Escape" && active) onExit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, onToggle, onExit]);
}
