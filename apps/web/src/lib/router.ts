import { useEffect, useState } from "react";

/**
 * Roteador mínimo baseado em window.location. Só temos duas rotas
 * ("/" e "/room/:inviteCode?gm=<segredo>"), então não vale uma dependência.
 * `navigate` usa pushState para não recarregar a página.
 */
export type Route = { name: "lobby" } | { name: "room"; inviteCode: string; gmSecret: string | null };

const ROOM_RE = /^\/room\/([A-Za-z0-9]+)\/?$/;

export function parseRoute(pathname: string, search: string): Route {
  const m = ROOM_RE.exec(pathname);
  if (m && m[1]) {
    return { name: "room", inviteCode: m[1].toUpperCase(), gmSecret: new URLSearchParams(search).get("gm") };
  }
  return { name: "lobby" };
}

export function roomPath(inviteCode: string, gmSecret?: string | null): string {
  return `/room/${inviteCode}${gmSecret ? `?gm=${encodeURIComponent(gmSecret)}` : ""}`;
}

const listeners = new Set<() => void>();

export function navigate(path: string): void {
  window.history.pushState(null, "", path);
  listeners.forEach((l) => l());
}

/** Hook: devolve a rota atual e re-renderiza quando ela muda (navigate ou botão voltar). */
export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.pathname, window.location.search));
  useEffect(() => {
    const update = () => setRoute(parseRoute(window.location.pathname, window.location.search));
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return route;
}
