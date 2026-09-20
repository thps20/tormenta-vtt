/**
 * docs/SPEC.md §3.1 — "Minhas mesas": dono só vê/edita a própria sala, encerrar/reabrir, adotar
 * sala antiga por código + segredo de GM, e a listagem separa ativas de encerradas.
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../db.js";
import { adoptRoom, endRoom, listOwnedRooms, renameRoom, reopenRoom, RoomAccessError } from "./rooms.js";

describe("services/rooms", () => {
  const ownerKeyA = `owner-a-${randomUUID()}`;
  const ownerKeyB = `owner-b-${randomUUID()}`;
  const roomIds: string[] = [];

  afterEach(async () => {
    await prisma.room.deleteMany({ where: { id: { in: roomIds.splice(0) } } });
  });

  async function createRoom(opts: { name?: string; ownerKey?: string | null } = {}) {
    const room = await prisma.room.create({
      data: {
        name: opts.name ?? "Sala de teste",
        inviteCode: randomUUID().slice(0, 8).toUpperCase(),
        gmSecret: randomUUID(),
        ownerKey: opts.ownerKey ?? null,
      },
    });
    roomIds.push(room.id);
    return room;
  }

  describe("listOwnedRooms", () => {
    it("só lista salas do ownerKey pedido, e só as ativas por padrão", async () => {
      const mine = await createRoom({ ownerKey: ownerKeyA, name: "Minha sala" });
      await createRoom({ ownerKey: ownerKeyB, name: "Sala de outro dono" });
      await createRoom({ ownerKey: null, name: "Sala sem dono" });

      const list = await listOwnedRooms(ownerKeyA, "active");
      expect(list.map((r) => r.id)).toEqual([mine.id]);
      expect(list[0]!.gmSecret).toBe(mine.gmSecret);
      expect(list[0]!.participantCount).toBe(0);
      expect(list[0]!.mapCount).toBe(0);
    });

    it("separa encerradas de ativas", async () => {
      const active = await createRoom({ ownerKey: ownerKeyA });
      const ended = await createRoom({ ownerKey: ownerKeyA });
      await prisma.room.update({ where: { id: ended.id }, data: { deletedAt: new Date() } });

      expect((await listOwnedRooms(ownerKeyA, "active")).map((r) => r.id)).toEqual([active.id]);
      expect((await listOwnedRooms(ownerKeyA, "ended")).map((r) => r.id)).toEqual([ended.id]);
    });

    it("mapCount ignora mapas apagados (soft delete) e conta os que sobraram", async () => {
      const room = await createRoom({ ownerKey: ownerKeyA });
      await prisma.scene.create({ data: { roomId: room.id, name: "Mapa 1" } });
      const apagado = await prisma.scene.create({ data: { roomId: room.id, name: "Mapa 2" } });
      await prisma.scene.update({ where: { id: apagado.id }, data: { deletedAt: new Date() } });

      const [entry] = await listOwnedRooms(ownerKeyA, "active");
      expect(entry!.mapCount).toBe(1);
    });
  });

  describe("renameRoom", () => {
    it("dono renomeia", async () => {
      const room = await createRoom({ ownerKey: ownerKeyA, name: "Nome velho" });
      const updated = await renameRoom(room.id, ownerKeyA, "Nome novo");
      expect(updated.name).toBe("Nome novo");
    });

    it("rejeita quem não é o dono (ownerKey errado, ou sala sem ownerKey)", async () => {
      const room = await createRoom({ ownerKey: ownerKeyA });
      await expect(renameRoom(room.id, ownerKeyB, "Nome novo")).rejects.toThrow(RoomAccessError);

      const orfa = await createRoom({ ownerKey: null });
      await expect(renameRoom(orfa.id, ownerKeyA, "Nome novo")).rejects.toThrow(RoomAccessError);
    });

    it("sala inexistente -> RoomAccessError", async () => {
      await expect(renameRoom("id-que-nao-existe", ownerKeyA, "x")).rejects.toThrow(RoomAccessError);
    });
  });

  describe("endRoom / reopenRoom", () => {
    it("encerra com o nome confirmado certo, e a sala some da lista de ativas", async () => {
      const room = await createRoom({ ownerKey: ownerKeyA, name: "Mesa de Quinta" });
      const ended = await endRoom(room.id, ownerKeyA, "Mesa de Quinta");
      expect(ended.deletedAt).not.toBeNull();
      expect((await listOwnedRooms(ownerKeyA, "active")).map((r) => r.id)).not.toContain(room.id);
      expect((await listOwnedRooms(ownerKeyA, "ended")).map((r) => r.id)).toContain(room.id);
    });

    it("rejeita encerrar se o nome digitado não bate", async () => {
      const room = await createRoom({ ownerKey: ownerKeyA, name: "Mesa de Quinta" });
      await expect(endRoom(room.id, ownerKeyA, "Nome errado")).rejects.toThrow(RoomAccessError);
    });

    it("reabre e a sala volta pra lista de ativas", async () => {
      const room = await createRoom({ ownerKey: ownerKeyA, name: "Mesa de Sexta" });
      await endRoom(room.id, ownerKeyA, "Mesa de Sexta");
      const reopened = await reopenRoom(room.id, ownerKeyA);
      expect(reopened.deletedAt).toBeNull();
      expect((await listOwnedRooms(ownerKeyA, "active")).map((r) => r.id)).toContain(room.id);
    });

    it("dono errado não encerra nem reabre", async () => {
      const room = await createRoom({ ownerKey: ownerKeyA, name: "Mesa" });
      await expect(endRoom(room.id, ownerKeyB, "Mesa")).rejects.toThrow(RoomAccessError);
      await expect(reopenRoom(room.id, ownerKeyB)).rejects.toThrow(RoomAccessError);
    });
  });

  describe("adoptRoom", () => {
    it("com código + segredo certos, grava o ownerKey e a sala passa a aparecer na lista", async () => {
      const room = await createRoom({ ownerKey: null });
      const adopted = await adoptRoom(room.inviteCode, room.gmSecret, ownerKeyA);
      expect(adopted.id).toBe(room.id);
      expect((await listOwnedRooms(ownerKeyA, "active")).map((r) => r.id)).toContain(room.id);
    });

    it("sobrescreve o ownerKey de uma sala já adotada por outro navegador", async () => {
      const room = await createRoom({ ownerKey: ownerKeyA });
      await adoptRoom(room.inviteCode, room.gmSecret, ownerKeyB);
      expect((await listOwnedRooms(ownerKeyA, "active")).map((r) => r.id)).not.toContain(room.id);
      expect((await listOwnedRooms(ownerKeyB, "active")).map((r) => r.id)).toContain(room.id);
    });

    it("rejeita segredo de GM errado", async () => {
      const room = await createRoom({ ownerKey: null });
      await expect(adoptRoom(room.inviteCode, "segredo-errado", ownerKeyA)).rejects.toThrow(RoomAccessError);
    });

    it("rejeita código de sala inexistente", async () => {
      await expect(adoptRoom("NAOEXISTE", "qualquer", ownerKeyA)).rejects.toThrow(RoomAccessError);
    });
  });
});
