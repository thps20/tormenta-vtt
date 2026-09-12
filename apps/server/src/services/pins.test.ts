import { describe, expect, it } from "vitest";
import type { Pin as DbPin } from "@prisma/client";
import type { Pin } from "@tormenta-vtt/shared";
import { pinVisibleTo, toPin, toPinSafe } from "./pins.js";

/** Linha de `Pin` do Prisma, com os defaults de uma coluna vazia (mesmo padrão de outros
 *  factories de teste do projeto — `Partial<DbPin>` sobrescreve só o que o caso precisa). */
const dbPinRow = (patch: Partial<DbPin> = {}): DbPin => ({
  id: "pin1",
  sceneId: "s1",
  kind: "image",
  handoutId: null,
  x: 10,
  y: 20,
  visible: true,
  name: null,
  imageUrl: null,
  width: null,
  height: null,
  text: null,
  icon: null,
  color: null,
  deletedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  ...patch,
});

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

describe("toPin (bug real: `name` ia pros dois `kind`, mas o schema chama o campo de `title` na nota)", () => {
  it("pino de handout (kind image), sem `title` nenhum — serializa normalmente", () => {
    const row = dbPinRow({ kind: "image", handoutId: "h1", name: "Retrato do vilão", imageUrl: "/uploads/x.png", width: 800, height: 600 });
    expect(toPin(row)).toMatchObject({ kind: "image", handoutId: "h1", name: "Retrato do vilão", imageUrl: "/uploads/x.png" });
  });

  it("pino de handout (kind text) também serializa (mesmo raciocínio, sem imagem)", () => {
    const row = dbPinRow({ kind: "text", handoutId: "h1", name: "Bilhete rasgado", text: "segredo" });
    expect(toPin(row)).toMatchObject({ kind: "text", name: "Bilhete rasgado", text: "segredo" });
  });

  it("pino de nota (kind note): `row.name` vira `title` no objeto, não `name`", () => {
    const row = dbPinRow({ kind: "note", name: "O barão mente", text: "sobre o irmão" });
    const pin = toPin(row);
    expect(pin).toMatchObject({ kind: "note", title: "O barão mente", text: "sobre o irmão" });
    expect("name" in pin).toBe(false);
  });

  it("pino de nota sem `name` (linha inconsistente) lança — é isto que `toPinSafe` engole", () => {
    const row = dbPinRow({ kind: "note", name: null, text: "sobre o irmão" });
    expect(() => toPin(row)).toThrow();
  });
});

describe("toPinSafe (docs/plano-narracao.md — pino inconsistente nunca derruba o snapshot)", () => {
  it("pino válido: mesmo resultado de toPin", () => {
    const row = dbPinRow({ kind: "note", name: "Pista", text: "..." });
    expect(toPinSafe(row)).toEqual(toPin(row));
  });

  it("pino de nota SEM título (linha inconsistente): devolve null, não lança", () => {
    const row = dbPinRow({ kind: "note", name: null, text: "..." });
    expect(() => toPinSafe(row)).not.toThrow();
    expect(toPinSafe(row)).toBeNull();
  });

  it("`kind` que não bate com nenhuma das três variantes: devolve null, não lança", () => {
    const row = dbPinRow({ kind: "invalido-qualquer" });
    expect(toPinSafe(row)).toBeNull();
  });
});
