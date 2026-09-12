/**
 * docs/SPEC.md §9.20: cobre exatamente "execução de macro respeitando permissão do personagem" —
 * como executar uma macro só reemite `character:roll`/`character:use-item` (já protegidos por
 * `canEditCharacter`, apps/server/src/services/characters.ts), a garantia que falta testar aqui é
 * que não é possível CRIAR/EDITAR uma macro `characterAction`/`useItem` apontando pra uma ficha que
 * o autor não controla, e que uma macro continua estritamente pessoal (nem o GM mexe na de outro).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Ctx } from "../socket/ack.js";
import { prisma } from "../db.js";
import { canEditMacro, listMacros, nextMacroOrderFor, requireMacro, toMacro, validateMacroAction } from "./macros.js";

describe("services/macros", () => {
  let roomId: string;
  let gmId: string;
  let playerAId: string;
  let playerBId: string;
  let characterAId: string; // dono: playerA
  let characterBId: string; // dono: playerB

  beforeAll(async () => {
    const room = await prisma.room.create({ data: { name: "Sala de teste (macros)", inviteCode: randomUUID(), gmSecret: randomUUID(), systemId: "tormenta20" } });
    roomId = room.id;
    const gm = await prisma.participant.create({ data: { roomId, nickname: "Mestre", role: "gm" } });
    const playerA = await prisma.participant.create({ data: { roomId, nickname: "Jogador A", role: "player" } });
    const playerB = await prisma.participant.create({ data: { roomId, nickname: "Jogador B", role: "player" } });
    gmId = gm.id;
    playerAId = playerA.id;
    playerBId = playerB.id;
    const characterA = await prisma.character.create({ data: { roomId, ownerId: playerAId, name: "Personagem A", kind: "pc", data: {} } });
    const characterB = await prisma.character.create({ data: { roomId, ownerId: playerBId, name: "Personagem B", kind: "pc", data: {} } });
    characterAId = characterA.id;
    characterBId = characterB.id;
  });

  afterAll(async () => {
    await prisma.room.delete({ where: { id: roomId } });
  });

  beforeEach(async () => {
    await prisma.macro.deleteMany({ where: { roomId } });
  });

  const ctxOf = (participantId: string, role: Ctx["role"]): Ctx => ({ roomId, participantId, role });

  describe("validateMacroAction", () => {
    it("aceita 'roll' e 'chatText' sem checar personagem nenhum", async () => {
      await expect(validateMacroAction(ctxOf(playerAId, "player"), { type: "roll", formula: "2d6+3" })).resolves.toBeUndefined();
      await expect(validateMacroAction(ctxOf(playerAId, "player"), { type: "chatText", text: "Ataque duplo!" })).resolves.toBeUndefined();
    });

    it("jogador aponta pra própria ficha: aceita", async () => {
      await expect(
        validateMacroAction(ctxOf(playerAId, "player"), { type: "characterAction", characterId: characterAId, itemId: randomUUID(), actionId: randomUUID(), enhancements: [] }),
      ).resolves.toBeUndefined();
      await expect(validateMacroAction(ctxOf(playerAId, "player"), { type: "useItem", characterId: characterAId, itemId: randomUUID(), enhancements: [] })).resolves.toBeUndefined();
    });

    it("jogador aponta pra ficha de OUTRO jogador: rejeita", async () => {
      await expect(
        validateMacroAction(ctxOf(playerAId, "player"), { type: "characterAction", characterId: characterBId, itemId: randomUUID(), actionId: randomUUID(), enhancements: [] }),
      ).rejects.toThrow(/não controla/);
    });

    it("GM aponta pra qualquer ficha da sala: aceita", async () => {
      await expect(validateMacroAction(ctxOf(gmId, "gm"), { type: "useItem", characterId: characterBId, itemId: randomUUID(), enhancements: [] })).resolves.toBeUndefined();
    });

    it("ficha inexistente: rejeita", async () => {
      await expect(validateMacroAction(ctxOf(gmId, "gm"), { type: "useItem", characterId: randomUUID(), itemId: randomUUID(), enhancements: [] })).rejects.toThrow(/não encontrada/);
    });
  });

  describe("canEditMacro", () => {
    it("dono edita a própria macro", () => {
      expect(canEditMacro(ctxOf(playerAId, "player"), { participantId: playerAId })).toBe(true);
    });

    it("outro participante NÃO edita, mesmo sendo GM — macro é estritamente pessoal", () => {
      expect(canEditMacro(ctxOf(playerBId, "player"), { participantId: playerAId })).toBe(false);
      expect(canEditMacro(ctxOf(gmId, "gm"), { participantId: playerAId })).toBe(false);
    });
  });

  describe("listMacros / nextMacroOrderFor / requireMacro", () => {
    it("lista só as macros do participante pedido, ordenadas", async () => {
      await prisma.macro.create({ data: { roomId, participantId: playerAId, order: 1, label: "Segunda", icon: "flag", color: "#fff", action: { type: "chatText", text: "b" } } });
      await prisma.macro.create({ data: { roomId, participantId: playerAId, order: 0, label: "Primeira", icon: "flag", color: "#fff", action: { type: "chatText", text: "a" } } });
      await prisma.macro.create({ data: { roomId, participantId: playerBId, order: 0, label: "De outro jogador", icon: "flag", color: "#fff", action: { type: "chatText", text: "c" } } });

      const macros = await listMacros(roomId, playerAId);
      expect(macros.map((m) => m.label)).toEqual(["Primeira", "Segunda"]);
      expect(await nextMacroOrderFor(roomId, playerAId)).toBe(2);
      expect(await nextMacroOrderFor(roomId, playerBId)).toBe(1);
    });

    it("requireMacro rejeita macro de outra sala/inexistente", async () => {
      await expect(requireMacro(randomUUID(), roomId)).rejects.toThrow(/não encontrada/);
    });

    it("toMacro serializa a action de volta no formato validado", async () => {
      const row = await prisma.macro.create({ data: { roomId, participantId: playerAId, order: 0, label: "Cura", icon: "heart", color: "#f00", action: { type: "roll", formula: "1d8+3" } } });
      expect(toMacro(row)).toEqual({ id: row.id, label: "Cura", icon: "heart", color: "#f00", order: 0, action: { type: "roll", formula: "1d8+3" } });
    });
  });
});
