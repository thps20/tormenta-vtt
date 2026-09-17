import { useEffect, useRef, useState } from "react";

/**
 * `true` quando `active` está ligado e não há mousemove/clique/tecla há `ms` — usado pelo modo
 * imersivo (docs/SPEC.md §9.22) pra sumir com as barras flutuantes. Qualquer atividade em QUALQUER
 * lugar da tela (inclusive sobre uma barra, a caminho dela) reseta o relógio, então "voltam no
 * hover" sai de graça: o mouse já se moveu antes de chegar na barra. Desligado (`active=false`),
 * nunca fica ocioso e nem escuta nada — barras fora do modo imersivo não pagam o custo de um
 * listener global.
 */
export function useIdle(active: boolean, ms = 2000): boolean {
  const [idle, setIdle] = useState(false);

  useEffect(() => {
    if (!active) {
      setIdle(false);
      return;
    }
    let timer: number | null = null;
    const reset = () => {
      setIdle(false);
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), ms);
    };
    reset();
    window.addEventListener("mousemove", reset);
    window.addEventListener("pointerdown", reset);
    // Captura: mover token com setas/WASD "gasta" a tecla (`useTokenMoveShortcuts` chama
    // stopPropagation), e mesmo assim isso é atividade — as barras do modo imersivo devem voltar.
    window.addEventListener("keydown", reset, { capture: true });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("mousemove", reset);
      window.removeEventListener("pointerdown", reset);
      window.removeEventListener("keydown", reset, { capture: true });
    };
  }, [active, ms]);

  return idle;
}
