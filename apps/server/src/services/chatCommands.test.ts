import { describe, expect, it } from "vitest";
import { parseChatCommand } from "./chatCommands.js";

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
});
