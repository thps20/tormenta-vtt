import { describe, expect, it } from "vitest";
import { autoCamera, boundsOfPoints, followCamera, pxPerCmFromRuler, pxPerCmFromWidth, rotatedViewport, snapCenterToCells, tabletopZoom } from "./tabletop.js";

describe("pxPerCmFromWidth", () => {
  it("tela de 1920px projetando 96cm de largura: 20 px/cm", () => {
    expect(pxPerCmFromWidth(1920, 96)).toBe(20);
  });

  it("entradas não positivas lançam", () => {
    expect(() => pxPerCmFromWidth(0, 96)).toThrow();
    expect(() => pxPerCmFromWidth(1920, -1)).toThrow();
  });
});

describe("pxPerCmFromRuler", () => {
  it("alças na diagonal: usa a distância euclidiana entre elas", () => {
    // 3-4-5: 300px de distância / 15cm = 20 px/cm.
    expect(pxPerCmFromRuler({ x: 0, y: 0 }, { x: 300, y: 400 }, 25)).toBe(20);
  });

  it("cm não positivo lança", () => {
    expect(() => pxPerCmFromRuler({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toThrow();
  });

  it("as duas alças no mesmo ponto lançam (distância zero)", () => {
    expect(() => pxPerCmFromRuler({ x: 5, y: 5 }, { x: 5, y: 5 }, 10)).toThrow();
  });
});

describe("tabletopZoom", () => {
  it("20 px/cm, célula de 2,5cm, mapa com cellSize 100px: zoom 0,5", () => {
    expect(tabletopZoom({ pxPerCm: 20, cellCm: 2.5, cellSizePx: 100 })).toBe(0.5);
  });

  it("mapa sem grid usa o cellSize virtual (70px) do grid 'none': ainda um zoom positivo normal", () => {
    expect(tabletopZoom({ pxPerCm: 20, cellCm: 2.5, cellSizePx: 70 })).toBeCloseTo(0.714, 3);
  });

  it("qualquer parâmetro não positivo lança", () => {
    expect(() => tabletopZoom({ pxPerCm: 0, cellCm: 2.5, cellSizePx: 100 })).toThrow();
    expect(() => tabletopZoom({ pxPerCm: 20, cellCm: 0, cellSizePx: 100 })).toThrow();
    expect(() => tabletopZoom({ pxPerCm: 20, cellCm: 2.5, cellSizePx: 0 })).toThrow();
  });
});

describe("rotatedViewport", () => {
  it("0° e 180°: dimensões inalteradas", () => {
    expect(rotatedViewport({ width: 1920, height: 1080 }, 0)).toEqual({ width: 1920, height: 1080 });
    expect(rotatedViewport({ width: 1920, height: 1080 }, 180)).toEqual({ width: 1920, height: 1080 });
  });

  it("90° e 270°: largura e altura trocam", () => {
    expect(rotatedViewport({ width: 1920, height: 1080 }, 90)).toEqual({ width: 1080, height: 1920 });
    expect(rotatedViewport({ width: 1920, height: 1080 }, 270)).toEqual({ width: 1080, height: 1920 });
  });
});

describe("snapCenterToCells", () => {
  it("arredonda para a célula mais próxima", () => {
    expect(snapCenterToCells({ x: 123, y: 240 }, 100)).toEqual({ x: 100, y: 200 });
    expect(snapCenterToCells({ x: 160, y: 260 }, 100)).toEqual({ x: 200, y: 300 });
  });

  it("cellSizePx inválido: devolve o centro sem mudar", () => {
    expect(snapCenterToCells({ x: 123, y: 240 }, 0)).toEqual({ x: 123, y: 240 });
  });
});

describe("boundsOfPoints", () => {
  it("sem pontos: null", () => {
    expect(boundsOfPoints([])).toBeNull();
  });

  it("um ponto só, com margem: quadrado 2×margem centrado nele", () => {
    expect(boundsOfPoints([{ x: 10, y: 10 }], 5)).toEqual({ x: 5, y: 5, width: 10, height: 10 });
  });

  it("vários pontos: envolve todos", () => {
    expect(boundsOfPoints([{ x: 0, y: 0 }, { x: 100, y: 40 }, { x: 20, y: 200 }])).toEqual({ x: 0, y: 0, width: 100, height: 200 });
  });
});

describe("followCamera", () => {
  it("fora da mesa física: zoom contém a área do Mestre (o menor fator dos dois eixos)", () => {
    const view = { center: { x: 500, y: 500 }, viewWidth: 1000, viewHeight: 500 };
    // 1920/1000 = 1.92; 1080/500 = 2.16 -> usa o menor.
    const cam = followCamera(view, { width: 1920, height: 1080 });
    expect(cam.center).toEqual({ x: 500, y: 500 });
    expect(cam.zoom).toBeCloseTo(1.92, 5);
  });

  it("mesa física: zoom travado ignora a área do Mestre, só o centro acompanha", () => {
    const view = { center: { x: 500, y: 500 }, viewWidth: 1000, viewHeight: 500 };
    const cam = followCamera(view, { width: 1920, height: 1080 }, 0.5);
    expect(cam).toEqual({ center: { x: 500, y: 500 }, zoom: 0.5 });
  });
});

describe("autoCamera", () => {
  const viewport = { width: 1000, height: 1000 };

  it("sem foco nem contexto: null (nada pra enquadrar)", () => {
    expect(autoCamera({ focus: [], viewport, current: { center: { x: 0, y: 0 }, zoom: 1 } })).toBeNull();
  });

  it("foco já dentro da zona morta central (no zoom que já enquadra ele direito): não recalcula (null)", () => {
    // margem padrão (80) em torno de um único ponto: bounds 160×160 -> zoom que o enquadra = 6.25.
    const current = { center: { x: 500, y: 500 }, zoom: 6.25 };
    const result = autoCamera({ focus: [{ x: 520, y: 480 }], viewport, current });
    expect(result).toBeNull();
  });

  it("foco fora da zona morta: recentraliza nele", () => {
    const current = { center: { x: 0, y: 0 }, zoom: 1 };
    const result = autoCamera({ focus: [{ x: 900, y: 900 }], viewport, current });
    expect(result).not.toBeNull();
    expect(result!.center).toEqual({ x: 900, y: 900 });
  });

  it("zoom travado e foco maior que a tela: prioriza o primeiro ponto (combatente da vez)", () => {
    const current = { center: { x: 5000, y: 5000 }, zoom: 0.5 };
    const combatant = { x: 100, y: 100 };
    const template = { x: 3000, y: 3000 }; // gabarito bem longe, não cabe junto na tela travada
    const result = autoCamera({ focus: [combatant, template], viewport, current, lockedZoom: 0.5, margin: 0 });
    expect(result).not.toBeNull();
    expect(result!.center).toEqual(combatant);
    expect(result!.zoom).toBe(0.5);
  });

  it("sem zoom travado: enquadra foco + contexto juntos quando cabem", () => {
    const current = { center: { x: 500, y: 500 }, zoom: 10 };
    const result = autoCamera({
      focus: [{ x: 400, y: 500 }, { x: 600, y: 500 }],
      context: [{ x: 0, y: 500 }, { x: 1000, y: 500 }],
      viewport,
      current,
      margin: 0,
    });
    expect(result).not.toBeNull();
    // bounds combinados: x de 0 a 1000 -> largura 1000 -> zoom 1000/1000 = 1.
    expect(result!.zoom).toBeCloseTo(1, 5);
  });
});
