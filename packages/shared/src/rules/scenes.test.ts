import { describe, expect, it } from "vitest";
import {
  canDeleteScene,
  duplicateScene,
  duplicateSceneName,
  nextSceneOrder,
  orderScenes,
  pickTokensToCarry,
  reorderScenes,
} from "./scenes.js";
import type { Scene } from "../schemas/scene.js";
import type { Token } from "../schemas/token.js";
import type { Character } from "../schemas/character.js";

const scene = (patch: Partial<Scene> = {}): Scene => ({
  id: "s1",
  roomId: "r1",
  name: "Taverna",
  mapUrl: null,
  mapWidth: null,
  mapHeight: null,
  grid: { type: "square", cellSize: 70, offsetX: 0, offsetY: 0, color: "#00000055", snap: true },
  fog: { enabled: false, base: "hidden", shapes: [] },
  order: 0,
  arrival: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...patch,
});

const token = (patch: Partial<Token> = {}): Token => ({
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
  ...patch,
});

describe("orderScenes", () => {
  it("ordena por order crescente", () => {
    const scenes = [scene({ id: "b", order: 2 }), scene({ id: "a", order: 1 })];
    expect(orderScenes(scenes).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("desempata por createdAt quando order é igual (dados legados)", () => {
    const scenes = [
      scene({ id: "later", order: 0, createdAt: "2026-01-02T00:00:00.000Z" }),
      scene({ id: "earlier", order: 0, createdAt: "2026-01-01T00:00:00.000Z" }),
    ];
    expect(orderScenes(scenes).map((s) => s.id)).toEqual(["earlier", "later"]);
  });

  it("é estável (não muda a entrada)", () => {
    const scenes = [scene({ id: "a" }), scene({ id: "b" })];
    orderScenes(scenes);
    expect(scenes.map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("nextSceneOrder", () => {
  it("lista vazia devolve 0", () => {
    expect(nextSceneOrder([])).toBe(0);
  });

  it("sempre maior que todos os existentes", () => {
    expect(nextSceneOrder([{ order: 0 }, { order: 5 }, { order: 2 }])).toBe(6);
  });
});

describe("reorderScenes", () => {
  const current = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("renumera 0..n-1 na ordem recebida", () => {
    const result = reorderScenes(current, ["c", "a", "b"]);
    expect(result).toEqual({ ok: true, order: [{ sceneId: "c", order: 0 }, { sceneId: "a", order: 1 }, { sceneId: "b", order: 2 }] });
  });

  it("rejeita id faltando", () => {
    expect(reorderScenes(current, ["a", "b"])).toMatchObject({ ok: false });
  });

  it("rejeita id repetido", () => {
    expect(reorderScenes(current, ["a", "a", "b"])).toMatchObject({ ok: false });
  });

  it("rejeita id de outra sala (fora do conjunto atual)", () => {
    expect(reorderScenes(current, ["a", "b", "outro"])).toMatchObject({ ok: false });
  });

  it("erro não devolve `order` (nada pra escrever)", () => {
    const result = reorderScenes(current, ["a", "b"]);
    expect(result.ok).toBe(false);
    expect("order" in result).toBe(false);
  });
});

describe("duplicateScene", () => {
  it("copia mapUrl/mapWidth/mapHeight, grid, fog e arrival; troca id/name/order/createdAt", () => {
    const original = scene({
      mapUrl: "/uploads/mapa.png",
      mapWidth: 800,
      mapHeight: 600,
      arrival: { x: 100, y: 200 },
      fog: { enabled: true, base: "hidden", shapes: [{ id: "f1", mode: "reveal", kind: "circle", cx: 1, cy: 1, r: 1 }] },
    });
    const copy = duplicateScene(original, { id: "s2", name: "Cópia de Taverna", order: 1, createdAt: "2026-02-01T00:00:00.000Z" });
    expect(copy).toMatchObject({
      id: "s2",
      name: "Cópia de Taverna",
      order: 1,
      createdAt: "2026-02-01T00:00:00.000Z",
      roomId: original.roomId,
      mapUrl: original.mapUrl,
      mapWidth: original.mapWidth,
      mapHeight: original.mapHeight,
      grid: original.grid,
      fog: original.fog,
      arrival: original.arrival,
    });
  });

  it("a assinatura é só de Scene: não há campo de tokens/combate pra copiar", () => {
    const copy = duplicateScene(scene(), { id: "s2", name: "x", order: 0, createdAt: "2026-01-01T00:00:00.000Z" });
    expect(Object.keys(copy).sort()).toEqual(Object.keys(scene()).sort());
  });
});

describe("duplicateSceneName", () => {
  it("primeira cópia: 'Cópia de X'", () => {
    expect(duplicateSceneName([], "Taverna")).toBe("Cópia de Taverna");
  });

  it("já existe uma cópia: '(2)'", () => {
    expect(duplicateSceneName(["Cópia de Taverna"], "Taverna")).toBe("Cópia de Taverna (2)");
  });

  it("pula números já usados", () => {
    expect(duplicateSceneName(["Cópia de Taverna", "Cópia de Taverna (2)"], "Taverna")).toBe("Cópia de Taverna (3)");
  });

  it("respeita o limite de 80 caracteres do schema", () => {
    const long = "A".repeat(90);
    expect(duplicateSceneName([], long).length).toBeLessThanOrEqual(80);
  });
});

describe("pickTokensToCarry", () => {
  const pc: Pick<Character, "id" | "kind"> = { id: "c1", kind: "pc" };
  const npc: Pick<Character, "id" | "kind"> = { id: "c2", kind: "npc" };

  it("pré-marca token com ownerId", () => {
    const tokens = [token({ id: "t1", ownerId: "p1" })];
    expect(pickTokensToCarry({ tokens, selectedIds: [], characters: [] })).toEqual([{ tokenId: "t1", reason: "player" }]);
  });

  it("pré-marca token de ficha kind pc sem dono no token", () => {
    const tokens = [token({ id: "t1", ownerId: null, characterId: "c1" })];
    expect(pickTokensToCarry({ tokens, selectedIds: [], characters: [pc] })).toEqual([{ tokenId: "t1", reason: "player" }]);
  });

  it("pré-marca token selecionado", () => {
    const tokens = [token({ id: "t1" })];
    expect(pickTokensToCarry({ tokens, selectedIds: ["t1"], characters: [] })).toEqual([{ tokenId: "t1", reason: "selected" }]);
  });

  it("não duplica quando os dois valem (ownerId + selecionado): reason player vence", () => {
    const tokens = [token({ id: "t1", ownerId: "p1" })];
    expect(pickTokensToCarry({ tokens, selectedIds: ["t1"], characters: [] })).toEqual([{ tokenId: "t1", reason: "player" }]);
  });

  it("não marca NPC não selecionado", () => {
    const tokens = [token({ id: "t1", ownerId: null, characterId: "c2" })];
    expect(pickTokensToCarry({ tokens, selectedIds: [], characters: [npc] })).toEqual([]);
  });

  it("token invisível de jogador continua marcado (visible não entra na conta)", () => {
    const tokens = [token({ id: "t1", ownerId: "p1", visible: false })];
    expect(pickTokensToCarry({ tokens, selectedIds: [], characters: [] })).toEqual([{ tokenId: "t1", reason: "player" }]);
  });
});

describe("canDeleteScene", () => {
  const base = {
    sceneId: "s1",
    activeSceneId: "s2",
    sceneCount: 2,
    tokens: [] as Pick<Token, "id" | "ownerId" | "characterId">[],
    characters: [] as Pick<Character, "id" | "kind">[],
  };

  it("mapa ativo bloqueia", () => {
    expect(canDeleteScene({ ...base, activeSceneId: "s1" })).toEqual({ ok: false, blocked: "active" });
  });

  it("último mapa da sala bloqueia (mesmo que também fosse ativo)", () => {
    expect(canDeleteScene({ ...base, sceneCount: 1, activeSceneId: "s1" })).toEqual({ ok: false, blocked: "last" });
  });

  it("com token de jogador pede confirmação", () => {
    const tokens = [token({ id: "t1", ownerId: "p1" }), token({ id: "t2", ownerId: null })];
    expect(canDeleteScene({ ...base, tokens })).toEqual({ ok: false, needsConfirm: true, playerTokenIds: ["t1"] });
  });

  it("caso simples: ok", () => {
    const tokens = [token({ id: "t1", ownerId: null })];
    expect(canDeleteScene({ ...base, tokens })).toEqual({ ok: true });
  });
});
