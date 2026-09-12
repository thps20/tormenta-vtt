import { describe, expect, it } from "vitest";
import type { Token } from "@tormenta-vtt/shared";
import { canAccessScene, redactTokenForViewer } from "./visibility.js";

describe("canAccessScene (regra de broadcast por mapa, docs/plano-mapas.md §5/§11)", () => {
  it("GM sempre acessa, mapa ativo ou não", () => {
    expect(canAccessScene("gm", true)).toBe(true);
    expect(canAccessScene("gm", false)).toBe(true);
  });

  it("jogador só acessa quando o mapa é o ativo", () => {
    expect(canAccessScene("player", true)).toBe(true);
    expect(canAccessScene("player", false)).toBe(false);
  });
});

describe("redactTokenForViewer (docs/plano-narracao.md — indicador de nota é 'só o GM vê')", () => {
  const token: Token = {
    id: "t1",
    sceneId: "s1",
    name: "Barão",
    imageUrl: null,
    x: 0,
    y: 0,
    cells: 1,
    rotation: 0,
    zIndex: 0,
    visible: true,
    ownerId: null,
    color: "#e11d48",
    characterId: null,
    hp: null,
    conditions: [],
    hasNotes: true,
  };

  it("GM recebe o token como está (hasNotes intacto)", () => {
    expect(redactTokenForViewer(token, { role: "gm", participantId: "gm1" })).toEqual(token);
  });

  it("jogador nunca vê hasNotes, mesmo sendo o dono do token", () => {
    const owned = { ...token, ownerId: "p1" };
    const redacted = redactTokenForViewer(owned, { role: "player", participantId: "p1" });
    expect(redacted.hasNotes).toBe(false);
    expect(redacted).toEqual({ ...owned, hasNotes: false });
  });

  it("token sem nota não muda de referência (hasNotes já é false)", () => {
    const noNote = { ...token, hasNotes: false };
    expect(redactTokenForViewer(noNote, { role: "player", participantId: "p1" })).toBe(noNote);
  });
});
