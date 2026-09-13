import { useCallback, useEffect, useState } from "react";

/**
 * Tela cheia do navegador (Fullscreen API) na página inteira — item do menu do modo imersivo
 * (docs/SPEC.md §9.22), mas independente dele (combinável: dá pra entrar só em um dos dois, ou nos
 * dois). Reflete o estado REAL do navegador via `fullscreenchange`: sair pelo F11 ou pelo Esc nativo
 * do navegador (fora do nosso controle) também atualiza `isFullscreen`.
 */
export function useFullscreen(): { isFullscreen: boolean; toggle: () => void } {
  const [isFullscreen, setIsFullscreen] = useState(() => document.fullscreenElement !== null);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    // Alguns navegadores recusam (sem gesto do usuário, sem suporte, permissão de iframe etc.):
    // sem toast pra não incomodar por causa de um extra opcional — mesma tolerância de
    // `lib/session.ts` a `localStorage` bloqueado.
    document.documentElement.requestFullscreen().catch(() => {
      /* ignora */
    });
  }, []);

  return { isFullscreen, toggle };
}
