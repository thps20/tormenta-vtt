import { describe, expect, it } from "vitest";
import { resolveGridAppearance, type GridAppearancePrefs } from "./gridAppearance";
import type { GridConfig } from "@tormenta-vtt/shared";

const grid: GridConfig = { type: "square", cellSize: 50, offsetX: 0, offsetY: 0, color: "#00000055", snap: true };

describe("resolveGridAppearance", () => {
  it("sem override: segue o mapa (linhas, cor do Mestre, opacidade cheia, 1px)", () => {
    const prefs: GridAppearancePrefs = { visible: true, override: null };
    expect(resolveGridAppearance(prefs, grid)).toEqual({ visible: true, style: "lines", color: "#00000055", opacity: 1, thickness: 1 });
  });

  it("visible é independente do override (ocultar não muda estilo/cor)", () => {
    const prefs: GridAppearancePrefs = { visible: false, override: null };
    expect(resolveGridAppearance(prefs, grid).visible).toBe(false);
  });

  it("com override: usa exatamente os campos sobrepostos, ignorando o grid do mapa", () => {
    const prefs: GridAppearancePrefs = {
      visible: true,
      override: { style: "crosses", color: "#ff0000", opacity: 0.4, thickness: 3 },
    };
    expect(resolveGridAppearance(prefs, grid)).toEqual({ visible: true, style: "crosses", color: "#ff0000", opacity: 0.4, thickness: 3 });
  });
});
