/**
 * Foco em campo de texto: as teclas são para digitar, não para atalhos.
 * Compartilhado pelos atalhos da barra de ferramentas e da paleta do compêndio.
 */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable;
}
