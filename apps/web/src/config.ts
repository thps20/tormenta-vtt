/**
 * URL do servidor. Vite só expõe variáveis com prefixo VITE_.
 * Vazia (padrão): usa a mesma origem da página e o proxy do Vite repassa ao
 * server. Funciona em localhost e atrás de um túnel público (make tunnel).
 * Preencha só para falar direto com o server, sem passar pelo proxy.
 */
export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL || window.location.origin;
