import { describe, expect, it } from "vitest";
import type { ChatMessage, FogConfig, RollTarget, Token } from "@tormenta-vtt/shared";
import { emitChatMessage, initiativeBatchForViewer, messageVisibleTo, redactForAuthor, rollTargetsForViewer, tokenGateOk, whisperGateOk } from "./chatVisibility.js";
import type { SceneGeometry } from "./grid.js";
import { rooms, type TypedServer } from "../socket/types.js";

const base: ChatMessage = {
  id: "m1",
  roomId: "r1",
  participantId: "p-author",
  nickname: "Ana",
  kind: "roll",
  visibility: "all",
  tokenId: null,
  whisperTo: null,
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
    natural: null,
    targets: [],
    criticalConfirmed: false,
    createdAt: new Date().toISOString(),
  },
};

const gm = { role: "gm" as const, participantId: "p-gm" };
const author = { role: "player" as const, participantId: "p-author" };
const other = { role: "player" as const, participantId: "p-other" };
/** Terceiro jogador: nem autor, nem alvo do sussurro, nem GM — usado nos testes de whisperGateOk. */
const thirdParty = { role: "player" as const, participantId: "p-third" };

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
const openGeom: SceneGeometry = { fog: openFog, cellSizePx: 70 };
const hiddenGeom: SceneGeometry = { fog: hiddenFog, cellSizePx: 70 };

const tokenFixture: Token = {
  id: "t1",
  sceneId: "s1",
  name: "Goblin",
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
  hasNotes: false,
};

// tokenFixture.sceneId = "s1": maioria dos testes trata "s1" como mapa ATIVO da sala.
describe("tokenGateOk", () => {
  it("sem tokenId: sempre ok (regra normal de visibility)", () => {
    expect(tokenGateOk(null, other, "p-author", undefined, "s1")).toBe(true);
  });

  it("GM sempre recebe, mesmo com o token oculto", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: false }, geom: openGeom };
    expect(tokenGateOk("t1", gm, "p-author", tokenInfo, "s1")).toBe(true);
  });

  it("o autor sempre recebe a própria mensagem, mesmo com o token oculto do GM", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: false }, geom: openGeom };
    expect(tokenGateOk("t1", author, "p-author", tokenInfo, "s1")).toBe(true);
  });

  it("outro jogador que não vê o token (oculto) fica de fora", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: false }, geom: openGeom };
    expect(tokenGateOk("t1", other, "p-author", tokenInfo, "s1")).toBe(false);
  });

  it("outro jogador que não vê o token (sob a névoa, sem ser dono) fica de fora", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: true, ownerId: null }, geom: hiddenGeom };
    expect(tokenGateOk("t1", other, "p-author", tokenInfo, "s1")).toBe(false);
  });

  it("outro jogador que é dono do token vê normalmente", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: true, ownerId: "p-other" }, geom: hiddenGeom };
    expect(tokenGateOk("t1", other, "p-author", tokenInfo, "s1")).toBe(true);
  });

  it("outro jogador vê quando o token está revelado", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: true }, geom: openGeom };
    expect(tokenGateOk("t1", other, "p-author", tokenInfo, "s1")).toBe(true);
  });

  it("outro jogador não recebe: token perfeitamente visível, mas num mapa que não é o ativo", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: true }, geom: openGeom };
    expect(tokenGateOk("t1", other, "p-author", tokenInfo, "outro-mapa")).toBe(false);
  });

  it("GM continua recebendo mesmo com o token num mapa que não é o ativo", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: true }, geom: openGeom };
    expect(tokenGateOk("t1", gm, "p-author", tokenInfo, "outro-mapa")).toBe(true);
  });

  it("o autor continua recebendo a própria mensagem mesmo com o token num mapa que não é o ativo", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: true }, geom: openGeom };
    expect(tokenGateOk("t1", author, "p-author", tokenInfo, "outro-mapa")).toBe(true);
  });

  it("mapa volta a ser o ativo: mensagem represada volta a ser entregue (mesma checagem, activeSceneId novo)", () => {
    const tokenInfo = { token: { ...tokenFixture, visible: true }, geom: openGeom };
    expect(tokenGateOk("t1", other, "p-author", tokenInfo, "s1")).toBe(true);
  });
});

