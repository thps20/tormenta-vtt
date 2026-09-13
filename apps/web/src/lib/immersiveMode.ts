/**
 * Modo imersivo do mapa (docs/SPEC.md §9.22): a cor de fundo fora do mapa nesse modo é preferência
 * PESSOAL (localStorage, chave única — é gosto de tela, não varia por sala nem por mapa, ao
 * contrário de `lib/gridAppearance.ts`). Fica só neste arquivo pra não duplicar a constante entre
 * `RoomPage` (lê/grava a preferência), `VttCanvas` (usa pra pintar o fundo) e `ImmersiveModeMenu`
 * (mostra no seletor de cor). `null` na preferência = usar este padrão.
 */
export const DEFAULT_IMMERSIVE_BG_COLOR = "#0a0a0a";
