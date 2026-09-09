import { useEffect } from "react";
import { useHistory } from "../store/history";
import { selectIsGm, useRoom } from "../store/room";
import { useTools, type ToolMode } from "../store/tools";
import { isTyping } from "./isTyping";

/** Tecla → modo. Letras em minúsculo; comparamos com e.key.toLowerCase(). */
const KEY_TO_MODE: Record<string, ToolMode> = { v: "select", h: "pan", r: "ruler", f: "fog" };

/** Modos que só o GM pode ativar. */
const GM_ONLY_MODES = new Set<ToolMode>(["fog"]);

/**
 * Atalhos globais da barra de ferramentas: V/H/R/F trocam o modo (F só para o GM),
 * Esc cancela o gesto em andamento e volta para Selecionar, espaço segurado ativa
 * "mover mapa". Ctrl+Z (Cmd+Z): no modo Névoa desfaz a última forma pintada (sem refazer, SPEC
 * §9.3); fora dela é o desfazer geral (docs/plano-desfazer.md) — Ctrl+Shift+Z e Ctrl+Y refazem.
 * Os dois (Névoa e geral) são só do GM, como já era o de Névoa. Um único listener na janela
 * (montado pela página da mesa).
 */
export function useToolShortcuts(): void {
  useEffect(() => {
    const { setMode, setSpaceHeld, cancel } = useTools.getState();

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const isGm = selectIsGm(useRoom.getState());
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === "z" || key === "y")) {
        if (!isGm) return; // desfazer (de qualquer tipo) é só do GM
        if (useTools.getState().mode === "fog") {
          // Só Ctrl+Z desfaz a névoa — ela não tem "refazer" (SPEC §9.3); Ctrl+Shift+Z/Ctrl+Y não
          // fazem nada aqui dentro (não caem pro desfazer geral: mudaria o que a ferramenta ativa
          // deveria afetar).
          if (key === "z" && !e.shiftKey) {
            e.preventDefault();
            void useRoom.getState().fogOp({ type: "removeLast" });
          }
          return;
        }
        e.preventDefault();
        if (key === "y" || (key === "z" && e.shiftKey)) void useHistory.getState().redo();
        else void useHistory.getState().undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " ") {
        // Sem preventDefault a página rolaria; sem checar repeat, o auto-repeat re-setaria toda hora.
        e.preventDefault();
        if (!e.repeat) setSpaceHeld(true);
        return;
      }
      if (e.key === "Escape") {
        cancel();
        setMode("select");
        return;
      }
      const mode = KEY_TO_MODE[e.key.toLowerCase()];
      if (mode && (isGm || !GM_ONLY_MODES.has(mode))) setMode(mode);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") setSpaceHeld(false);
    };
    // Se a janela perde o foco com espaço apertado, o keyup nunca chega.
    const onBlur = () => setSpaceHeld(false);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
}
