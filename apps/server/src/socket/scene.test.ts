import { describe, expect, it } from "vitest";
import { isLiveSceneInRoom, sceneDeleteMoveTarget, type SceneDeleteMove } from "./scene.js";

describe("isLiveSceneInRoom (invariante do mapa ativo, docs/plano-mapas.md §15)", () => {
  const live = { roomId: "room-1", deletedAt: null };

  it("mapa não encontrado (null) não é válido", () => {
    expect(isLiveSceneInRoom(null, "room-1")).toBe(false);
  });

  it("mapa de outra sala não é válido", () => {
    expect(isLiveSceneInRoom(live, "room-2")).toBe(false);
  });

  it("mapa apagado (deletedAt preenchido) não é válido", () => {
    expect(isLiveSceneInRoom({ roomId: "room-1", deletedAt: new Date() }, "room-1")).toBe(false);
  });

  it("mapa vivo desta sala é válido", () => {
    expect(isLiveSceneInRoom(live, "room-1")).toBe(true);
  });
});

describe("sceneDeleteMoveTarget (histórico de apagar mapa, docs/plano-mapas.md §15)", () => {
  const move: SceneDeleteMove = {
    tokenId: "t1",
    before: { sceneId: "origem", x: 10, y: 20, width: 70, height: 70 },
    after: { sceneId: "destino", x: 100, y: 200, width: 100, height: 100 },
  };

  it("revert (undo) devolve o token à posição/mapa de origem", () => {
    expect(sceneDeleteMoveTarget(move, "revert")).toEqual(move.before);
  });

  it("apply (redo) refaz a posição/mapa de destino", () => {
    expect(sceneDeleteMoveTarget(move, "apply")).toEqual(move.after);
  });
});
