/**
 * Ícone de condição (`ConditionDef.icon`): um SVG embutido no JSON do sistema que usa `currentColor`.
 *
 * No DOM isso funciona de graça (o SVG inline herda a cor via CSS). No canvas (Konva) não há DOM nem
 * CSS: o SVG precisa virar uma IMAGEM, e uma imagem é estática — então a cor tem que estar gravada no
 * texto antes de virar `data:` URI.
 *
 * Mora no shared (e não no web) pra que o teste de `conditions[]` valide exatamente a função que a
 * aplicação usa, em vez de uma cópia da regra de codificação.
 */

/** Prefixo do data URI; um SVG standalone precisa de `xmlns` pra ser aceito como imagem. */
const SVG_DATA_PREFIX = "data:image/svg+xml,";

/**
 * SVG do JSON + cor da condição -> `data:` URI pronto pra um `<img>`/`Konva.Image`.
 * `encodeURIComponent` é obrigatório: a cor é um hex (`#a855f7`) e um `#` cru cortaria a URI no
 * fragmento, deixando a imagem quebrada.
 */
export function conditionIconDataUrl(icon: string, color: string): string {
  return `${SVG_DATA_PREFIX}${encodeURIComponent(icon.replaceAll("currentColor", color))}`;
}

/** Volta o `data:` URI para o texto do SVG (usado nos testes pra conferir o round-trip). */
export function decodeConditionIconDataUrl(url: string): string | null {
  if (!url.startsWith(SVG_DATA_PREFIX)) return null;
  try {
    return decodeURIComponent(url.slice(SVG_DATA_PREFIX.length));
  } catch {
    return null;
  }
}
