import type { ToolMode } from "../store/tools";

/**
 * Tabelas de teclas compartilhadas pelos atalhos da mesa e a marcação de "tecla já consumida".
 *
 * Mora num módulo próprio (e não dentro de cada hook) por dois motivos: os dois hooks precisam
 * enxergar a tabela do outro pra resolver a colisão do **D** (Desenho × mover token para a direita),
 * e importar um hook do outro criava um ciclo de imports — frágil, porque numa avaliação circular um
 * `const` pode ainda não existir na hora da chamada.
 */

/** Tecla → direção (célula). Setas e WASD apontam pro mesmo lugar. */
export const KEY_TO_DELTA: Record<string, { dx: number; dy: number }> = {
  arrowup: { dx: 0, dy: -1 },
  arrowdown: { dx: 0, dy: 1 },
  arrowleft: { dx: -1, dy: 0 },
  arrowright: { dx: 1, dy: 0 },
  w: { dx: 0, dy: -1 },
  s: { dx: 0, dy: 1 },
  a: { dx: -1, dy: 0 },
  d: { dx: 1, dy: 0 },
};

/** Tecla → modo da barra de ferramentas. Letras em minúsculo; comparamos com e.key.toLowerCase(). */
export const KEY_TO_MODE: Record<string, ToolMode> = { v: "select", h: "pan", r: "ruler", f: "fog", t: "template", p: "pin", d: "draw" };

/** Tecla que move token (setas/WASD)? */
export function isTokenMoveKey(key: string): boolean {
  return KEY_TO_DELTA[key.toLowerCase()] !== undefined;
}

/** Letra solta que troca de ferramenta? */
export function isToolShortcutKey(key: string): boolean {
  return KEY_TO_MODE[key.toLowerCase()] !== undefined;
}

/**
 * Teclas já "gastas" por um atalho mais específico. Quem consome (hoje só o movimento de token, que
 * roda na fase de CAPTURA e já chama `stopPropagation`) marca o evento aqui; quem vem depois
 * pergunta antes de agir. É uma rede de segurança para o caso de alguém registrar um listener
 * também na captura, ou antes deste: aí `stopPropagation` sozinho não bastaria.
 * `WeakSet` para não segurar o evento na memória.
 */
const consumed = new WeakSet<KeyboardEvent>();

export function markKeyConsumed(e: KeyboardEvent): void {
  consumed.add(e);
}

export function wasKeyConsumed(e: KeyboardEvent): boolean {
  return consumed.has(e);
}
