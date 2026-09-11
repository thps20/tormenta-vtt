import { Prisma, type Room as DbRoom } from "@prisma/client";
import { PartyArraySchema, removeFromParty, type PartyEntry } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { rooms, type TypedServer } from "../socket/types.js";

/** Lê `Room.party` (JSON) já validado. Linha antiga sem a coluna preenchida (ou sala criada antes
 *  desta migration) vira lista vazia — sem precisar de migration de dado. */
export function partyOf(room: Pick<DbRoom, "party">): PartyEntry[] {
  return PartyArraySchema.parse(room.party ?? []);
}

/**
 * O que cada papel recebe (SPEC §9.15): uma entrada só existe pra alguém se o personagem dela AINDA
 * é PC nesta sala (`pcIds`) — apagar a ficha, ou ela virar NPC, tira a entrada de todo mundo, GM
 * inclusive (deixou de ser "o grupo"). Dali, GM vê tudo (oculta inclusive — a UI dele esmaece);
 * jogador nunca vê entrada `hidden`. Pura: testável sem banco (ver party.test.ts).
 */
export function partyFor(entries: PartyEntry[], pcIds: ReadonlySet<string>, role: "gm" | "player"): PartyEntry[] {
  const live = entries.filter((e) => pcIds.has(e.characterId));
  return role === "gm" ? live : live.filter((e) => !e.hidden);
}

/** Ids de Character `kind: "pc"` da sala — a fonte da verdade de "ainda é PC" pra `partyFor`. */
export async function pcIdsOf(roomId: string): Promise<Set<string>> {
  const rows = await prisma.character.findMany({ where: { roomId, kind: "pc" }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

/**
 * Persiste a lista (já validada por quem chama — `reorderParty`/`addToParty`/etc., shared) e avisa
 * a sala: GM e jogadores recebem listas FILTRADAS DIFERENTES (`partyFor`), nunca o mesmo broadcast.
 * Devolve a visão do GM, que é quem sempre chama estes eventos (todo `party:*` é `gmOnly`) — o ack
 * mostra pra ele o que acabou de persistir, ocultas inclusive.
 */
export async function saveAndBroadcastParty(io: TypedServer, roomId: string, entries: PartyEntry[]): Promise<PartyEntry[]> {
  await prisma.room.update({ where: { id: roomId }, data: { party: entries as unknown as Prisma.InputJsonValue } });
  const pcIds = await pcIdsOf(roomId);
  const forGm = partyFor(entries, pcIds, "gm");
  io.to(rooms.gm(roomId)).emit("party:updated", { party: forGm });
  io.to(rooms.players(roomId)).emit("party:updated", { party: partyFor(entries, pcIds, "player") });
  return forGm;
}

/**
 * Tira uma entrada do grupo por conta de outro evento (ficha apagada, ou deixou de ser PC) — não é
 * um `party:*` em si, então não passa pelo `gmOnly` dos handlers; quem chama já validou a ação que
 * disparou isso. No-op silencioso se a entrada não existia (removeFromParty é idempotente).
 */
export async function pruneFromParty(io: TypedServer, roomId: string, characterId: string): Promise<void> {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { party: true } });
  if (!room) return;
  const current = partyOf(room);
  if (!current.some((e) => e.characterId === characterId)) return;
  await saveAndBroadcastParty(io, roomId, removeFromParty(current, characterId));
}
