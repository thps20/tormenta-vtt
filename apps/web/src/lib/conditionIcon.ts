/**
 * O ícone de uma condição (`ConditionDef.icon`) é um SVG que usa `currentColor` — funciona de graça
 * no menu (DOM, herda a cor via CSS). No canvas (Konva) não tem DOM/CSS: rasterizamos o SVG numa
 * imagem, então precisamos gravar a cor de verdade no texto antes de virar `data:` URI (ver
 * `useImage`, que já sabe carregar qualquer URL de imagem pro Konva desenhar).
 */
export function conditionIconDataUrl(icon: string, color: string): string {
  const colored = icon.replaceAll("currentColor", color);
  return `data:image/svg+xml,${encodeURIComponent(colored)}`;
}
