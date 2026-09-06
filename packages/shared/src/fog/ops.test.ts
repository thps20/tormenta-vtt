import { describe, expect, it } from "vitest";
import { FOG_SHAPES_MAX, type FogConfig, type FogShape } from "../schemas/fog.js";
import { applyFogOp } from "./ops.js";

const shape = (id: string): FogShape => ({ id, mode: "reveal", kind: "circle", cx: 0, cy: 0, r: 10 });
const base: FogConfig = { enabled: true, base: "hidden", shapes: [shape("a"), shape("b")] };
const apply = (fog: FogConfig, op: Parameters<typeof applyFogOp>[1]): FogConfig => {
  const res = applyFogOp(fog, op);
  if (!res.ok) throw new Error(res.error);
  return res.fog;
};

describe("applyFogOp", () => {
  it("add acrescenta no fim; removeLast tira a última", () => {
    const added = apply(base, { type: "add", shape: shape("c") });
    expect(added.shapes.map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(apply(added, { type: "removeLast" }).shapes.map((s) => s.id)).toEqual(["a", "b"]);
    expect(apply({ ...base, shapes: [] }, { type: "removeLast" }).shapes).toEqual([]);
  });

  it("revealAll/hideAll limpam a lista e setam a base; setEnabled não mexe nas shapes", () => {
    expect(apply(base, { type: "revealAll" })).toEqual({ enabled: true, base: "revealed", shapes: [] });
    expect(apply(base, { type: "hideAll" })).toEqual({ enabled: true, base: "hidden", shapes: [] });
    expect(apply(base, { type: "setEnabled", enabled: false })).toEqual({ ...base, enabled: false });
  });

  it("recusa add acima do limite", () => {
    const full = { ...base, shapes: Array.from({ length: FOG_SHAPES_MAX }, (_, i) => shape(String(i))) };
    const res = applyFogOp(full, { type: "add", shape: shape("x") });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Limite/);
  });
});
