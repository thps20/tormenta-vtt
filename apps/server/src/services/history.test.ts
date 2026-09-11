import { describe, expect, it } from "vitest";
import type { Token } from "@tormenta-vtt/shared";
import {
  describeDelete,
  describeSpawn,
  describeTokenChange,
  moveToRedo,
  moveToUndo,
  peekSummaries,
  pickTrackableTokenPatch,
  popRedo,
  popUndo,
  pushEntry,
  type HistoryEntry,
} from "./history.js";

const token = (patch: Partial<Token> = {}): Token => ({
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
  ...patch,
});

const noop: HistoryEntry = { summary: "noop", apply: async () => undefined, revert: async () => undefined };

describe("pilha de histórico (pushEntry/popUndo/popRedo/move*)", () => {
  it("empilha e desempilha do topo", () => {
    const room = "room-1";
    pushEntry(room, { ...noop, summary: "a" });
    pushEntry(room, { ...noop, summary: "b" });
    expect(popUndo(room)?.summary).toBe("b");
    expect(popUndo(room)?.summary).toBe("a");
    expect(popUndo(room)).toBeUndefined();
  });

  it("pop de pilha vazia devolve undefined, sem lançar", () => {
    expect(popUndo("room-vazia")).toBeUndefined();
    expect(popRedo("room-vazia")).toBeUndefined();
  });

  it("uma ação nova (pushEntry) limpa a pilha de redo", () => {
    const room = "room-2";
    pushEntry(room, { ...noop, summary: "a" });
    const a = popUndo(room)!;
    moveToRedo(room, a); // desfez "a": redo tem "a"
    expect(peekSummaries(room).canRedo).toBe(true);

    pushEntry(room, { ...noop, summary: "c" }); // ação nova
    expect(peekSummaries(room).canRedo).toBe(false);
    expect(popRedo(room)).toBeUndefined();
  });

  it("cap de 50: descarta a mais antiga, mantém as 50 mais recentes", () => {
    const room = "room-cap";
    for (let i = 0; i < 55; i++) pushEntry(room, { ...noop, summary: `e${i}` });
    const popped: string[] = [];
    let e;
    while ((e = popUndo(room))) popped.push(e.summary);
    expect(popped).toHaveLength(50);
    expect(popped[0]).toBe("e54"); // topo = mais recente
    expect(popped[49]).toBe("e5"); // fundo = a 50ª mais recente (e0..e4 foram descartadas)
  });

  it("undo -> redo -> undo faz ida e volta sem perder a entrada", () => {
    const room = "room-3";
    pushEntry(room, { ...noop, summary: "x" });
    const undone = popUndo(room)!;
    moveToRedo(room, undone);
    expect(peekSummaries(room)).toMatchObject({ canUndo: false, canRedo: true, redoSummary: "x" });

    const redone = popRedo(room)!;
    moveToUndo(room, redone);
    expect(peekSummaries(room)).toMatchObject({ canUndo: true, canRedo: false, undoSummary: "x" });
  });

  it("peekSummaries reflete o topo de cada pilha", () => {
    const room = "room-4";
    expect(peekSummaries(room)).toEqual({ canUndo: false, canRedo: false });
    pushEntry(room, { ...noop, summary: "primeira" });
    pushEntry(room, { ...noop, summary: "segunda" });
    expect(peekSummaries(room).undoSummary).toBe("segunda");
  });
});

describe("pickTrackableTokenPatch", () => {
  it("x e y juntos viram um diff só (não dois)", () => {
    const before = token({ x: 0, y: 0 });
    const after = token({ x: 10, y: 20 });
    expect(pickTrackableTokenPatch(before, after)).toEqual({ before: { x: 0, y: 0 }, after: { x: 10, y: 20 } });
  });

  it("cells entra; nome/cor/imagem/dono nunca entram", () => {
    const before = token({ cells: 1, name: "Goblin", color: "#000" });
    const after = token({ cells: 2, name: "Goblin Chefe", color: "#fff", ownerId: "p1" });
    expect(pickTrackableTokenPatch(before, after)).toEqual({ before: { cells: 1 }, after: { cells: 2 } });
  });

  it("patch que só muda campos fora da lista devolve null (nada pra empilhar)", () => {
    const before = token({ name: "Goblin" });
    const after = token({ name: "Goblin Chefe", imageUrl: "x.png", ownerId: "p1" });
    expect(pickTrackableTokenPatch(before, after)).toBeNull();
  });

  it("nenhuma mudança devolve null", () => {
    const t = token();
    expect(pickTrackableTokenPatch(t, t)).toBeNull();
  });

  it("conditions compara por conteúdo (array de objetos), não por referência", () => {
    const before = token({ conditions: [{ key: "atordoado" }] });
    const after = token({ conditions: [{ key: "atordoado" }] }); // conteúdo igual, array novo
    expect(pickTrackableTokenPatch(before, after)).toBeNull();

    const changed = token({ conditions: [{ key: "atordoado" }, { key: "cego" }] });
    const diff = pickTrackableTokenPatch(before, changed)!;
    expect(diff.after.conditions).toEqual([{ key: "atordoado" }, { key: "cego" }]);
  });

  it("visible entra na lista rastreada", () => {
    const before = token({ visible: true });
    const after = token({ visible: false });
    expect(pickTrackableTokenPatch(before, after)).toEqual({ before: { visible: true }, after: { visible: false } });
  });
});

describe("resumos pro toast", () => {
  it("describeTokenChange escolhe pelo campo mais relevante", () => {
    expect(describeTokenChange("Goblin", ["x", "y"])).toBe("mover Goblin");
    expect(describeTokenChange("Goblin", ["cells"])).toBe("redimensionar Goblin");
    expect(describeTokenChange("Goblin", ["conditions"])).toBe("alterar condição de Goblin");
    expect(describeTokenChange("Goblin", ["visible"])).toBe("alterar visibilidade de Goblin");
    expect(describeTokenChange("5 tokens", ["x", "y"])).toBe("mover 5 tokens");
  });

  it("describeDelete: singular com nome, plural com contagem", () => {
    expect(describeDelete(["Goblin"])).toBe("apagar Goblin");
    expect(describeDelete(["Goblin", "Orc", "Kobold"])).toBe("apagar 3 tokens");
  });

  it("describeSpawn: singular com nome, plural com contagem", () => {
    expect(describeSpawn(1, "Goblin")).toBe("soltar Goblin");
    expect(describeSpawn(5, "Goblin")).toBe("soltar 5 cópias de Goblin");
  });
});
