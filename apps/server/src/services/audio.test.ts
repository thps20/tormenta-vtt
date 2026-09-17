/**
 * docs/plano-preparo.md §3: estado de áudio em memória por sala. `trackPositionMs`/
 * `toPublicAudioState` (puras) já são testadas em packages/shared/src/rules/audio.test.ts — aqui
 * cobre a integração com o Asset (resolução de url, sala/kind/apagado) e as transições de estado.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../db.js";
import { getAudioState, pauseTrack, playTrack, resolveEffectUrl, resumeTrack, seekTrack, stopTrack } from "./audio.js";

describe("services/audio", () => {
  let roomId: string;
  let otherRoomId: string;
  let audioAssetId: string;
  let tokenAssetId: string;

  beforeAll(async () => {
    const room = await prisma.room.create({ data: { name: "Sala de teste (sons)", inviteCode: randomUUID(), gmSecret: randomUUID(), systemId: "tormenta20" } });
    roomId = room.id;
    const otherRoom = await prisma.room.create({ data: { name: "Outra sala (sons)", inviteCode: randomUUID(), gmSecret: randomUUID(), systemId: "tormenta20" } });
    otherRoomId = otherRoom.id;
  });

  afterAll(async () => {
    await prisma.room.deleteMany({ where: { id: { in: [roomId, otherRoomId] } } });
  });

  beforeEach(async () => {
    await prisma.asset.deleteMany({ where: { roomId: { in: [roomId, otherRoomId] } } });
    stopTrack(roomId); // limpa o estado em memória entre testes (Map de módulo, não reseta sozinho)
    const audio = await prisma.asset.create({ data: { roomId, kind: "audio", name: "Taverna", url: "/uploads/taverna.mp3", durationMs: 60_000 } });
    audioAssetId = audio.id;
    const token = await prisma.asset.create({ data: { roomId, kind: "token", name: "Goblin", url: "/uploads/goblin.png", width: 64, height: 64 } });
    tokenAssetId = token.id;
  });

  it("sem trilha nenhuma, o estado é { track: null }", () => {
    expect(getAudioState(roomId)).toEqual({ track: null });
  });

  it("play troca a trilha e começa do zero, tocando", async () => {
    const state = await playTrack(roomId, audioAssetId, true);
    expect(state.track).toMatchObject({ assetId: audioAssetId, url: "/uploads/taverna.mp3", loop: true, playing: true, positionMs: 0 });
    expect(getAudioState(roomId)).toEqual(state);
  });

  it("recusa tocar um asset que não é áudio", async () => {
    await expect(playTrack(roomId, tokenAssetId, false)).rejects.toThrow("não encontrado");
  });

  it("recusa tocar áudio de outra sala", async () => {
    await expect(playTrack(otherRoomId, audioAssetId, false)).rejects.toThrow("não encontrado");
  });

  it("pause grava a posição calculada e para de tocar; resume volta a tocar dali", async () => {
    await playTrack(roomId, audioAssetId, true);
    const paused = pauseTrack(roomId);
    expect(paused.track?.playing).toBe(false);
    expect(paused.track?.positionMs).toBeGreaterThanOrEqual(0);

    const resumed = resumeTrack(roomId);
    expect(resumed.track?.playing).toBe(true);
    expect(resumed.track?.positionMs).toBe(paused.track?.positionMs);
  });

  it("pause/resume/seek sem trilha nenhuma recusam (nada pra pausar/retomar/buscar)", () => {
    expect(() => pauseTrack(roomId)).toThrow("Nenhuma trilha tocando");
    expect(() => resumeTrack(roomId)).toThrow("Nenhuma trilha tocando");
    expect(() => seekTrack(roomId, 1000)).toThrow("Nenhuma trilha tocando");
  });

  it("seek ajusta a posição sem trocar de trilha nem de playing", async () => {
    await playTrack(roomId, audioAssetId, true);
    const sought = seekTrack(roomId, 30_000);
    expect(sought.track).toMatchObject({ assetId: audioAssetId, positionMs: 30_000, playing: true });
  });

  it("stop zera pra track:null e é idempotente", async () => {
    await playTrack(roomId, audioAssetId, true);
    expect(stopTrack(roomId)).toEqual({ track: null });
    expect(stopTrack(roomId)).toEqual({ track: null }); // já parado, sem erro
  });

  it("resolveEffectUrl resolve a url sem tocar no estado (fogo-e-esquece)", async () => {
    await playTrack(roomId, audioAssetId, true);
    const before = getAudioState(roomId);
    const url = await resolveEffectUrl(roomId, audioAssetId);
    expect(url).toBe("/uploads/taverna.mp3");
    expect(getAudioState(roomId)).toEqual(before);
  });

  it("salas diferentes têm estado independente", async () => {
    await playTrack(roomId, audioAssetId, true);
    expect(getAudioState(otherRoomId)).toEqual({ track: null });
  });
});
