import { useEffect } from "react";
import { selectIsGm, useRoom } from "../store/room";
import { useTools, type ToolMode } from "../store/tools";

/** Tecla → modo. Letras em minúsculo; comparamos com e.key.toLowerCase(). */
const KEY_TO_MODE: Record<string, ToolMode> = { v: "select", h: "pan", r: "ruler", f: "fog" };

/** Modos que só o GM pode ativar. */
const GM_ONLY_MODES = new Set<ToolMode>(["fog"]);

/** Foco em campo de texto: as teclas são para digitar, não para trocar de ferramenta. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
}

/**
 * Atalhos globais da barra de ferramentas: V/H/R/F trocam o modo (F só para o GM),
 * Esc cancela o gesto em andamento e volta para Selecionar, espaço segurado ativa
 * "mover mapa", Ctrl+Z no modo Névoa desfaz a última forma.
 * Um único listener na janela (montado pela página da mesa).
 */
export function useToolShortcuts(): void {
  useEffect(() => {
    const { setMode, setSpaceHeld, cancel } = useTools.getState();

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const isGm = selectIsGm(useRoom.getState());
      // Ctrl+Z (Cmd+Z no Mac) no modo Névoa: desfaz a última forma. Sem histórico completo.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "z") {
        if (isGm && useTools.getState().mode === "fog") {
          e.preventDefault();
          void useRoom.getState().fogOp({ type: "removeLast" });
        }
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
