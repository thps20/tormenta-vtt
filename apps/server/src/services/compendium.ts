import { mergeCompendium, type CompendiumEntry, type CompendiumSource } from "@tormenta-vtt/shared";
import { getSystemCompendium } from "@tormenta-vtt/shared/compendium";

/** Prioridade da fonte da sala: acima do sistema (0), para o homebrew do GM substituir entradas pelo id. */
const ROOM_PRIORITY = 10;

/**
 * Compêndio da SALA (homebrew do GM). Ainda não existe tela nem tabela: devolve
 * uma fonte vazia. Quando existir, é só trocar o corpo desta função (ler do
 * banco e validar com validateCompendiumEntries), e o merge abaixo já aplica a
 * prioridade.
 */
async function roomCompendiumSource(roomId: string): Promise<CompendiumSource> {
  return { id: `room:${roomId}`, label: "Homebrew da sala", priority: ROOM_PRIORITY, entries: [] };
}

/** Lista completa que o cliente vê: sistema + sala, com a sala vencendo em id repetido. */
export async function listCompendium(systemId: string, roomId: string): Promise<CompendiumEntry[]> {
  return mergeCompendium([getSystemCompendium(systemId), await roomCompendiumSource(roomId)]);
}
