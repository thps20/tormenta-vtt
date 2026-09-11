import { describe, expect, it } from "vitest";
import type { GridConfig } from "@tormenta-vtt/shared";
import { cellAt, cellRect, cellToPoint, effectiveCellSize, resnapTokenPosition } from "./grid.js";

const grid: GridConfig = { type: "square", cellSize: 50, offsetX: 10, offsetY: 0, color: "#000", snap: true };

describe("grid (servidor)", () => {
  it("effectiveCellSize: cellSize do grid, ou 70 fixo pra grid none", () => {
    expect(effectiveCellSize(grid)).toBe(50);
    expect(effectiveCellSize({ ...grid, type: "none" })).toBe(70);
  });

  it("cellAt/cellToPoint fazem o caminho de ida e volta", () => {
    expect(cellAt({ x: 65, y: 60 }, grid)).toEqual({ col: 1, row: 1 });
    expect(cellToPoint({ col: 1, row: 1 }, grid)).toEqual({ x: 60, y: 50 });
  });

  it("grid none usa célula virtual de 70px, sem offset", () => {
    expect(cellAt({ x: 72, y: 26 }, { ...grid, type: "none" })).toEqual({ col: 1, row: 0 });
  });

  it("cellRect lê cells direto (fonte da verdade, docs/plano-grid.md)", () => {
    expect(cellRect({ x: 60, y: 50, cells: 2 }, grid)).toEqual({ col: 1, row: 1, cells: 2 });
    expect(cellRect({ x: 10, y: 0, cells: 1 }, grid)).toEqual({ col: 0, row: 0, cells: 1 });
  });
});

describe("resnapTokenPosition (scene:updateGrid reencaixa a posição dos tokens ao trocar cellSize/offset, docs/plano-mapas.md/docs/plano-grid.md)", () => {
  const grid70: GridConfig = { type: "square", cellSize: 70, offsetX: 0, offsetY: 0, color: "#000", snap: true };
  const grid100: GridConfig = { type: "square", cellSize: 100, offsetX: 0, offsetY: 0, color: "#000", snap: true };
  // Mapa folgado: os casos abaixo não são sobre o limite do mapa, então nada deve encostar nele.
  const bigMap = { width: 2000, height: 2000 };

  it("cellSize 70 -> 100: token mantém a célula (posição recalculada, tamanho nunca muda)", () => {
    const token = { x: 70, y: 140, cells: 1 };
    expect(resnapTokenPosition(token, grid70, grid100, bigMap)).toEqual({ x: 100, y: 200, cells: 1 });
  });

  it("cellSize 100 -> 70: token mantém a célula, posição encolhe pro tamanho da célula nova", () => {
    const token = { x: 100, y: 200, cells: 1 };
    expect(resnapTokenPosition(token, grid100, grid70, bigMap)).toEqual({ x: 70, y: 140, cells: 1 });
  });

  it("só offset muda (mesmo cellSize): reencaixa a posição", () => {
    const shifted: GridConfig = { ...grid70, offsetX: 20, offsetY: 20 };
    const token = { x: 70, y: 70, cells: 1 };
    expect(resnapTokenPosition(token, grid70, shifted, bigMap)).toEqual({ x: 90, y: 90, cells: 1 });
  });

  it("grid \"none\" (célula virtual de 70px) <-> grid square: idem sem GridConfig especial", () => {
    const none: GridConfig = { ...grid70, type: "none" };
    const token = { x: 70, y: 70, cells: 1 };
    expect(resnapTokenPosition(token, none, grid100, bigMap)).toEqual({ x: 100, y: 100, cells: 1 });
  });

  it("nada muda (mesmo grid nos dois lados): devolve a MESMA referência, sem objeto novo", () => {
    const token = { x: 70, y: 140, cells: 1 };
    expect(resnapTokenPosition(token, grid70, grid70, bigMap)).toBe(token);
  });

  // docs/revisao-grid.md §2: achado da revisão do plano do grid — token encostado na borda podia
  // sair do mapa depois de reencaixado, porque `resnapTokenPosition` nunca grudava no limite dele.
  describe("gruda dentro do mapa (docs/revisao-grid.md §2)", () => {
    const map = { width: 300, height: 300 };

    it("token 1x1 encostado na borda direita/inferior: cellSize maior empurraria pra fora, mas fica grudado no limite", () => {
      // grid70: última célula inteira é col 3 (x=210..280, mapa vai até 300). No grid100 essa
      // MESMA célula (col 3) cairia em x=300 — exatamente na borda, o token começaria fora dela.
      const token = { x: 210, y: 210, cells: 1 };
      const resnapped = resnapTokenPosition(token, grid70, grid100, map);
      // Sem clamp seria { x: 300, y: 300 } — 100px de token a partir de x=300 sai inteiro do mapa
      // (que vai só até 300). Com clamp, gruda no maior x que ainda cabe: 300 - 100 = 200.
      expect(resnapped).toEqual({ x: 200, y: 200, cells: 1 });
    });

    it("token 2x2 na borda: clamp considera cells × cellSize, não só 1 célula", () => {
      const token = { x: 210, y: 210, cells: 2 };
      const resnapped = resnapTokenPosition(token, grid70, grid100, map);
      // Lado do token no grid novo: 2 × 100 = 200px. Maior x que cabe: 300 - 200 = 100.
      expect(resnapped).toEqual({ x: 100, y: 100, cells: 2 });
    });

    it("token já dentro do mapa depois do reencaixe: clamp não faz nada (mesma referência se a posição não mudou)", () => {
      const token = { x: 0, y: 0, cells: 1 };
      expect(resnapTokenPosition(token, grid70, grid70, map)).toBe(token);
    });
  });
});
