import { useEffect, useState, type RefObject } from "react";
import { useUi } from "../store/ui";

/**
 * Barras flutuantes translúcidas sobre o mapa: `true` quando o elemento de `ref` está fisicamente
 * sobre a imagem do mapa (interseção com `useUi().mapScreenRect`, em coordenadas de tela — já
 * considera zoom/pan) E nem o mouse nem o foco de teclado estão nele. Sobre o fundo vazio do canvas
 * (sem mapa embaixo) a barra sempre fica opaca. `enabled` é a preferência do usuário — desligada,
 * a função nunca devolve `true`.
 *
 * Usado pela Toolbar (barra vertical) e pelo HUD inferior do VttCanvas: cada um chama com seu
 * próprio ref, e os dois leem o mesmo `mapScreenRect` publicado pelo VttCanvas.
 */
export function useBarTranslucency(ref: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const mapRect = useUi((s) => s.mapScreenRect);
  const [overMap, setOverMap] = useState(false);
  const [hot, setHot] = useState(false); // mouse em cima ou foco de teclado dentro da barra

  // Recalcula a interseção quando o mapa muda de zoom/pan/tamanho (mapRect) ou a própria barra
  // muda de posição/tamanho (ResizeObserver — cobre o HUD inferior mudando de largura ao ligar/
  // desligar o botão "Token", por exemplo).
  useEffect(() => {
    const el = ref.current;
    if (!el || !mapRect) {
      setOverMap(false);
      return;
    }
    const recompute = () => {
      const r = el.getBoundingClientRect();
      setOverMap(r.left < mapRect.right && r.right > mapRect.left && r.top < mapRect.bottom && r.bottom > mapRect.top);
    };
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, mapRect]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onHotOn = () => setHot(true);
    const onHotOff = () => setHot(false);
    const onFocusOut = (e: FocusEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) setHot(false);
    };
    el.addEventListener("mouseenter", onHotOn);
    el.addEventListener("mouseleave", onHotOff);
    el.addEventListener("focusin", onHotOn);
    el.addEventListener("focusout", onFocusOut);
    return () => {
      el.removeEventListener("mouseenter", onHotOn);
      el.removeEventListener("mouseleave", onHotOff);
      el.removeEventListener("focusin", onHotOn);
      el.removeEventListener("focusout", onFocusOut);
    };
  }, [ref]);

  return enabled && overMap && !hot;
}
