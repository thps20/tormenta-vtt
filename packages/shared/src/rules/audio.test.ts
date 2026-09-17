import { describe, expect, it } from "vitest";
import { trackPositionMs } from "./audio.js";
import type { AudioTrackState } from "../schemas/audio.js";

const track = (patch: Partial<AudioTrackState> = {}): AudioTrackState => ({
  assetId: "a1",
  url: "/uploads/taverna.mp3",
  loop: true,
  playing: true,
  positionMs: 0,
  at: 1000,
  ...patch,
});

describe("trackPositionMs", () => {
  it("pausado devolve a posição gravada, ignorando o relógio", () => {
    expect(trackPositionMs(track({ playing: false, positionMs: 5000 }), { now: 999_999 })).toBe(5000);
  });

  it("tocando soma o tempo decorrido desde `at`", () => {
    expect(trackPositionMs(track({ positionMs: 1000, at: 1000 }), { now: 4000 })).toBe(4000);
  });

  it("em loop, dá a volta na duração quando ultrapassa", () => {
    expect(trackPositionMs(track({ positionMs: 0, at: 0, loop: true }), { now: 12_000, durationMs: 10_000 })).toBe(2000);
  });

  it("sem loop, não faz módulo mesmo passando da duração", () => {
    expect(trackPositionMs(track({ positionMs: 0, at: 0, loop: false }), { now: 12_000, durationMs: 10_000 })).toBe(12_000);
  });

  it("loop sem duração conhecida não faz módulo (só o navegador sabe a duração de verdade)", () => {
    expect(trackPositionMs(track({ positionMs: 0, at: 0, loop: true }), { now: 12_000 })).toBe(12_000);
  });

  it("relógio do servidor retrocedendo (skew) nunca deixa a posição andar pra trás", () => {
    expect(trackPositionMs(track({ positionMs: 5000, at: 10_000 }), { now: 9000 })).toBe(5000);
  });
});
