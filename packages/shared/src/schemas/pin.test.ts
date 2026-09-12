import { describe, expect, it } from "vitest";
import { PinCreateSchema, PinSchema, PinUpdateSchema } from "./pin.js";

describe("PinSchema (docs/plano-narracao.md — unifica pino de handout com pino de nota)", () => {
  it("aceita um pino de handout (kind image)", () => {
    const pin = {
      id: "p1",
      sceneId: "s1",
      kind: "image",
      handoutId: "h1",
      name: "Retrato",
      imageUrl: "/uploads/x.png",
      width: 100,
      height: 100,
      x: 10,
      y: 20,
      visible: true,
    };
    expect(PinSchema.parse(pin)).toMatchObject({ kind: "image", handoutId: "h1" });
  });

  it("aceita um pino de handout (kind text)", () => {
    const pin = { id: "p1", sceneId: "s1", kind: "text", handoutId: "h1", name: "Bilhete", text: "segredo", x: 10, y: 20, visible: true };
    expect(PinSchema.parse(pin)).toMatchObject({ kind: "text", text: "segredo" });
  });

  it("aceita um pino de nota, sem handoutId nenhum", () => {
    const pin = { id: "p1", sceneId: "s1", kind: "note", title: "O barão mente", text: "sobre o irmão", x: 10, y: 20, visible: false };
    const parsed = PinSchema.parse(pin);
    expect(parsed).toMatchObject({ kind: "note", title: "O barão mente" });
    expect("handoutId" in parsed).toBe(false);
  });

  it("rejeita kind desconhecido", () => {
    expect(() => PinSchema.parse({ id: "p1", sceneId: "s1", kind: "outro", x: 0, y: 0, visible: true })).toThrow();
  });
});

describe("PinCreateSchema", () => {
  it("kind handout só pede handoutId (o servidor monta o conteúdo)", () => {
    const parsed = PinCreateSchema.parse({ kind: "handout", sceneId: "s1", x: 0, y: 0, handoutId: "h1" });
    expect(parsed).toMatchObject({ kind: "handout", handoutId: "h1", visible: true }); // default visible=true
  });

  it("kind note pede o conteúdo direto", () => {
    const parsed = PinCreateSchema.parse({ kind: "note", sceneId: "s1", x: 0, y: 0, title: "Pista", text: "..." });
    expect(parsed).toMatchObject({ kind: "note", title: "Pista" });
  });

  it("nota sem título ou texto vazio é rejeitada", () => {
    expect(() => PinCreateSchema.parse({ kind: "note", sceneId: "s1", x: 0, y: 0, title: "", text: "x" })).toThrow();
    expect(() => PinCreateSchema.parse({ kind: "note", sceneId: "s1", x: 0, y: 0, title: "x", text: "" })).toThrow();
  });
});

describe("PinUpdateSchema", () => {
  it("patch parcial, todos os campos opcionais", () => {
    expect(PinUpdateSchema.parse({ sceneId: "s1", pinId: "p1", patch: {} })).toEqual({ sceneId: "s1", pinId: "p1", patch: {} });
    expect(PinUpdateSchema.parse({ sceneId: "s1", pinId: "p1", patch: { visible: false } })).toMatchObject({ patch: { visible: false } });
  });
});
