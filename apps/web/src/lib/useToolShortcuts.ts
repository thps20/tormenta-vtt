import { useEffect } from "react";
import { useHistory } from "../store/history";
import { useTemplateHistory } from "../store/templateHistory";
import { useDrawingHistory } from "../store/drawingHistory";
import { selectIsGm, useRoom } from "../store/room";
import { useTools, type ToolMode } from "../store/tools";
import { isTyping } from "./isTyping";
import { KEY_TO_MODE, wasKeyConsumed } from "./shortcutKeys";

/** Modos que só o GM pode ativar. */
const GM_ONLY_MODES = new Set<ToolMode>(["fog", "pin"]);

/**
 * Atalhos globais da barra de ferramentas: V/H/R/F/T trocam o modo (F só para o GM; T = Área,
 * docs/plano-gabaritos.md, também para jogador), Esc cancela o gesto em andamento e volta para
 * Selecionar, espaço segurado ativa
 * "mover mapa". Ctrl+Z (Cmd+Z): no modo Névoa desfaz a última forma pintada (sem refazer, SPEC
 * §9.3); fora dela é o desfazer geral do GM (docs/plano-desfazer.md) — Ctrl+Shift+Z e Ctrl+Y
 * refazem. Jogador não tem essa pilha geral, mas tem pilhas locais próprias — gabaritos de área
 * (`store/templateHistory.ts`, docs/plano-gabaritos.md §4) e desenho livre
 * (`store/drawingHistory.ts`, SPEC §9.17), uma por ferramenta (Ctrl+Z no modo Desenho desfaz o
 * último traço; qualquer outro modo desfaz o último gabarito) — só Ctrl+Z, sem refazer, mesmo
 * motivo da Névoa não ter. Um único listener na janela (montado pela página da mesa).
 *
 * Com token selecionado que este usuário pode mover, a letra que também move token (WASD — hoje só
 * o D, Desenho) é consumida por `useTokenMoveShortcuts` e não chega aqui; sem seleção (ou sem poder
 * mover agora, ex.: não é o seu turno), D volta a ser Desenho.
 *
 * Shift+letra nunca troca de modo (só letra solta) — deixa a combinação livre pra outros atalhos,
 * como o Shift+F do modo imersivo (docs/SPEC.md §9.22, `useImmersiveModeShortcut`).
 */
export function useToolShortcuts(): void {
  useEffect(() => {
    const { setMode, setSpaceHeld, cancel } = useTools.getState();

    const onKeyDown = (e: KeyboardEvent) => {
      // Tecla já gasta por um atalho mais específico — hoje, mover token com setas/WASD (ver
      // `useTokenMoveShortcuts`, que roda na captura): D com token selecionado move e não troca de
      // ferramenta. O `stopPropagation` de lá já impede este listener de rodar; esta checagem é a
      // rede de segurança se um dia a ordem/fase dos listeners mudar.
      if (wasKeyConsumed(e) || isTyping(e.target)) return;
      const isGm = selectIsGm(useRoom.getState());
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (key === "z" || key === "y")) {
        if (!isGm) {
          if (key === "z" && !e.shiftKey) {
            e.preventDefault();
            if (useTools.getState().mode === "draw") void useDrawingHistory.getState().undo();
            else void useTemplateHistory.getState().undo();
          }
          return;
        }
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
      // Shift+letra fica de fora do mapeamento tecla→modo (Shift+F é o atalho do modo imersivo,
      // docs/SPEC.md §9.22 — sem isso, também cairia em "Névoa" aqui).
      const mode = e.shiftKey ? undefined : KEY_TO_MODE[e.key.toLowerCase()];
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
