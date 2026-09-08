import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@tormenta-vtt/shared";
import { messageVisibleTo, redactForAuthor } from "./chatVisibility.js";

const base: ChatMessage = {
  id: "m1",
  roomId: "r1",
  participantId: "p-author",
  nickname: "Ana",
  kind: "roll",
  visibility: "all",
  createdAt: new Date().toISOString(),
  roll: {
    id: "d1",
    roomId: "r1",
    participantId: "p-author",
    nickname: "Ana",
    formula: "1d20",
    groups: [{ count: 1, sides: 20, rolls: [7], dropped: [], subtotal: 7 }],
    modifier: 0,
    total: 7,
    applied: [],
    createdAt: new Date().toISOString(),
  },
};

const gm = { role: "gm" as const, participantId: "p-gm" };
const author = { role: "player" as const, participantId: "p-author" };
const other = { role: "player" as const, participantId: "p-other" };

describe("messageVisibleTo", () => {
  it("pública: todos veem", () => {
    const msg = { ...base, visibility: "all" as const };
    expect([gm, author, other].map((v) => messageVisibleTo(msg, v))).toEqual([true, true, true]);
  });

  it("secreta: só o GM vê, nem o autor jogador (às cegas)", () => {
    const msg = { ...base, visibility: "gm" as const };
    expect([gm, author, other].map((v) => messageVisibleTo(msg, v))).toEqual([true, false, false]);
  });

  it("secreta rolada pelo próprio GM: ele vê porque é GM", () => {
    const msg = { ...base, visibility: "gm" as const, participantId: "p-gm" };
    expect(messageVisibleTo(msg, gm)).toBe(true);
  });

  it("própria: só quem rolou vê, nem o GM", () => {
    const msg = { ...base, visibility: "self" as const };
    expect([gm, author, other].map((v) => messageVisibleTo(msg, v))).toEqual([false, true, false]);
  });
});

describe("redactForAuthor", () => {
  it("devolve a mensagem inteira quando o autor pode ver", () => {
    expect(redactForAuthor({ ...base, visibility: "self" }, author)).toEqual({ ...base, visibility: "self" });
  });

  it("tira o resultado quando o autor não pode ver (às cegas)", () => {
    const out = redactForAuthor({ ...base, visibility: "gm" }, author);
    expect(out.roll).toBeUndefined();
    expect(out.id).toBe("m1");
    expect(out.visibility).toBe("gm");
  });
});
