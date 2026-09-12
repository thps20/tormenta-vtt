/**
 * docs/plano-compendio-sala.md: create/update/delete/import do homebrew da sala. Os handlers de
 * socket (socket/compendium.ts) são só `guarded` + emitir — a lógica que vale testar mora aqui.
 */
import { randomUUID } from "node:crypto";
import { CompendiumCreatureEntrySchema, CompendiumItemEntrySchema, getSystemDefinition, type CompendiumEntry, type RoomCompendiumEntryInput } from "@tormenta-vtt/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../db.js";
import {
  createRoomCompendiumEntry,
  importRoomCompendium,
  nextEntryId,
  requireRoomCompendiumEntry,
  toCompendiumEntry,
  updateRoomCompendiumEntry,
  validateRoomEntry,
} from "./roomCompendium.js";

const def = getSystemDefinition("tormenta20");

/** Entrada de item pronta pra virar `RoomCompendiumEntryInput` (sem id — mesmo corpo de um CompendiumEntry). */
function itemInput(patch: Record<string, unknown> = {}): RoomCompendiumEntryInput {
  return CompendiumItemEntrySchema.omit({ id: true }).parse({
    type: "item",
    name: "Espada da casa",
    kind: "weapon",
    tags: ["homebrew"],
    fields: { proficiency: "marcial", purpose: "melee", wield: "one_hand" },
    ...patch,
  }) as RoomCompendiumEntryInput;
}

function creatureInput(patch: Record<string, unknown> = {}): RoomCompendiumEntryInput {
  return CompendiumCreatureEntrySchema.omit({ id: true }).parse({
    type: "creature",
    name: "Goblin Veterano",
    sheet: { attributes: { for: { base: 2 } }, resources: {}, skills: {}, traits: { tipo: "humanoide" }, size: "pequeno", items: [] },
    ...patch,
  }) as RoomCompendiumEntryInput;
}

