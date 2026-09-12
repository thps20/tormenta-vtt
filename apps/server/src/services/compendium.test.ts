import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../db.js";
import { listCompendium } from "./compendium.js";

describe("listCompendium", () => {
  it("jogador nunca recebe entradas de criatura (nem nome, nem PV)", async () => {
    const { entries } = await listCompendium("tormenta20", "sala-1", "player");
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => e.type === "creature")).toBe(false);
  });

  it("GM recebe as criaturas do sistema", async () => {
    const { entries } = await listCompendium("tormenta20", "sala-1", "gm");
    const creatures = entries.filter((e) => e.type === "creature");
    expect(creatures.length).toBeGreaterThan(0);
    expect(creatures.some((e) => e.id === "aparicao")).toBe(true);
  });

  it("GM e jogador recebem o mesmo tanto de itens (só criatura muda)", async () => {
    const gm = await listCompendium("tormenta20", "sala-1", "gm");
    const player = await listCompendium("tormenta20", "sala-1", "player");
    const items = (e: { type: string }) => e.type === "item";
    expect(player.entries.filter(items).length).toBe(gm.entries.filter(items).length);
  });

  it("roomIds vem vazio quando a sala não tem homebrew nenhum", async () => {
    const { roomIds } = await listCompendium("tormenta20", "sala-1", "gm");
    expect(roomIds).toEqual([]);
  });
});

describe("listCompendium — homebrew da sala (docs/plano-compendio-sala.md, RoomCompendiumEntry)", () => {
  let roomId: string;

  beforeAll(async () => {
    const room = await prisma.room.create({ data: { name: "Sala de teste (compêndio)", inviteCode: randomUUID(), gmSecret: randomUUID(), systemId: "tormenta20" } });
    roomId = room.id;
    // Mesmo id de uma arma do sistema ("espada-longa", custom.json): testa a prioridade sala > sistema.
    await prisma.roomCompendiumEntry.create({
      data: {
        roomId,
        entryId: "espada-longa",
        type: "item",
        kind: "weapon",
        name: "Espada da casa",
        tags: ["homebrew"],
        description: "",
        page: null,
        data: { fields: { proficiency: "marcial", purpose: "melee", wield: "one_hand" }, actions: [], activation: null, enhancements: [], save: null, statBonuses: {}, slots: 1, price: 15 },
      },
    });
    // Uma segunda entrada, id novo, pra confirmar que soma (não só substitui).
    await prisma.roomCompendiumEntry.create({
      data: {
        roomId,
        entryId: "goblin-veterano",
        type: "creature",
        kind: null,
        name: "Goblin Veterano",
        tags: [],
        description: "",
        page: null,
        data: { sheet: { attributes: { for: { base: 2 } }, resources: {}, skills: {}, traits: { tipo: "humanoide" }, size: "pequeno", items: [] } },
      },
    });
    // Entrada apagada: não deve aparecer em nenhuma lista.
    await prisma.roomCompendiumEntry.create({
      data: { roomId, entryId: "apagada", type: "item", kind: "weapon", name: "Sumida", tags: [], description: "", page: null, data: { fields: {}, actions: [], activation: null, enhancements: [], save: null, statBonuses: {}, slots: 0, price: 0 }, deletedAt: new Date() },
    });
  });

  afterAll(async () => {
    await prisma.room.delete({ where: { id: roomId } });
  });

  it("entrada da sala com o mesmo id de uma do sistema vence, e roomIds lista as ids da sala", async () => {
    const { entries, roomIds } = await listCompendium("tormenta20", roomId, "gm");
    expect(roomIds.sort()).toEqual(["espada-longa", "goblin-veterano"]);
    expect(entries.find((e) => e.id === "espada-longa")?.name).toBe("Espada da casa");
  });

  it("entrada nova da sala (id que o sistema não tem) aparece ao lado das do sistema", async () => {
    const { entries } = await listCompendium("tormenta20", roomId, "gm");
    expect(entries.find((e) => e.id === "goblin-veterano")?.name).toBe("Goblin Veterano");
  });

  it("entrada apagada (soft delete) não aparece", async () => {
    const { entries } = await listCompendium("tormenta20", roomId, "gm");
    expect(entries.some((e) => e.id === "apagada")).toBe(false);
  });

  it("jogador vê o item homebrew da sala, mas não a criatura homebrew", async () => {
    const { entries } = await listCompendium("tormenta20", roomId, "player");
    expect(entries.find((e) => e.id === "espada-longa")?.name).toBe("Espada da casa");
    expect(entries.some((e) => e.id === "goblin-veterano")).toBe(false);
  });
});
