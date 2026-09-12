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

  it("/w sem mensagem (só nickname) não casa — vira texto normal, mesmo com participantes conhecidos", () => {
    const participants = [{ id: "p1", nickname: "Thiago" }];
    expect(parseChatCommand("/w Thiago", participants)).toEqual({ kind: "text", text: "/w Thiago" });
  });

  it("sem lista de participantes (parâmetro omitido), /w vira sempre erro de sussurro, nunca texto", () => {
    // Sem saber quem existe na sala, nenhum nickname resolve — mas "/w <algo> <mensagem>" tem cara
    // de sussurro completo, então NUNCA deveria escapar como mensagem normal (ver chat.ts: só
    // chama parseChatCommand com a lista vazia quando o texto nem começa com "/w").
    expect(parseChatCommand("/w Thiago oi")).toMatchObject({ kind: "whisper-error" });
  });
});

// docs/plano-narracao.md (segundo ajuste: nickname de mais de uma palavra, com ou sem aspas).
describe("parseChatCommand — /w <nickname> <mensagem>", () => {
  const participants = [
    { id: "p1", nickname: "Thiago" },
    { id: "p2", nickname: "Ana" },
    { id: "p3", nickname: "Ana Maria" },
    { id: "p4", nickname: "Duplicado" },
    { id: "p5", nickname: "duplicado" }, // mesmo nickname, case diferente — ambíguo de propósito
  ];

  it("nickname simples (uma palavra), sem aspas", () => {
    expect(parseChatCommand("/w Thiago oi, tudo bem?", participants)).toEqual({
      kind: "whisper",
      targetNickname: "Thiago",
      participantId: "p1",
      text: "oi, tudo bem?",
    });
  });

  it("nickname com espaço, sem aspas: casa o MAIOR prefixo que é nickname de alguém (guloso)", () => {
    // "Ana Maria" existe: o prefixo de 2 palavras vence antes de tentar só "Ana".
    expect(parseChatCommand("/w Ana Maria vem aqui", participants)).toEqual({
      kind: "whisper",
      targetNickname: "Ana Maria",
      participantId: "p3",
      text: "vem aqui",
    });
  });

  it("nickname com espaço, mas o texto só bate com o prefixo mais curto — usa esse", () => {
    // "Ana sozinha" não é nickname de ninguém (só "Ana Maria" ou "Ana" existem); o prefixo de 2
    // palavras ("Ana sozinha") não bate com nada, cai pro de 1 palavra ("Ana"), que bate.
    expect(parseChatCommand("/w Ana sozinha aqui", participants)).toEqual({
      kind: "whisper",
      targetNickname: "Ana",
      participantId: "p2",
      text: "sozinha aqui",
    });
  });

  it("nickname entre aspas: funciona mesmo se um prefixo mais curto também existisse", () => {
    expect(parseChatCommand('/w "Ana Maria" oi', participants)).toEqual({
      kind: "whisper",
      targetNickname: "Ana Maria",
      participantId: "p3",
      text: "oi",
    });
  });

  it("nickname entre aspas, simples (uma palavra) — aspas são opcionais, não obrigatórias", () => {
    expect(parseChatCommand('/w "Thiago" oi', participants)).toEqual({
      kind: "whisper",
      targetNickname: "Thiago",
      participantId: "p1",
      text: "oi",
    });
  });

  it("nickname inexistente: erro no ack, texto NÃO é enviado como mensagem normal", () => {
    const result = parseChatCommand("/w Fulano de Tal oi", participants);
    expect(result.kind).toBe("whisper-error");
    if (result.kind === "whisper-error") expect(result.error).toContain("Fulano de Tal");
  });

  it("nickname inexistente entre aspas: mesmo erro", () => {
    const result = parseChatCommand('/w "Fulano" oi', participants);
    expect(result.kind).toBe("whisper-error");
    if (result.kind === "whisper-error") expect(result.error).toContain("Fulano");
  });

  it("nickname ambíguo (dois participantes, case diferente): erro pedindo pra usar o seletor, sem tentar prefixo mais curto", () => {
    const result = parseChatCommand("/w Duplicado oi", participants);
    expect(result.kind).toBe("whisper-error");
    if (result.kind === "whisper-error") expect(result.error).toContain("seletor");
  });

  it("nickname ambíguo entre aspas: mesmo erro", () => {
    const result = parseChatCommand('/w "Duplicado" oi', participants);
    expect(result.kind).toBe("whisper-error");
    if (result.kind === "whisper-error") expect(result.error).toContain("seletor");
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

  it("nickname inexistente: erro pedindo pra conferir o nome, reason 'not-found'", () => {
    const result = resolveWhisperTarget("Fulano", participants);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Fulano");
      expect(result.reason).toBe("not-found");
    }
  });

  it("nickname duplicado (dois participantes, case diferente): erro pedindo pra usar o seletor, reason 'ambiguous'", () => {
    const result = resolveWhisperTarget("Ana", participants);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("seletor");
      expect(result.reason).toBe("ambiguous");
    }
  });
});
