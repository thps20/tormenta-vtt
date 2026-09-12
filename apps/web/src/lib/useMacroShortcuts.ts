import { useEffect } from "react";
import { sortedCharacters, useCharacters } from "../store/characters";
import { orderedMacros, useMacros } from "../store/macros";
import { toast } from "../store/ui";
import { isTyping } from "./isTyping";
import { resolveMacroTarget } from "./macros";

/**
 * Teclas 1..9 (fora de campo de texto, docs/SPEC.md §9.20): disparam a macro na posição
 * correspondente da barra (índice 0..8 da lista já ordenada) — mesmo mecanismo de "1" = primeiro
 * botão que um hotbar de VTT costuma ter. Macro com referência pendurada (ficha/item/ação apagada)
 * não dispara: mesmo aviso da barra, sem virar um erro de ack. Um único listener na janela, montado
 * pela página da mesa (mesmo padrão de `useToolShortcuts`).
 */
export function useMacroShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const index = Number(e.key) - 1;
      if (!Number.isInteger(index) || index < 0 || index > 8) return;
      const macro = orderedMacros(useMacros.getState().macros)[index];
      if (!macro) return;
      e.preventDefault();
      const check = resolveMacroTarget(macro.action, sortedCharacters(useCharacters.getState().byId));
      if (!check.ok) {
        toast(check.reason);
        return;
      }
      void useMacros.getState().run(macro);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
