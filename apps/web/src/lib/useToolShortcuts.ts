import { useEffect } from "react";
import { useTools, type ToolMode } from "../store/tools";

/** Tecla → modo. Letras em minúsculo; comparamos com e.key.toLowerCase(). */
const KEY_TO_MODE: Record<string, ToolMode> = { v: "select", h: "pan", r: "ruler" };

/** Foco em campo de texto: as teclas são para digitar, não para trocar de ferramenta. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
}

/**
 * Atalhos globais da barra de ferramentas: V/H/R trocam o modo, Esc volta para
 * Selecionar, espaço segurado ativa "mover mapa" enquanto durar.
 * Um único listener na janela (montado pela página da mesa).
 */
export function useToolShortcuts(): void {
  useEffect(() => {
    const { setMode, setSpaceHeld } = useTools.getState();

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === " ") {
        // Sem preventDefault a página rolaria; sem checar repeat, o auto-repeat re-setaria toda hora.
        e.preventDefault();
        if (!e.repeat) setSpaceHeld(true);
        return;
      }
      if (e.key === "Escape") {
        setMode("select");
        return;
      }
      const mode = KEY_TO_MODE[e.key.toLowerCase()];
      if (mode) setMode(mode);
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
