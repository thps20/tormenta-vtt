import { useEffect, useState } from "react";
import { setSessionToken, type SessionRole } from "./session";

/**
 * Roteador mínimo baseado em window.location. Só temos duas rotas
 * ("/" e "/room/:inviteCode?gm=<segredo>"), então não vale uma dependência.
 * `navigate` usa pushState para não recarregar a página.
 */
export type Route =
  | { name: "lobby" }
  | { name: "room"; inviteCode: string; gmSecret: string | null }
  /** Cast — tela de exibição (docs/plano-cast.md): `/room/<código>?display=<token>`. */
  | { name: "display"; inviteCode: string; displayToken: string };

const ROOM_RE = /^\/room\/([A-Za-z0-9]+)\/?$/;

/**
 * Sessão por URL (docs/testar-com-amigos.md): `?session=<token>` grava no localStorage (mesma
 * chave de sempre, por papel — GM se `?gm=` também estiver na URL, senão jogador; é a mesma regra
 * que `store/room.ts#join` usa para decidir o papel) e some da URL na hora (`history.replaceState`,
 * sem recarregar nem empilhar uma entrada no histórico), pra não ficar pendurado num link
 * copiado/favoritado depois. Roda ANTES do primeiro `parseRoute` (na inicialização "preguiçosa" do
 * `useState` do `useRoute`, que acontece durante a renderização, antes de qualquer efeito) — assim
 * `join` já encontra o token pronto no localStorage no primeiro `useEffect` que rodar, sem precisar
 * mudar nada lá. Idempotente: sem `?session=` na URL, não faz nada.
 */
function consumeSessionParam(pathname: string, search: string): void {
  const params = new URLSearchParams(search);
  const token = params.get("session");
  if (!token) return;
  const m = ROOM_RE.exec(pathname);
  if (!m || !m[1]) return;
  const role: SessionRole = params.has("gm") ? "gm" : "player";
  setSessionToken(m[1].toUpperCase(), role, token);
  params.delete("session");
  const query = params.toString();
  window.history.replaceState(null, "", `${pathname}${query ? `?${query}` : ""}`);
}

export function parseRoute(pathname: string, search: string): Route {
  const m = ROOM_RE.exec(pathname);
  // Cast (docs/plano-cast.md §3.1): ?display=<token> é a rota da tela de exibição — nunca passa
  // por `consumeSessionParam` (a tela não é um Participant, não tem sessão de participante pra
  // guardar) nem aceita `?gm=` junto (o link de Cast já É a credencial).
  const displayToken = m && m[1] ? new URLSearchParams(search).get("display") : null;
  if (m && m[1] && displayToken) {
    return { name: "display", inviteCode: m[1].toUpperCase(), displayToken };
  }
  consumeSessionParam(pathname, search);
  if (m && m[1]) {
    return { name: "room", inviteCode: m[1].toUpperCase(), gmSecret: new URLSearchParams(search).get("gm") };
  }
  return { name: "lobby" };
}

export function roomPath(inviteCode: string, gmSecret?: string | null): string {
  return `/room/${inviteCode}${gmSecret ? `?gm=${encodeURIComponent(gmSecret)}` : ""}`;
}

/** Cast (docs/plano-cast.md): caminho da tela de exibição — link que o GM copia/abre em nova janela. */
export function displayPath(inviteCode: string, displayToken: string): string {
  return `/room/${inviteCode}?display=${encodeURIComponent(displayToken)}`;
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
