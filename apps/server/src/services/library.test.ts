/**
 * docs/plano-preparo.md §1: Asset (acervo) e LibraryFavorite. Handlers de socket
 * (socket/library.ts) são só `guarded` + emitir, como handout — a lógica que vale testar mora aqui
 * (mesmo espírito de services/roomCompendium.test.ts).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../db.js";
import { canChangeAssetKind, requireAsset, toAsset } from "./library.js";

describe("canChangeAssetKind (§1.2: kind só troca entre map↔token)", () => {
  it("sem kind no patch: sempre permitido", () => {
    expect(canChangeAssetKind("map", undefined)).toBe(true);
    expect(canChangeAssetKind("audio", undefined)).toBe(true);
  });

  it("map↔token: permitido nos dois sentidos", () => {
    expect(canChangeAssetKind("map", "token")).toBe(true);
    expect(canChangeAssetKind("token", "map")).toBe(true);
  });

  it("nunca vira nem sai de audio", () => {
    expect(canChangeAssetKind("audio", "map")).toBe(false);
    expect(canChangeAssetKind("audio", "token")).toBe(false);
    expect(canChangeAssetKind("map", "audio")).toBe(false);
  });
});

describe("services/library (Asset/LibraryFavorite)", () => {
  let roomId: string;

  beforeAll(async () => {
    const room = await prisma.room.create({ data: { name: "Sala de teste (acervo)", inviteCode: randomUUID(), gmSecret: randomUUID(), systemId: "tormenta20" } });
    roomId = room.id;
  });

  afterAll(async () => {
    await prisma.room.delete({ where: { id: roomId } });
  });

  beforeEach(async () => {
    await prisma.asset.deleteMany({ where: { roomId } });
    await prisma.libraryFavorite.deleteMany({ where: { roomId } });
  });

  it("cria, converte e apaga (soft delete) um asset", async () => {
    const row = await prisma.asset.create({ data: { roomId, kind: "token", name: "Goblin", url: "/uploads/a.png", width: 100, height: 100, tags: ["monstro"] } });
    const asset = toAsset(row);
    expect(asset).toMatchObject({ kind: "token", name: "Goblin", url: "/uploads/a.png", width: 100, height: 100, tags: ["monstro"] });

    await prisma.asset.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    await expect(requireAsset(row.id, roomId)).rejects.toThrow("não encontrado");
  });

  it("requireAsset recusa asset de outra sala", async () => {
    const row = await prisma.asset.create({ data: { roomId, kind: "map", name: "Masmorra", url: "/uploads/b.png", width: 10, height: 10 } });
    await expect(requireAsset(row.id, "outra-sala")).rejects.toThrow("não encontrado");
  });

  it("desfazer o apagar (revert) restaura o asset (mesmo padrão de buildHandoutDeleteHistoryEntry)", async () => {
    const row = await prisma.asset.create({ data: { roomId, kind: "audio", name: "Taverna", url: "/uploads/c.mp3", durationMs: 60_000 } });
    await prisma.asset.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
    await prisma.asset.update({ where: { id: row.id }, data: { deletedAt: null } });
    const restored = await requireAsset(row.id, roomId);
    expect(restored.deletedAt).toBeNull();
  });

  it("favoritar (upsert) é idempotente e desfavoritar (deleteMany) some da lista", async () => {
    const upsert = () =>
      prisma.libraryFavorite.upsert({
        where: { roomId_refKind_refId: { roomId, refKind: "handout", refId: "h1" } },
        create: { roomId, refKind: "handout", refId: "h1" },
        update: {},
      });
    await upsert();
    await upsert();
    expect(await prisma.libraryFavorite.count({ where: { roomId } })).toBe(1);

    await prisma.libraryFavorite.deleteMany({ where: { roomId, refKind: "handout", refId: "h1" } });
    expect(await prisma.libraryFavorite.count({ where: { roomId } })).toBe(0);
  });

  it("favoritos de tipos diferentes coexistem (mesmo refId, refKind diferente)", async () => {
    await prisma.libraryFavorite.create({ data: { roomId, refKind: "asset", refId: "x1" } });
    await prisma.libraryFavorite.create({ data: { roomId, refKind: "macro", refId: "x1" } });
    expect(await prisma.libraryFavorite.count({ where: { roomId } })).toBe(2);
  });
});
