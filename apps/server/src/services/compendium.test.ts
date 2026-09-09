import { describe, expect, it } from "vitest";
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

  it("roomIds vem vazio enquanto o compêndio da sala é um stub", async () => {
    const { roomIds } = await listCompendium("tormenta20", "sala-1", "gm");
    expect(roomIds).toEqual([]);
  });
});
