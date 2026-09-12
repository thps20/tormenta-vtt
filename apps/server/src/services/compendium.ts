import { mergeCompendium, type CompendiumList, type CompendiumSource } from "@tormenta-vtt/shared";
import { getSystemCompendium } from "@tormenta-vtt/shared/compendium";
import { roomCompendiumEntries } from "./roomCompendium.js";

/** Prioridade da fonte da sala: acima do sistema (0), para o homebrew do GM substituir entradas pelo id. */
const ROOM_PRIORITY = 10;

/**
 * Compêndio da SALA (homebrew do GM, docs/plano-compendio-sala.md): lê `RoomCompendiumEntry` da
 * sala. Entradas ruins (não deveria acontecer — já validamos na gravação) ficam de fora, avisadas no
 * log (`roomCompendiumEntries`), em vez de derrubar a sala inteira.
 */
async function roomCompendiumSource(roomId: string): Promise<CompendiumSource> {
  return { id: `room:${roomId}`, label: "Homebrew da sala", priority: ROOM_PRIORITY, entries: await roomCompendiumEntries(roomId) };
}

/**
 * Lista que `role` vê: sistema + sala, com a sala vencendo em id repetido. Jogador nunca recebe
 * uma entrada `type: "creature"` (nem nome, nem PV) — a UI também esconde, mas a regra que vale é
 * esta. `roomIds` são os ids que vieram da fonte da sala, para a paleta mostrar o chip "Sala" só
 * quando houver conteúdo.
 */
export async function listCompendium(systemId: string, roomId: string, role: "gm" | "player"): Promise<CompendiumList> {
  const roomSource = await roomCompendiumSource(roomId);
  const entries = mergeCompendium([getSystemCompendium(systemId), roomSource]).filter((e) => e.type !== "creature" || role === "gm");
  return { entries, roomIds: roomSource.entries.map((e) => e.id) };
}
