import type { Token } from "@tormenta-vtt/shared";

/**
 * "Colocar no mapa" (SPEC §9.30). A ficha é a prateleira do personagem; o token é a presença dela
 * no mapa — então todo lugar que lista fichas (aba Fichas, cabeçalho da ficha, visão de grupo,
 * arrastar pro mapa) precisa das MESMAS três perguntas: dá pra colocar?, já tem token aqui?, onde
 * colocar. Este controlador é montado uma vez no `RoomPage` (único lugar que conhece o mapa visto e
 * o viewport do canvas) e desce como prop, em vez de cada componente remontar a regra.
 */
export interface PlaceOnMapController {
  /** false = não há mapa aberto: nada a colocar (botões desabilitados). */
  enabled: boolean;
  /** Token desta ficha no mapa que este cliente vê agora (o primeiro, se houver mais de um). */
  tokenOf: (characterId: string) => Token | null;
  /** Cria o token. `point` em pixels do mapa (arrastar); sem ele, no centro da área visível. */
  place: (characterId: string, point?: { x: number; y: number }) => void;
  /** Centraliza e seleciona um token que já está no mapa. */
  goTo: (tokenId: string) => void;
}
