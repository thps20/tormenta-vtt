/**
 * docs/plano-preparo.md §2: passos do preparo. `resolvePrepRef`/`reorderPrepSteps`/
 * `insertPrepItemAt`/`removePrepItemById` (puras) já são testadas em
 * packages/shared/src/rules/prep.test.ts — aqui cobre a integração com o banco: resolução de
 * `label` contra os serviços reais, concorrência (reler antes de escrever) e cópia entre mapas.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listCompendium } from "./compendium.js";
import type { Ctx } from "../socket/ack.js";
import { prisma } from "../db.js";
import {
  copyAllPrepStepsInTx,
  loadPrepResetSnapshot,
  movePrepItem,
  prepItemsJson,
  requirePrepStep,
  resolveRefLabel,
  restorePrepUsed,
  toPrepStep,
  updatePrepItems,
  zeroPrepUsed,
} from "./prep.js";

describe("services/prep", () => {
  let roomId: string;
  let sceneAId: string;
  let sceneBId: string;
  let gmId: string;
  let playerId: string;

  beforeAll(async () => {
    const room = await prisma.room.create({ data: { name: "Sala de teste (preparo)", inviteCode: randomUUID(), gmSecret: randomUUID(), systemId: "tormenta20" } });
    roomId = room.id;
    const gm = await prisma.participant.create({ data: { roomId, nickname: "Mestre", role: "gm" } });
    gmId = gm.id;
    const player = await prisma.participant.create({ data: { roomId, nickname: "Jogador", role: "player" } });
    playerId = player.id;
    const sceneA = await prisma.scene.create({ data: { roomId, name: "Porto" } });
    sceneAId = sceneA.id;
    const sceneB = await prisma.scene.create({ data: { roomId, name: "Masmorra" } });
    sceneBId = sceneB.id;
  });

  afterAll(async () => {
    await prisma.room.delete({ where: { id: roomId } });
  });

  beforeEach(async () => {
    await prisma.prepStep.deleteMany({ where: { sceneId: { in: [sceneAId, sceneBId] } } });
  });

  const gmCtx = (): Ctx => ({ roomId, participantId: gmId, role: "gm" });

  it("toPrepStep converte a linha (items Json -> PrepItem[] tipado)", async () => {
    const row = await prisma.prepStep.create({ data: { sceneId: sceneAId, title: "Chegada", order: 0 } });
    const step = toPrepStep(row);
    expect(step).toMatchObject({ id: row.id, sceneId: sceneAId, title: "Chegada", order: 0, items: [], used: false });
  });

  it("requirePrepStep recusa passo de outra sala, apagado, ou de mapa apagado", async () => {
    const row = await prisma.prepStep.create({ data: { sceneId: sceneAId, title: "X", order: 0 } });
    await expect(requirePrepStep(row.id, "outra-sala")).rejects.toThrow("não encontrado");

    const deleted = await prisma.prepStep.create({ data: { sceneId: sceneAId, title: "Y", order: 1, deletedAt: new Date() } });
    await expect(requirePrepStep(deleted.id, roomId)).rejects.toThrow("não encontrado");

    const tempScene = await prisma.scene.create({ data: { roomId, name: "Temp", deletedAt: new Date() } });
    const orphan = await prisma.prepStep.create({ data: { sceneId: tempScene.id, title: "Z", order: 0 } });
    await expect(requirePrepStep(orphan.id, roomId)).rejects.toThrow("não encontrado");
  });

  describe("resolveRefLabel", () => {
    it("resolve o nome atual de cada tipo de referência", async () => {
      const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
      const asset = await prisma.asset.create({ data: { roomId, kind: "map", name: "Mapa do Porto", url: "/uploads/porto.png", width: 10, height: 10 } });
      expect(await resolveRefLabel({ kind: "asset", assetId: asset.id }, gmCtx(), room)).toBe("Mapa do Porto");

      const handout = await prisma.handout.create({ data: { roomId, name: "Carta do duque", kind: "text", text: "Prezado..." } });
      expect(await resolveRefLabel({ kind: "handout", handoutId: handout.id }, gmCtx(), room)).toBe("Carta do duque");

      const encounter = await prisma.savedEncounter.create({ data: { roomId, name: "Emboscada", entries: [] } });
      expect(await resolveRefLabel({ kind: "encounter", encounterId: encounter.id }, gmCtx(), room)).toBe("Emboscada");

      const npc = await prisma.character.create({ data: { roomId, ownerId: null, name: "Duque Aldibrando", kind: "npc", data: {} } });
      expect(await resolveRefLabel({ kind: "npc", characterId: npc.id }, gmCtx(), room)).toBe("Duque Aldibrando");

      const pin = await prisma.pin.create({ data: { sceneId: sceneAId, kind: "note", name: "Suspeito", x: 0, y: 0, visible: true } });
      expect(await resolveRefLabel({ kind: "pin", pinId: pin.id }, gmCtx(), room)).toBe("Suspeito");

      expect(await resolveRefLabel({ kind: "note", text: "x".repeat(100) }, gmCtx(), room)).toBe(`${"x".repeat(79)}…`);
    });

    it("creature: resolve contra o compêndio do sistema (não só homebrew da sala)", async () => {
      const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
      const { entries } = await listCompendium(room.systemId, roomId, "gm");
      const creature = entries.find((e) => e.type === "creature");
      expect(creature).toBeDefined();
      expect(await resolveRefLabel({ kind: "creature", entryId: creature!.id }, gmCtx(), room)).toBe(creature!.name);
    });

    it("macro: recusa a de outro participante com a MESMA mensagem de 'não encontrada' (não vaza que existe)", async () => {
      const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
      const macro = await prisma.macro.create({ data: { roomId, participantId: playerId, label: "Ataque", icon: "sword", color: "#fff", order: 0, action: { type: "roll", formula: "1d20" } } });
      await expect(resolveRefLabel({ kind: "macro", macroId: macro.id }, gmCtx(), room)).rejects.toThrow("não encontrada");

      const ownMacro = await prisma.macro.create({ data: { roomId, participantId: gmId, label: "Bola de fogo", icon: "fire", color: "#f00", order: 0, action: { type: "roll", formula: "8d6" } } });
      expect(await resolveRefLabel({ kind: "macro", macroId: ownMacro.id }, gmCtx(), room)).toBe("Bola de fogo");
    });

    it("referência inexistente é recusada (não faz sentido adicionar algo já quebrado)", async () => {
      const room = await prisma.room.findUniqueOrThrow({ where: { id: roomId } });
      await expect(resolveRefLabel({ kind: "asset", assetId: randomUUID() }, gmCtx(), room)).rejects.toThrow("não encontrado");
    });
  });

  it("updatePrepItems relê o banco antes de reescrever (dois GMs não se atropelam)", async () => {
    const row = await prisma.prepStep.create({
      data: { sceneId: sceneAId, title: "Passo", order: 0, items: prepItemsJson([{ id: "i1", ref: { kind: "note", text: "A" }, label: "A", used: false, auto: false, options: {} }]) },
    });
    // "Aba 1" adiciona um item.
    const afterTab1 = await updatePrepItems(row.id, (items) => [...items, { id: "i2", ref: { kind: "note", text: "B" }, label: "B", used: false, auto: false, options: {} }]);
    expect(afterTab1.items.map((i) => i.id)).toEqual(["i1", "i2"]);
    // "Aba 2" marca i1 como usado, partindo do estado ATUAL do banco (não do que tinha quando abriu)
    // — se ela tivesse escrito por cima de uma cópia antiga, o item i2 da aba 1 sumiria.
    const afterTab2 = await updatePrepItems(row.id, (items) => items.map((i) => (i.id === "i1" ? { ...i, used: true } : i)));
    expect(afterTab2.items).toEqual([
      { id: "i1", ref: { kind: "note", text: "A" }, label: "A", used: true, auto: false, options: {} },
      { id: "i2", ref: { kind: "note", text: "B" }, label: "B", used: false, auto: false, options: {} },
    ]);
  });

  it("updatePrepItems propaga erro (ex.: item não encontrado) sem escrever nada", async () => {
    const row = await prisma.prepStep.create({ data: { sceneId: sceneAId, title: "Passo", order: 0 } });
    await expect(
      updatePrepItems(row.id, () => {
        throw new Error("item não encontrado");
      }),
    ).rejects.toThrow("item não encontrado");
  });

  describe("movePrepItem", () => {
    it("reordena dentro do mesmo passo", async () => {
      const row = await prisma.prepStep.create({
        data: {
          sceneId: sceneAId,
          title: "Passo",
          order: 0,
          items: prepItemsJson([
            { id: "i1", ref: { kind: "note", text: "A" }, label: "A", used: false, auto: false, options: {} },
            { id: "i2", ref: { kind: "note", text: "B" }, label: "B", used: false, auto: false, options: {} },
          ]),
        },
      });
      const [step] = await movePrepItem(row.id, "i2", row.id, 0);
      expect(step!.items.map((i) => i.id)).toEqual(["i2", "i1"]);
    });

    it("move pra outro passo do MESMO mapa", async () => {
      const from = await prisma.prepStep.create({
        data: { sceneId: sceneAId, title: "De", order: 0, items: prepItemsJson([{ id: "i1", ref: { kind: "note", text: "A" }, label: "A", used: false, auto: false, options: {} }]) },
      });
      const to = await prisma.prepStep.create({ data: { sceneId: sceneAId, title: "Para", order: 1 } });
      const [updatedFrom, updatedTo] = await movePrepItem(from.id, "i1", to.id, 0);
      expect(updatedFrom!.items).toEqual([]);
      expect(updatedTo!.items.map((i) => i.id)).toEqual(["i1"]);
    });

    it("recusa mover pra um passo de outro mapa", async () => {
      const from = await prisma.prepStep.create({
        data: { sceneId: sceneAId, title: "De", order: 0, items: prepItemsJson([{ id: "i1", ref: { kind: "note", text: "A" }, label: "A", used: false, auto: false, options: {} }]) },
      });
      const to = await prisma.prepStep.create({ data: { sceneId: sceneBId, title: "Outro mapa", order: 0 } });
      await expect(movePrepItem(from.id, "i1", to.id, 0)).rejects.toThrow("mesmo mapa");
    });

    it("recusa item inexistente", async () => {
      const row = await prisma.prepStep.create({ data: { sceneId: sceneAId, title: "Passo", order: 0 } });
      await expect(movePrepItem(row.id, "não-existe", row.id, 0)).rejects.toThrow("não encontrado");
    });
  });

  describe("reset (loadPrepResetSnapshot / zeroPrepUsed / restorePrepUsed)", () => {
    it("zera used de passos e itens, e o desfazer restaura exatamente", async () => {
      const step = await prisma.prepStep.create({
        data: {
          sceneId: sceneAId,
          title: "Passo",
          order: 0,
          used: true,
          items: prepItemsJson([
            { id: "i1", ref: { kind: "note", text: "A" }, label: "A", used: true, auto: false, options: {} },
            { id: "i2", ref: { kind: "note", text: "B" }, label: "B", used: false, auto: false, options: {} },
          ]),
        },
      });

      const snapshot = await loadPrepResetSnapshot(sceneAId);
      const zeroed = await zeroPrepUsed(snapshot);
      expect(zeroed[0]).toMatchObject({ used: false, items: [{ id: "i1", used: false }, { id: "i2", used: false }] });

      const restored = await restorePrepUsed(snapshot);
      expect(restored[0]).toMatchObject({ used: true, items: [{ id: "i1", used: true }, { id: "i2", used: false }] });
      expect(restored[0]!.id).toBe(step.id);
    });

    it("passo apagado entre o snapshot e o restore é pulado, não trava o resto", async () => {
      const step = await prisma.prepStep.create({ data: { sceneId: sceneAId, title: "Passo", order: 0, used: true } });
      const snapshot = await loadPrepResetSnapshot(sceneAId);
      await prisma.prepStep.delete({ where: { id: step.id } });
      await expect(restorePrepUsed(snapshot)).resolves.toEqual([]);
    });
  });

  it("copyAllPrepStepsInTx copia todos os passos não-apagados pendentes, com ids de item novos", async () => {
    await prisma.prepStep.create({
      data: {
        sceneId: sceneAId,
        title: "Chegada",
        order: 0,
        used: true,
        items: prepItemsJson([{ id: "i1", ref: { kind: "note", text: "A" }, label: "A", used: true, auto: false, options: {} }]),
      },
    });
    await prisma.prepStep.create({ data: { sceneId: sceneAId, title: "Apagado", order: 1, deletedAt: new Date() } });

    await prisma.$transaction((tx) => copyAllPrepStepsInTx(tx, sceneAId, sceneBId));

    const copied = await prisma.prepStep.findMany({ where: { sceneId: sceneBId } });
    expect(copied).toHaveLength(1);
    const step = toPrepStep(copied[0]!);
    expect(step.title).toBe("Chegada");
    expect(step.used).toBe(false);
    expect(step.items).toEqual([{ id: expect.any(String), ref: { kind: "note", text: "A" }, label: "A", used: false, auto: false, options: {} }]);
    expect(step.items[0]!.id).not.toBe("i1"); // id novo, nunca reaproveita o do original
  });
});
