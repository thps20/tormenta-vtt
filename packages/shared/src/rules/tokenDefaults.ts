/**
 * Aparência que a FICHA guarda para virar token no mapa (docs/SPEC.md §9.30). Duas funções puras
 * só pra as duas pontas (servidor ao criar/vincular token, web ao mostrar a miniatura e o fantasma
 * de arraste) nunca divergirem no que é "a aparência desta ficha".
 */
import { TokenDefaultsSchema, type TokenDefaults } from "../schemas/character.js";

/** Aparência de um token existente, no formato de `tokenDefaults` ("Salvar aparência na ficha"). */
export function tokenDefaultsFromToken(token: { imageUrl: string | null; cells: number; color: string }): TokenDefaults {
  return { imageUrl: token.imageUrl, cells: token.cells, color: token.color };
}

/** Aparência efetiva de uma ficha: a guardada, ou os padrões do schema quando ainda não há nenhuma. */
export function resolveTokenDefaults(defaults: TokenDefaults | null | undefined): TokenDefaults {
  return defaults ?? TokenDefaultsSchema.parse({});
}
