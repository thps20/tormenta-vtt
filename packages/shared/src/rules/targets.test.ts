import { describe, expect, it } from "vitest";
import { CharacterDataSchema, type CharacterData } from "../schemas/character.js";
import type { Template } from "../schemas/template.js";
import { getSystemDefinition } from "../systems.js";
import { computeCharacter } from "./compute.js";
import { createDefaultCharacterData } from "./defaults.js";
import {
  evaluateHitRule,
  hitRuleTargetLabel,
  naturalD20,
  parseHitRule,
  pruneTargets,
  resolveTargetPlaceholder,
  targetsFromTemplate,
  toggleTarget,
} from "./targets.js";

const def = getSystemDefinition("tormenta20");

function fixture(patch: Record<string, unknown> = {}): CharacterData {
  const base = createDefaultCharacterData(def);
  return CharacterDataSchema.parse({ ...base, level: 5, attributes: { des: { base: 3 } }, ...patch });
}

describe("parseHitRule", () => {
  it("aceita cada operador de comparação", () => {
    expect(parseHitRule("{a} >= {b}")).toEqual({ left: "{a}", op: ">=", right: "{b}" });
    expect(parseHitRule("{a} <= {b}")).toEqual({ left: "{a}", op: "<=", right: "{b}" });
    expect(parseHitRule("{a} == {b}")).toEqual({ left: "{a}", op: "==", right: "{b}" });
    expect(parseHitRule("{a} > {b}")).toEqual({ left: "{a}", op: ">", right: "{b}" });
    expect(parseHitRule("{a} < {b}")).toEqual({ left: "{a}", op: "<", right: "{b}" });
  });

  it("rejeita zero ou dois operadores", () => {
    expect(() => parseHitRule("{a} + {b}")).toThrow(/operador de comparação/);
    expect(() => parseHitRule("{a} >= {b} >= {c}")).toThrow(/exatamente um operador/);
  });
});

describe("evaluateHitRule", () => {
  it("acerta, erra, e empate com >= acerta", () => {
    expect(evaluateHitRule("{total} >= {target.x}", { total: 18 }, () => 15)).toEqual({ hit: true, targetValue: 15 });
    expect(evaluateHitRule("{total} >= {target.x}", { total: 10 }, () => 15)).toEqual({ hit: false, targetValue: 15 });
    expect(evaluateHitRule("{total} >= {target.x}", { total: 15 }, () => 15)).toEqual({ hit: true, targetValue: 15 });
  });

  it("valor negativo do alvo funciona igual", () => {
    expect(evaluateHitRule("{total} >= {target.x}", { total: -2 }, () => -5)).toEqual({ hit: true, targetValue: -5 });
  });

  it("alvo sem ficha (resolveTarget ausente) ou placeholder sem valor devolve null", () => {
    expect(evaluateHitRule("{total} >= {target.x}", { total: 18 })).toBeNull();
    expect(evaluateHitRule("{total} >= {target.x}", { total: 18 }, () => undefined)).toBeNull();
  });

  it("{natural} sem {target.*} (attackAutoHit/Miss): targetValue ausente", () => {
    expect(evaluateHitRule("{natural} == 20", { natural: 20 })).toEqual({ hit: true, targetValue: undefined });
    expect(evaluateHitRule("{natural} == 20", { natural: 5 })).toEqual({ hit: false, targetValue: undefined });
  });
});

describe("hitRuleTargetLabel", () => {
  it("acha o rótulo do derived/attr/resource referenciado (T20: Defesa)", () => {
    expect(hitRuleTargetLabel(def, "{total} >= {target.derived.defense}")).toBe("Defesa");
  });

  it("devolve 'alvo' sem match ou fórmula inválida", () => {
    expect(hitRuleTargetLabel(def, "{natural} == 20")).toBe("alvo");
    expect(hitRuleTargetLabel(def, "sem operador")).toBe("alvo");
  });
});

describe("resolveTargetPlaceholder", () => {
  it("resolve derived/attr/skill/resource(max) da ficha computada do alvo", () => {
    const computed = computeCharacter(def, fixture());
    expect(resolveTargetPlaceholder(computed, "derived.defense")).toBe(computed.derived.defense);
    expect(resolveTargetPlaceholder(computed, "attr.des")).toBe(computed.attributes.des);
    expect(resolveTargetPlaceholder(computed, "resource.pv")).toBe(computed.resources.pv?.max);
  });

  it("caminho fora do formato kind.key (2 segmentos) devolve undefined", () => {
    const computed = computeCharacter(def, fixture());
    expect(resolveTargetPlaceholder(computed, "derived.defense.extra")).toBeUndefined();
    expect(resolveTargetPlaceholder(computed, "nope")).toBeUndefined();
  });
});

describe("naturalD20", () => {
  it("pega o d20 mantido (kh/kl já descartou o resto)", () => {
    expect(naturalD20([{ count: 1, sides: 20, rolls: [14], dropped: [], subtotal: 14 }])).toBe(14);
    expect(naturalD20([{ count: 2, sides: 20, rolls: [18], dropped: [3], subtotal: 18 }])).toBe(18);
  });

  it("null sem grupo de 20 lados", () => {
    expect(naturalD20([{ count: 1, sides: 8, rolls: [5], dropped: [], subtotal: 5 }])).toBeNull();
  });
});

describe("toggleTarget", () => {
  it("Alt (sem Shift) vira o único alvo", () => {
    expect(toggleTarget([], "a", false)).toEqual(["a"]);
    expect(toggleTarget(["b"], "a", false)).toEqual(["a"]);
  });

  it("Alt no único alvo já marcado limpa", () => {
    expect(toggleTarget(["a"], "a", false)).toEqual([]);
  });

  it("Shift+Alt entra/sai da lista", () => {
    expect(toggleTarget(["a"], "b", true)).toEqual(["a", "b"]);
    expect(toggleTarget(["a", "b"], "a", true)).toEqual(["b"]);
  });
});

describe("pruneTargets", () => {
  it("tira ids que não existem mais", () => {
    expect(pruneTargets(["a", "b", "c"], new Set(["a", "c"]))).toEqual(["a", "c"]);
  });
});

describe("targetsFromTemplate", () => {
  const tok = (id: string, name: string, x: number, y: number, size = 10) => ({ id, name, x, y, width: size, height: size });
  const circle: Template = { id: "t1", ownerId: "p1", label: "", shape: "circle", x: 0, y: 0, rotation: 0, r: 50 };

  it("pega token de dentro, ignora o de fora, ordem estável por nome", () => {
    const inside1 = tok("1", "Zumbi", 10, 0);
    const inside2 = tok("2", "Aranha", -10, 0);
    const outside = tok("3", "Fora", 500, 0);
    expect(targetsFromTemplate([inside1, outside, inside2], circle, 10)).toEqual(["2", "1"]);
  });

  it("token grande conta se qualquer célula dele estiver dentro", () => {
    // Token 4x4 células (40x40px) começando fora do raio, mas a célula mais próxima do centro cai dentro.
    const big = tok("big", "Ogro", 30, 30, 40);
    expect(targetsFromTemplate([big], circle, 10)).toEqual(["big"]);
  });
});
