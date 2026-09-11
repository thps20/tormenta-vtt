import {
  PartyAddSchema,
  PartyRemoveSchema,
  PartyReorderSchema,
  PartySetHiddenSchema,
  addToParty,
  removeFromParty,
  reorderParty,
  setPartyHidden,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { partyOf, saveAndBroadcastParty } from "../services/party.js";
import { guarded, HandlerError } from "./ack.js";
import type { TypedServer, TypedSocket } from "./types.js";

const gmOnly = { gmOnly: true };

/** Carrega Room.party (já validado) desta sala; erro se a sala sumiu (não deveria, o socket já está nela). */
async function requireRoomParty(roomId: string) {
  const room = await prisma.room.findUnique({ where: { id: roomId }, select: { party: true } });
  if (!room) throw new HandlerError("Sala não encontrada");
  return partyOf(room);
}

/** GM: um PC desta sala que ainda não está no grupo. */
async function requirePcInRoom(characterId: string, roomId: string): Promise<void> {
  const character = await prisma.character.findUnique({ where: { id: characterId }, select: { roomId: true, kind: true } });
  if (!character || character.roomId !== roomId) throw new HandlerError("Ficha não encontrada");
  if (character.kind !== "pc") throw new HandlerError("Só personagens de jogador entram no grupo");
}

/**
 * Grupo da "Visão de grupo" (SPEC §9.15): Room.party, gerenciado pelo Mestre. Um PC novo já entra
 * sozinho (character:create, ver socket/character.ts); estes quatro eventos cobrem o resto —
 * adicionar de volta, ocultar/mostrar, remover, reordenar. Todos gmOnly.
 */
export function registerPartyHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "party:add",
    guarded(
      socket,
      PartyAddSchema,
      async ({ characterId }, ctx) => {
        await requirePcInRoom(characterId, ctx.roomId);
        const current = await requireRoomParty(ctx.roomId);
        return saveAndBroadcastParty(io, ctx.roomId, addToParty(current, characterId));
      },
      gmOnly,
    ),
  );

  socket.on(
    "party:remove",
    guarded(
      socket,
      PartyRemoveSchema,
      async ({ characterId }, ctx) => {
        const current = await requireRoomParty(ctx.roomId);
        return saveAndBroadcastParty(io, ctx.roomId, removeFromParty(current, characterId));
      },
      gmOnly,
    ),
  );

  socket.on(
    "party:set-hidden",
    guarded(
      socket,
      PartySetHiddenSchema,
      async ({ characterId, hidden }, ctx) => {
        const current = await requireRoomParty(ctx.roomId);
        return saveAndBroadcastParty(io, ctx.roomId, setPartyHidden(current, characterId, hidden));
      },
      gmOnly,
    ),
  );

  socket.on(
    "party:reorder",
    guarded(
      socket,
      PartyReorderSchema,
      async ({ characterIds }, ctx) => {
        const current = await requireRoomParty(ctx.roomId);
        const result = reorderParty(current, characterIds);
        if (!result.ok) throw new HandlerError(result.error);
        return saveAndBroadcastParty(io, ctx.roomId, result.entries);
      },
      gmOnly,
    ),
  );
}
