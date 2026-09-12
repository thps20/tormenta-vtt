import { describe, expect, it } from "vitest";
import { parseChatCommand, resolveWhisperTarget } from "./chatCommands.js";

describe("parseChatCommand", () => {
  it("texto comum", () => {
    expect(parseChatCommand("olá")).toEqual({ kind: "text", text: "olá" });
  });

  it("/r usa o modo do autor (visibility indefinida) e aceita rótulo", () => {
    expect(parseChatCommand("/r 2d6+3 # Ataque")).toEqual({ kind: "roll", formula: "2d6+3", label: "Ataque", visibility: undefined });
  });

  it("/gmr e /gr forçam secreta; /pr força pública", () => {
    expect(parseChatCommand("/gmr 1d20")).toMatchObject({ kind: "roll", visibility: "gm" });
    expect(parseChatCommand("/GR 1d20")).toMatchObject({ kind: "roll", visibility: "gm" });
    expect(parseChatCommand("/pr 1d20")).toMatchObject({ kind: "roll", visibility: "all" });
  });

  // docs/plano-narracao.md
  it("/w <nickname> <mensagem> vira um comando de sussurro", () => {
    expect(parseChatCommand("/w Thiago oi, tudo bem?")).toEqual({ kind: "whisper", targetNickname: "Thiago", text: "oi, tudo bem?" });
  });

  it("/w sem mensagem (só nickname) não casa — vira texto normal", () => {
    expect(parseChatCommand("/w Thiago")).toEqual({ kind: "text", text: "/w Thiago" });
  });

  it("/w só pega a PRIMEIRA palavra como nickname — nickname com espaço não é suportado (use o seletor 'para')", () => {
    // "Mestre Sombrio" tem espaço: "Mestre" vira o nickname, "Sombrio fugiu!" vira a mensagem —
    // resolveWhisperTarget abaixo não vai achar ninguém chamado só "Mestre".
    expect(parseChatCommand("/w Mestre Sombrio fugiu!")).toEqual({ kind: "whisper", targetNickname: "Mestre", text: "Sombrio fugiu!" });
  });
});

describe("resolveWhisperTarget (docs/plano-narracao.md)", () => {
  const participants = [
    { id: "p1", nickname: "Thiago" },
    { id: "p2", nickname: "Ana" },
    { id: "p3", nickname: "ana" }, // nickname duplicado (case diferente) de propósito
  ];

  it("acha por nickname exato", () => {
    expect(resolveWhisperTarget("Thiago", participants)).toEqual({ ok: true, participantId: "p1" });
  });

  it("case-insensitive", () => {
    expect(resolveWhisperTarget("thiago", participants)).toEqual({ ok: true, participantId: "p1" });
    expect(resolveWhisperTarget("THIAGO", participants)).toEqual({ ok: true, participantId: "p1" });
  });

  it("nickname inexistente: erro pedindo pra conferir o nome", () => {
    const result = resolveWhisperTarget("Fulano", participants);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Fulano");
  });

  it("nickname duplicado (dois participantes, case diferente): erro pedindo pra usar o seletor", () => {
    const result = resolveWhisperTarget("Ana", participants);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("seletor");
  });
});
