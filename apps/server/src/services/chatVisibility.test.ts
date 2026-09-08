import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@tormenta-vtt/shared";
import { emitChatMessage, messageVisibleTo, redactForAuthor } from "./chatVisibility.js";
import { rooms, type TypedServer } from "../socket/types.js";

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

/** Fake mínimo de TypedServer: só grava em que sala e com que mensagem cada `emit` caiu. */
function fakeIo() {
  const calls: { room: string; msg: ChatMessage }[] = [];
  const io = {
    to: (room: string) => ({
      emit: (_event: "chat:message", msg: ChatMessage) => {
        calls.push({ room, msg });
      },
    }),
  } as unknown as TypedServer;
  return { io, calls };
}

describe("emitChatMessage", () => {
  it("secreta: sala toda recebe na hora, mas com placeholder (sem roll); só a sala do GM recebe o resultado", () => {
    const { io, calls } = fakeIo();
    emitChatMessage(io, "r1", { ...base, visibility: "gm" });

    const toAll = calls.filter((c) => c.room === rooms.all("r1"));
    expect(toAll).toHaveLength(1);
    expect(toAll[0]!.msg.kind).toBe("roll");
    expect(toAll[0]!.msg.roll).toBeUndefined();
    expect(toAll[0]!.msg.id).toBe("m1");

    const toGm = calls.filter((c) => c.room === rooms.gm("r1"));
    expect(toGm).toHaveLength(1);
    expect(toGm[0]!.msg.roll).toBeDefined();
    expect(toGm[0]!.msg.roll!.total).toBe(7);
  });

  it("própria: sala toda recebe placeholder; só a sala do autor recebe o resultado", () => {
    const { io, calls } = fakeIo();
    emitChatMessage(io, "r1", { ...base, visibility: "self" });

    const toAll = calls.filter((c) => c.room === rooms.all("r1"));
    expect(toAll[0]!.msg.roll).toBeUndefined();

    const toAuthor = calls.filter((c) => c.room === rooms.participant("p-author"));
    expect(toAuthor).toHaveLength(1);
    expect(toAuthor[0]!.msg.roll).toBeDefined();
  });

  it("pública (inclusive depois de um /reveal, que muda visibility pra 'all'): um único emit, pra sala toda, com o resultado completo", () => {
    const { io, calls } = fakeIo();
    emitChatMessage(io, "r1", { ...base, visibility: "all" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.room).toBe(rooms.all("r1"));
    expect(calls[0]!.msg.roll).toBeDefined();
    expect(calls[0]!.msg.id).toBe("m1");
  });
});