describe("services/roomCompendium", () => {
  let roomId: string;

  beforeAll(async () => {
    const room = await prisma.room.create({ data: { name: "Sala de teste (homebrew)", inviteCode: randomUUID(), gmSecret: randomUUID(), systemId: "tormenta20" } });
    roomId = room.id;
  });

  afterAll(async () => {
    await prisma.room.delete({ where: { id: roomId } });
  });

  // Cada teste apaga o que criou antes de terminar a sala inteira, mas alguns testes criam várias
  // linhas com nomes diferentes — mais simples limpar tudo entre um teste e outro.
  beforeEach(async () => {
    await prisma.roomCompendiumEntry.deleteMany({ where: { roomId } });
  });

  describe("validateRoomEntry", () => {
    it("aceita uma entrada coerente com o sistema", () => {
      expect(validateRoomEntry(def, "espada-da-casa", itemInput())).toBeNull();
    });

    it("rejeita o que validateCompendiumEntry já rejeitaria (mesma regra, sem mudar comportamento)", () => {
      expect(validateRoomEntry(def, "espada-da-casa", itemInput({ kind: "nope" }))).toMatch(/tipo de item desconhecido/);
    });
  });

  describe("nextEntryId", () => {
    it("sem colisão: usa o slug puro do nome", async () => {
      expect(await nextEntryId("tormenta20", roomId, "Goblin Veterano")).toBe("goblin-veterano");
    });

    it("colisão com uma entrada viva da sala: ganha sufixo numérico", async () => {
      await createRoomCompendiumEntry(roomId, "goblin-veterano", creatureInput());
      expect(await nextEntryId("tormenta20", roomId, "Goblin Veterano")).toBe("goblin-veterano-2");
    });

    it("colisão com uma entrada APAGADA também ganha sufixo (a chave primária não distingue)", async () => {
      const row = await createRoomCompendiumEntry(roomId, "goblin-veterano", creatureInput());
      await prisma.roomCompendiumEntry.update({ where: { roomId_entryId: { roomId, entryId: row.entryId } }, data: { deletedAt: new Date() } });
      expect(await nextEntryId("tormenta20", roomId, "Goblin Veterano")).toBe("goblin-veterano-2");
    });

    it("colisão com uma entrada do SISTEMA também ganha sufixo (nunca sobrepõe sem querer)", async () => {
      // "espada-longa" já existe no compêndio do sistema (custom.json).
      expect(await nextEntryId("tormenta20", roomId, "Espada Longa")).toBe("espada-longa-2");
    });
  });

  describe("create/update/require", () => {
    it("cria e lê de volta como CompendiumEntry (colunas + data batem)", async () => {
      const row = await createRoomCompendiumEntry(roomId, "espada-da-casa", itemInput());
      const entry = toCompendiumEntry(row);
      expect(entry).toMatchObject({ id: "espada-da-casa", type: "item", name: "Espada da casa", kind: "weapon", tags: ["homebrew"] });
    });

    it("update substitui o corpo inteiro, mas o entryId não muda", async () => {
      await createRoomCompendiumEntry(roomId, "espada-da-casa", itemInput());
      const row = await updateRoomCompendiumEntry(roomId, "espada-da-casa", itemInput({ name: "Espada da casa +1", price: 100 }));
      const entry = toCompendiumEntry(row);
      expect(entry.id).toBe("espada-da-casa");
      expect(entry.name).toBe("Espada da casa +1");
      expect(entry.type === "item" && entry.price).toBe(100);
    });

    it("requireRoomCompendiumEntry rejeita id inexistente e entrada apagada", async () => {
      await expect(requireRoomCompendiumEntry(roomId, "nao-existe")).rejects.toThrow(/não encontrada/);
      const row = await createRoomCompendiumEntry(roomId, "espada-da-casa", itemInput());
      await prisma.roomCompendiumEntry.update({ where: { roomId_entryId: { roomId, entryId: row.entryId } }, data: { deletedAt: new Date() } });
      await expect(requireRoomCompendiumEntry(roomId, "espada-da-casa")).rejects.toThrow(/não encontrada/);
    });
  });

  describe("importRoomCompendium", () => {
    const asFullEntry = (id: string, input: RoomCompendiumEntryInput): CompendiumEntry => ({ ...input, id }) as CompendiumEntry;

    it("id novo: importado", async () => {
      const { outcome, changed } = await importRoomCompendium(def, roomId, [asFullEntry("espada-da-casa", itemInput())], false);
      expect(outcome).toEqual({ imported: 1, overwritten: 0, skipped: [] });
      expect(changed).toEqual([{ kind: "created", entry: expect.objectContaining({ id: "espada-da-casa" }) }]);
    });

    it("id já ativo na sala, sem overwriteConflicts: pulado e reportado (não muda o que já existia)", async () => {
      await createRoomCompendiumEntry(roomId, "espada-da-casa", itemInput({ name: "Original" }));
      const { outcome } = await importRoomCompendium(def, roomId, [asFullEntry("espada-da-casa", itemInput({ name: "Da importação" }))], false);
      expect(outcome.imported).toBe(0);
      expect(outcome.overwritten).toBe(0);
      expect(outcome.skipped).toEqual([{ id: "espada-da-casa", name: "Da importação", reason: "já existe na sala" }]);
      const row = await requireRoomCompendiumEntry(roomId, "espada-da-casa");
      expect(row.name).toBe("Original");
    });

    it("id já ativo na sala, com overwriteConflicts: sobrescrito", async () => {
      await createRoomCompendiumEntry(roomId, "espada-da-casa", itemInput({ name: "Original" }));
      const { outcome } = await importRoomCompendium(def, roomId, [asFullEntry("espada-da-casa", itemInput({ name: "Da importação" }))], true);
      expect(outcome).toEqual({ imported: 0, overwritten: 1, skipped: [] });
      const row = await requireRoomCompendiumEntry(roomId, "espada-da-casa");
      expect(row.name).toBe("Da importação");
    });

    it("id só existe apagado: revivido e contado como importado (não como sobrescrito)", async () => {
      const row = await createRoomCompendiumEntry(roomId, "espada-da-casa", itemInput());
      await prisma.roomCompendiumEntry.update({ where: { roomId_entryId: { roomId, entryId: row.entryId } }, data: { deletedAt: new Date() } });
      const { outcome } = await importRoomCompendium(def, roomId, [asFullEntry("espada-da-casa", itemInput({ name: "De volta" }))], false);
      expect(outcome).toEqual({ imported: 1, overwritten: 0, skipped: [] });
      const revived = await requireRoomCompendiumEntry(roomId, "espada-da-casa");
      expect(revived.name).toBe("De volta");
    });

    it("uma entrada inválida no lote é pulada e reportada; as outras entram normalmente", async () => {
      const good = asFullEntry("espada-da-casa", itemInput());
      const bad = asFullEntry("ruim", itemInput({ name: "Ruim", kind: "nope" }));
      const { outcome } = await importRoomCompendium(def, roomId, [good, bad], false);
      expect(outcome.imported).toBe(1);
      expect(outcome.skipped).toEqual([{ id: "ruim", name: "Ruim", reason: expect.stringMatching(/tipo de item desconhecido/) }]);
      await expect(requireRoomCompendiumEntry(roomId, "espada-da-casa")).resolves.toBeTruthy();
      await expect(requireRoomCompendiumEntry(roomId, "ruim")).rejects.toThrow();
    });
  });
});
