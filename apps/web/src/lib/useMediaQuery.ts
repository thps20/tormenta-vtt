import { useEffect, useState } from "react";

/**
 * Reflete uma media query do CSS como estado do React. Usa window.matchMedia,
 * então a regra é a mesma que o CSS usaria (ex.: "(min-width: 1180px)") e o
 * componente re-renderiza quando a janela cruza o limite.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}
