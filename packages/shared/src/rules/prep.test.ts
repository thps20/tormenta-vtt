import { describe, expect, it } from "vitest";
import { insertPrepItemAt, removePrepItemById, reorderPrepSteps, resolvePrepRef, type PrepRefPools } from "./prep.js";
import type { PrepRef, PrepStep } from "../schemas/prep.js";

const pools: PrepRefPools = {
  assetIds: ["a1"],
  handoutIds: ["h1"],
  encounterIds: ["e1"],
  creatureIds: ["goblin"],
  macroIds: ["m1"],
  pinIds: ["p1"],
  npcIds: ["c1"],
};

describe("resolvePrepRef", () => {
  it.each<[PrepRef["kind"], PrepRef]>([
    ["asset", { kind: "asset", assetId: "a1" }],
    ["handout", { kind: "handout", handoutId: "h1" }],
    ["encounter", { kind: "encounter", encounterId: "e1" }],
    ["creature", { kind: "creature", entryId: "goblin" }],
    ["macro", { kind: "macro", macroId: "m1" }],
    ["pin", { kind: "pin", pinId: "p1" }],
    ["npc", { kind: "npc", characterId: "c1" }],
  ])("acha a referência existente de %s", (_kind, ref) => {
    expect(resolvePrepRef(ref, pools)).toBe(true);
  });

  it("não encontra referência apagada do acervo", () => {
    expect(resolvePrepRef({ kind: "asset", assetId: "sumiu" }, pools)).toBe(false);
    expect(resolvePrepRef({ kind: "pin", pinId: "sumiu" }, pools)).toBe(false);
  });

  it("nota solta nunca quebra (não aponta pra nada)", () => {
    expect(resolvePrepRef({ kind: "note", text: "lembrar de algo" }, pools)).toBe(true);
  });
});

describe("reorderPrepSteps", () => {
  const steps: Pick<PrepStep, "id">[] = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];

  it("renumera 0..n-1 na ordem pedida", () => {
    const result = reorderPrepSteps(steps, ["s3", "s1", "s2"]);
    expect(result).toEqual({
      ok: true,
      order: [
        { stepId: "s3", order: 0 },
        { stepId: "s1", order: 1 },
        { stepId: "s2", order: 2 },
      ],
    });
  });

  it("rejeita id repetido", () => {
    expect(reorderPrepSteps(steps, ["s1", "s1", "s2"]).ok).toBe(false);
  });

  it("rejeita id faltando", () => {
    expect(reorderPrepSteps(steps, ["s1", "s2"]).ok).toBe(false);
  });

  it("rejeita id de fora", () => {
    expect(reorderPrepSteps(steps, ["s1", "s2", "s9"]).ok).toBe(false);
  });
});

describe("removePrepItemById / insertPrepItemAt", () => {
  it("remove pelo id, idempotente se não achar", () => {
    const items = [{ id: "i1" }, { id: "i2" }];
    expect(removePrepItemById(items, "i1")).toEqual([{ id: "i2" }]);
    expect(removePrepItemById(items, "sumiu")).toEqual(items);
  });

  it("insere na posição pedida", () => {
    const items = [{ id: "i1" }, { id: "i2" }];
    expect(insertPrepItemAt(items, { id: "novo" }, 1)).toEqual([{ id: "i1" }, { id: "novo" }, { id: "i2" }]);
  });

  it("fixa índice fora do intervalo no início/fim", () => {
    const items = [{ id: "i1" }];
    expect(insertPrepItemAt(items, { id: "a" }, -5)).toEqual([{ id: "a" }, { id: "i1" }]);
    expect(insertPrepItemAt(items, { id: "b" }, 99)).toEqual([{ id: "i1" }, { id: "b" }]);
  });
});
