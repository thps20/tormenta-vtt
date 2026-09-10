import { describe, expect, it } from "vitest";
import type { ChatMessage, FogConfig, Token } from "@tormenta-vtt/shared";
import { emitChatMessage, initiativeBatchForViewer, messageVisibleTo, redactForAuthor, tokenGateOk } from "./chatVisibility.js";
import { rooms, type TypedServer } from "../socket/types.js";

const base: ChatMessage = {
  id: "m1",
  roomId: "r1",
  participantId: "p-author",
  nickname: "Ana",
  kind: "roll",
  visibility: "all",
  tokenId: null,
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

const openFog: FogConfig = { enabled: false, base: "revealed", shapes: [] };
const hiddenFog: FogConfig = { enabled: true, base: "hidden", shapes: [] };

const tokenFixture: Token = {
  id: "t1",
  sceneId: "s1",
  name: "Goblin",
  imageUrl: null,
  x: 0,
  y: 0,
  width: 70,
  height: 70,
  rotation: 0,
  zIndex: 0,
  visible: true,
  ownerId: null,
  color: "#e11d48",
  characterId: null,
  hp: null,
  conditions: [],
};

// tokenFixture.sceneId = "s1": maioria dos testes trata "s1" como mapa ATIVO da sala.
describe("tokenGateOk", () => {
  it("sem tokenId: sempre ok (regra normal de visibility)", () => {
    expect(tokenGateOk(null, other, "p-author", undefined, "s1")).toBe(true);
  });

  it("GM sempre recebe, mesmo com o token oculto", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: false }, fog: openFog };
    expect(tokenGateOk("t1", gm, "p-author", tokenInfo, "s1")).toBe(true);
  });

  it("o autor sempre recebe a própria mensagem, mesmo com o token oculto do GM", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: false }, fog: openFog };
    expect(tokenGateOk("t1", author, "p-author", tokenInfo, "s1")).toBe(true);
  });

  it("outro jogador que não vê o token (oculto) fica de fora", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: false }, fog: openFog };
    expect(tokenGateOk("t1", other, "p-author", tokenInfo, "s1")).toBe(false);
  });

  it("outro jogador que não vê o token (sob a névoa, sem ser dono) fica de fora", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: true, ownerId: null }, fog: hiddenFog };
    expect(tokenGateOk("t1", other, "p-author", tokenInfo, "s1")).toBe(false);
  });

  it("outro jogador que é dono do token vê normalmente", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: true, ownerId: "p-other" }, fog: hiddenFog };
    expect(tokenGateOk("t1", other, "p-author", tokenInfo, "s1")).toBe(true);
  });

  it("outro jogador vê quando o token está revelado", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: true }, fog: openFog };
    expect(tokenGateOk("t1", other, "p-author", tokenInfo, "s1")).toBe(true);
  });

  it("outro jogador não recebe: token perfeitamente visível, mas num mapa que não é o ativo", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: true }, fog: openFog };
    expect(tokenGateOk("t1", other, "p-author", tokenInfo, "outro-mapa")).toBe(false);
  });

  it("GM continua recebendo mesmo com o token num mapa que não é o ativo", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: true }, fog: openFog };
    expect(tokenGateOk("t1", gm, "p-author", tokenInfo, "outro-mapa")).toBe(true);
  });

  it("o autor continua recebendo a própria mensagem mesmo com o token num mapa que não é o ativo", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: true }, fog: openFog };
    expect(tokenGateOk("t1", author, "p-author", tokenInfo, "outro-mapa")).toBe(true);
  });

  it("mapa volta a ser o ativo: mensagem represada volta a ser entregue (mesma checagem, activeSceneId novo)", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: true }, fog: openFog };
    expect(tokenGateOk("t1", other, "p-author", tokenInfo, "s1")).toBe(true);
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
  // tokenId é null nos fixtures (base), então o gate de token nem consulta o banco (sem I/O aqui).
  it("secreta: sala toda recebe na hora, mas com placeholder (sem roll); só a sala do GM recebe o resultado", async () => {
    const { io, calls } = fakeIo();
    await emitChatMessage(io, "r1", { ...base, visibility: "gm" });

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

  it("própria: sala toda recebe placeholder; só a sala do autor recebe o resultado", async () => {
    const { io, calls } = fakeIo();
    await emitChatMessage(io, "r1", { ...base, visibility: "self" });

    const toAll = calls.filter((c) => c.room === rooms.all("r1"));
    expect(toAll[0]!.msg.roll).toBeUndefined();

    const toAuthor = calls.filter((c) => c.room === rooms.participant("p-author"));
    expect(toAuthor).toHaveLength(1);
    expect(toAuthor[0]!.msg.roll).toBeDefined();
  });

  it("pública (inclusive depois de um /reveal, que muda visibility pra 'all'): um único emit, pra sala toda, com o resultado completo", async () => {
    const { io, calls } = fakeIo();
    await emitChatMessage(io, "r1", { ...base, visibility: "all" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.room).toBe(rooms.all("r1"));
    expect(calls[0]!.msg.roll).toBeDefined();
    expect(calls[0]!.msg.id).toBe("m1");
  });
});

const batchBase: ChatMessage = {
  ...base,
  id: "b1",
  kind: "initiative-batch",
  roll: undefined,
  initiativeBatch: {
    round: 2,
    entries: [
      { combatantId: "c1", tokenId: "t1", name: "Goblin", formula: "1d20+2", result: 15 },
      { combatantId: "c2", tokenId: "t2", name: "Orc", formula: "1d20+1", result: 9 },
    ],
  },
};

const visibleOrc: Token = { ...tokenFixture, id: "t2", name: "Orc" };
const hiddenOrc: Token = { ...visibleOrc, visible: false };

// tokenFixture/visibleOrc/hiddenOrc.sceneId = "s1": maioria dos testes trata "s1" como o ATIVO.
describe("initiativeBatchForViewer", () => {
  it("token oculto: a linha some da cópia do jogador, as outras ficam", () => {
    const tokenInfoById = new Map([
      ["t1", { token: tokenFixture, fog: openFog }],
      ["t2", { token: hiddenOrc, fog: openFog }],
    ]);
    const view = initiativeBatchForViewer(batchBase, other, tokenInfoById, "s1");
    expect(view?.initiativeBatch?.entries).toEqual([{ combatantId: "c1", tokenId: "t1", name: "Goblin", formula: "1d20+2", result: 15 }]);
  });

  it("GM vê todas as linhas, mesmo com token oculto de jogador", () => {
    const tokenInfoById = new Map([
      ["t1", { token: tokenFixture, fog: openFog }],
      ["t2", { token: hiddenOrc, fog: openFog }],
    ]);
    const view = initiativeBatchForViewer(batchBase, gm, tokenInfoById, "s1");
    expect(view?.initiativeBatch?.entries).toHaveLength(2);
  });

  it("nenhuma linha sobra: o jogador não recebe o card", () => {
    const tokenInfoById = new Map([
      ["t1", { token: { ...tokenFixture, visible: false }, fog: openFog }],
      ["t2", { token: hiddenOrc, fog: openFog }],
    ]);
    expect(initiativeBatchForViewer(batchBase, other, tokenInfoById, "s1")).toBeUndefined();
  });

  it("rolagem secreta (visibility gm): jogador vê a linha (nome), mas sem fórmula/resultado", () => {
    const secret = { ...batchBase, visibility: "gm" as const };
    const tokenInfoById = new Map([
      ["t1", { token: tokenFixture, fog: openFog }],
      ["t2", { token: visibleOrc, fog: openFog }],
    ]);
    const view = initiativeBatchForViewer(secret, other, tokenInfoById, "s1");
    expect(view?.initiativeBatch?.entries).toEqual([
      { combatantId: "c1", tokenId: "t1", name: "Goblin" },
      { combatantId: "c2", tokenId: "t2", name: "Orc" },
    ]);
  });

  it("rolagem secreta: o GM vê fórmula e resultado normalmente", () => {
    const secret = { ...batchBase, visibility: "gm" as const };
    const tokenInfoById = new Map([
      ["t1", { token: tokenFixture, fog: openFog }],
      ["t2", { token: visibleOrc, fog: openFog }],
    ]);
    const view = initiativeBatchForViewer(secret, gm, tokenInfoById, "s1");
    expect(view?.initiativeBatch?.entries).toEqual(batchBase.initiativeBatch!.entries);
  });

  it("revelar (visibility -> all): jogador passa a ver fórmula/resultado, mas o gate de token oculto continua valendo", () => {
    const revealed = { ...batchBase, visibility: "all" as const };
    const tokenInfoById = new Map([
      ["t1", { token: tokenFixture, fog: openFog }],
      ["t2", { token: hiddenOrc, fog: openFog }],
    ]);
    const view = initiativeBatchForViewer(revealed, other, tokenInfoById, "s1");
    // t2 (Orc) continua oculto pro jogador mesmo revelado: o Revelar só muda visibility, não o token.
    expect(view?.initiativeBatch?.entries).toEqual([{ combatantId: "c1", tokenId: "t1", name: "Goblin", formula: "1d20+2", result: 15 }]);
  });

  it("combate rolado num mapa que não é o ativo: nenhuma linha sobra pro jogador, mesmo com os tokens visíveis", () => {
    const tokenInfoById = new Map([
      ["t1", { token: tokenFixture, fog: openFog }],
      ["t2", { token: visibleOrc, fog: openFog }],
    ]);
    expect(initiativeBatchForViewer(batchBase, other, tokenInfoById, "outro-mapa")).toBeUndefined();
  });

  it("combate rolado num mapa que não é o ativo: o GM continua vendo todas as linhas", () => {
    const tokenInfoById = new Map([
      ["t1", { token: tokenFixture, fog: openFog }],
      ["t2", { token: visibleOrc, fog: openFog }],
    ]);
    const view = initiativeBatchForViewer(batchBase, gm, tokenInfoById, "outro-mapa");
    expect(view?.initiativeBatch?.entries).toHaveLength(2);
  });
});
