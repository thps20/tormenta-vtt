import { describe, expect, it } from "vitest";
import type { Pin } from "@tormenta-vtt/shared";
import { pinVisibleTo } from "./pins.js";

describe("pinVisibleTo (docs/plano-narracao.md — unifica handout:pin com pino de nota)", () => {
  const notePin: Pin = { id: "pin1", sceneId: "s1", kind: "note", x: 10, y: 20, visible: true, title: "Segredo", text: "..." };
  const handoutPin: Pin = { id: "pin2", sceneId: "s1", kind: "image", handoutId: "h1", x: 10, y: 20, visible: true, name: "Retrato", imageUrl: "/x.png", width: 10, height: 10 };

  it("GM sempre vê, visible ou não, mapa ativo ou não", () => {
    expect(pinVisibleTo({ ...notePin, visible: false }, { role: "gm" }, null)).toBe(true);
    expect(pinVisibleTo(notePin, { role: "gm" }, "outro-mapa")).toBe(true);
  });

  it("jogador só vê se visible=true E o mapa do pino é o ATIVO da sala", () => {
    expect(pinVisibleTo(notePin, { role: "player" }, "s1")).toBe(true);
    expect(pinVisibleTo(notePin, { role: "player" }, "outro-mapa")).toBe(false);
    expect(pinVisibleTo({ ...notePin, visible: false }, { role: "player" }, "s1")).toBe(false);
  });

  it("mesma regra vale igual pra pino de handout (kind image/text)", () => {
    expect(pinVisibleTo(handoutPin, { role: "player" }, "s1")).toBe(true);
    expect(pinVisibleTo({ ...handoutPin, visible: false }, { role: "player" }, "s1")).toBe(false);
  });
});
