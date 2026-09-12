/** docs/SPEC.md §9.19: favoritos são por PARTICIPANTE — add/remove idempotentes e isolados entre participantes. */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../db.js";
import { listFavoriteEntryIds } from "./compendiumFavorites.js";

describe("services/compendiumFavorites", () => {
  let roomId: string;
  let participantAId: string;
  let participantBId: string;

  beforeAll(async () => {
    const room = await prisma.room.create({ data: { name: "Sala de teste (favoritos)", inviteCode: randomUUID(), gmSecret: randomUUID(), systemId: "tormenta20" } });
    roomId = room.id;
    const a = await prisma.participant.create({ data: { roomId, nickname: "A", role: "player" } });
    const b = await prisma.participant.create({ data: { roomId, nickname: "B", role: "player" } });
    participantAId = a.id;
    participantBId = b.id;
  });

  afterAll(async () => {
    await prisma.room.delete({ where: { id: roomId } });
  });

  beforeEach(async () => {
    await prisma.compendiumFavorite.deleteMany({ where: { roomId } });
  });

  it("lista vazia sem favoritos", async () => {
    expect(await listFavoriteEntryIds(roomId, participantAId)).toEqual([]);
  });

  it("upsert (mesmo padrão do handler): favoritar não duplica ao repetir", async () => {
    const upsert = () =>
      prisma.compendiumFavorite.upsert({
        where: { participantId_entryId: { participantId: participantAId, entryId: "goblin" } },
        update: {},
        create: { roomId, participantId: participantAId, entryId: "goblin" },
      });
    await upsert();
    await upsert();
    expect(await listFavoriteEntryIds(roomId, participantAId)).toEqual(["goblin"]);
  });

  it("remover (deleteMany, mesmo padrão do handler) é idempotente", async () => {
    await prisma.compendiumFavorite.deleteMany({ where: { participantId: participantAId, entryId: "nunca-favoritado" } });
    expect(await listFavoriteEntryIds(roomId, participantAId)).toEqual([]);
  });

  it("favoritos são isolados por participante", async () => {
    await prisma.compendiumFavorite.create({ data: { roomId, participantId: participantAId, entryId: "espada-longa" } });
    await prisma.compendiumFavorite.create({ data: { roomId, participantId: participantBId, entryId: "goblin" } });
    expect(await listFavoriteEntryIds(roomId, participantAId)).toEqual(["espada-longa"]);
    expect(await listFavoriteEntryIds(roomId, participantBId)).toEqual(["goblin"]);
  });
});