// base.whisperTo é null nos fixtures: maioria dos testes trata "sem sussurro" como o caso normal.
// base.participantId = "p-author" (o autor); whisperTo "p-other" nestes casos = o destinatário.
describe("whisperGateOk (docs/plano-narracao.md — bug corrigido: autor sumia da própria mensagem)", () => {
  it("sem whisperTo: sempre ok (regra normal de visibility)", () => {
    expect(whisperGateOk(base, other)).toBe(true);
  });

  it("o AUTOR sempre recebe a própria mensagem, mesmo sussurrando pra outro alguém", () => {
    expect(whisperGateOk({ ...base, whisperTo: "p-other" }, author)).toBe(true);
  });

  it("o destinatário do sussurro recebe", () => {
    expect(whisperGateOk({ ...base, whisperTo: "p-other" }, other)).toBe(true);
  });

  it("GM sempre recebe, mesmo não sendo autor nem destinatário", () => {
    expect(whisperGateOk({ ...base, whisperTo: "p-other" }, gm)).toBe(true);
  });

  it("um terceiro jogador (nem autor, nem destinatário, nem GM) fica de fora", () => {
    expect(whisperGateOk({ ...base, whisperTo: "p-other" }, thirdParty)).toBe(false);
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

// Sistema de alvos (docs/plano-alvos.md, regra 4): rollTargetsForViewer.
describe("rollTargetsForViewer", () => {
  const targets: RollTarget[] = [
    { tokenId: "t1", name: "Goblin", hit: true, targetValue: 15, reason: "compare" },
    { tokenId: "t2", name: "Orc", hit: false, targetValue: 18, reason: "compare" },
  ];

  it("GM vê todo mundo, com o targetValue", () => {
    const tokenInfoById = new Map([
      ["t1", { token: tokenFixture, geom: openGeom }],
      ["t2", { token: { ...tokenFixture, id: "t2", name: "Orc" }, geom: openGeom }],
    ]);
    expect(rollTargetsForViewer(targets, gm, tokenInfoById, "s1")).toEqual(targets);
  });

  it("dono do token alvo vê o targetValue; outro jogador vê hit sem o número", () => {
    const tokenInfoById = new Map([
      ["t1", { token: { ...tokenFixture, ownerId: "p-other" }, geom: openGeom }],
      ["t2", { token: { ...tokenFixture, id: "t2", name: "Orc" }, geom: openGeom }],
    ]);
    const view = rollTargetsForViewer(targets, other, tokenInfoById, "s1");
    expect(view).toEqual([
      { tokenId: "t1", name: "Goblin", hit: true, targetValue: 15, reason: "compare" },
      { tokenId: "t2", name: "Orc", hit: false, reason: "compare" },
    ]);
  });

  it("linha de token oculto (ou de outro mapa) some da cópia do jogador; GM continua vendo", () => {
    const tokenInfoById = new Map([
      ["t1", { token: { ...tokenFixture, visible: false }, geom: openGeom }],
      ["t2", { token: { ...tokenFixture, id: "t2", name: "Orc" }, geom: openGeom }],
    ]);
    const view = rollTargetsForViewer(targets, other, tokenInfoById, "s1");
    expect(view.map((t) => t.tokenId)).toEqual(["t2"]);
    expect(rollTargetsForViewer(targets, gm, tokenInfoById, "s1")).toHaveLength(2);
  });

  it("hit null (sem regra de acerto, ou alvo sem ficha) passa igual, sem targetValue pra ninguém", () => {
    const noRule: RollTarget[] = [{ tokenId: "t1", name: "Goblin", hit: null, reason: "no-rule" }];
    const tokenInfoById = new Map([["t1", { token: tokenFixture, geom: openGeom }]]);
    expect(rollTargetsForViewer(noRule, other, tokenInfoById, "s1")).toEqual(noRule);
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
      ["t1", { token: tokenFixture, geom: openGeom }],
      ["t2", { token: hiddenOrc, geom: openGeom }],
    ]);
    const view = initiativeBatchForViewer(batchBase, other, tokenInfoById, "s1");
    expect(view?.initiativeBatch?.entries).toEqual([{ combatantId: "c1", tokenId: "t1", name: "Goblin", formula: "1d20+2", result: 15 }]);
  });

  it("GM vê todas as linhas, mesmo com token oculto de jogador", () => {
    const tokenInfoById = new Map([
      ["t1", { token: tokenFixture, geom: openGeom }],
      ["t2", { token: hiddenOrc, geom: openGeom }],
    ]);
    const view = initiativeBatchForViewer(batchBase, gm, tokenInfoById, "s1");
    expect(view?.initiativeBatch?.entries).toHaveLength(2);
  });

  it("nenhuma linha sobra: o jogador não recebe o card", () => {
    const tokenInfoById = new Map([
      ["t1", { token: { ...tokenFixture, visible: false }, geom: openGeom }],
      ["t2", { token: hiddenOrc, geom: openGeom }],
    ]);
    expect(initiativeBatchForViewer(batchBase, other, tokenInfoById, "s1")).toBeUndefined();
  });

  it("rolagem secreta (visibility gm): jogador vê a linha (nome), mas sem fórmula/resultado", () => {
    const secret = { ...batchBase, visibility: "gm" as const };
    const tokenInfoById = new Map([
      ["t1", { token: tokenFixture, geom: openGeom }],
      ["t2", { token: visibleOrc, geom: openGeom }],
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
      ["t1", { token: tokenFixture, geom: openGeom }],
      ["t2", { token: visibleOrc, geom: openGeom }],
    ]);
    const view = initiativeBatchForViewer(secret, gm, tokenInfoById, "s1");
    expect(view?.initiativeBatch?.entries).toEqual(batchBase.initiativeBatch!.entries);
  });

  it("revelar (visibility -> all): jogador passa a ver fórmula/resultado, mas o gate de token oculto continua valendo", () => {
    const revealed = { ...batchBase, visibility: "all" as const };
    const tokenInfoById = new Map([
      ["t1", { token: tokenFixture, geom: openGeom }],
      ["t2", { token: hiddenOrc, geom: openGeom }],
    ]);
    const view = initiativeBatchForViewer(revealed, other, tokenInfoById, "s1");
    // t2 (Orc) continua oculto pro jogador mesmo revelado: o Revelar só muda visibility, não o token.
    expect(view?.initiativeBatch?.entries).toEqual([{ combatantId: "c1", tokenId: "t1", name: "Goblin", formula: "1d20+2", result: 15 }]);
  });

  it("combate rolado num mapa que não é o ativo: nenhuma linha sobra pro jogador, mesmo com os tokens visíveis", () => {
    const tokenInfoById = new Map([
      ["t1", { token: tokenFixture, geom: openGeom }],
      ["t2", { token: visibleOrc, geom: openGeom }],
    ]);
    expect(initiativeBatchForViewer(batchBase, other, tokenInfoById, "outro-mapa")).toBeUndefined();
  });

  it("combate rolado num mapa que não é o ativo: o GM continua vendo todas as linhas", () => {
    const tokenInfoById = new Map([
      ["t1", { token: tokenFixture, geom: openGeom }],
      ["t2", { token: visibleOrc, geom: openGeom }],
    ]);
    const view = initiativeBatchForViewer(batchBase, gm, tokenInfoById, "outro-mapa");
    expect(view?.initiativeBatch?.entries).toHaveLength(2);
  });
});
