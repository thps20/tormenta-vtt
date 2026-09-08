import { describe, expect, it } from "vitest";
import {
  CONDITION_COUNTER_RADIUS,
  CONDITION_MAX_PX,
  CONDITION_MIN_PX,
  conditionLayout,
  conditionSlotAtPoint,
  isOverflowSlot,
} from "./conditionLayout";

/** Token 1x1 padrão (célula de 70) num zoom em que os ícones aparecem. */
const cell = 70;

describe("conditionLayout", () => {
  it("coluna encostada na borda direita, de cima pra baixo, dentro da bounding box", () => {
    const l = conditionLayout(cell, cell, 1, 3);
    if (l.mode !== "icons") throw new Error("esperava ícones");
    expect(l.slots.length).toBe(3);
    // Todos na mesma coluna, com a borda direita do círculo encostada em x = width.
    for (const s of l.slots) expect(s.x + l.r).toBeCloseTo(cell, 5);
    // De cima pra baixo, começando no topo (topo do 1º círculo encosta em y = 0).
    expect(l.slots[0]!.y - l.r).toBeCloseTo(0, 5);
    expect(l.slots[1]!.y).toBeGreaterThan(l.slots[0]!.y);
    expect(l.slots[2]!.y).toBeGreaterThan(l.slots[1]!.y);
    // Nunca sai da bounding box (é o que impede invadir a célula vizinha).
    for (const s of l.slots) {
      expect(s.x - l.r).toBeGreaterThanOrEqual(0);
      expect(s.x + l.r).toBeLessThanOrEqual(cell + 0.001);
      expect(s.y - l.r).toBeGreaterThanOrEqual(0);
      expect(s.y + l.r).toBeLessThanOrEqual(cell + 0.001);
    }
  });

  it("abre a 2ª coluna à esquerda antes de recorrer ao +N", () => {
    const l = conditionLayout(cell, cell, 1, 6);
    if (l.mode !== "icons") throw new Error("esperava ícones");
    const colunas = new Set(l.slots.map((s) => s.x.toFixed(3)));
    expect(colunas.size).toBe(2);
    const [dir, esq] = [...colunas].map(Number).sort((a, b) => b - a);
    expect(esq!).toBeLessThan(dir!);
    expect(l.hiddenCount).toBe(0);
  });

  it("teto de 6 slots: acima disso o último vira +N com o resto escondido", () => {
    const l = conditionLayout(cell, cell, 1, 38);
    if (l.mode !== "icons") throw new Error("esperava ícones");
    expect(l.visibleCount).toBe(5);
    expect(l.hiddenCount).toBe(33);
    expect(l.slots.length).toBe(6); // 5 ícones + "+33"
    expect(isOverflowSlot(l, 5)).toBe(true);
    expect(isOverflowSlot(l, 4)).toBe(false);
  });

  it("token maior cabe mais linhas por coluna (o ícone trava no máximo em px de tela)", () => {
    const pequeno = conditionLayout(cell, cell, 1, 6);
    const grande = conditionLayout(cell * 3, cell * 3, 1, 6);
    if (pequeno.mode !== "icons" || grande.mode !== "icons") throw new Error("esperava ícones");
    const linhas = (l: typeof pequeno) => new Set(l.slots.map((s) => s.y.toFixed(3))).size;
    expect(grande.r * 1).toBeLessThanOrEqual(CONDITION_MAX_PX / 2 + 0.001);
    expect(linhas(grande)).toBeGreaterThan(linhas(pequeno));
  });

  it("ícone respeita o mínimo e o máximo em px de tela", () => {
    const zoomAlto = conditionLayout(cell * 4, cell * 4, 2, 3); // 22% daria muito mais que o teto
    if (zoomAlto.mode !== "icons") throw new Error("esperava ícones");
    expect(zoomAlto.r * 2 * 2).toBeCloseTo(CONDITION_MAX_PX, 5);
  });

  it("abaixo do mínimo em px de tela vira contador no canto superior direito", () => {
    const l = conditionLayout(cell, cell, 0.2, 8); // 70*0.22*0.2 = 3.1px
    expect(l.mode).toBe("counter");
    if (l.mode !== "counter") return;
    expect(l.screenRadius).toBe(CONDITION_COUNTER_RADIUS);
    // Encostado no canto (borda direita e topo da bounding box).
    const r = CONDITION_COUNTER_RADIUS / 0.2;
    expect(l.cx + r).toBeCloseTo(cell, 5);
    expect(l.cy - r).toBeCloseTo(0, 5);
  });

  it("o limiar do contador é exatamente CONDITION_MIN_PX", () => {
    const escala = CONDITION_MIN_PX / (cell * 0.22);
    expect(conditionLayout(cell, cell, escala * 1.01, 3).mode).toBe("icons");
    expect(conditionLayout(cell, cell, escala * 0.99, 3).mode).toBe("counter");
  });
});

describe("conditionSlotAtPoint (o hit do mouse, que não usa o canvas de hit do Konva)", () => {
  it("acerta o centro de cada badge e erra fora dele", () => {
    const l = conditionLayout(cell, cell, 1, 6);
    if (l.mode !== "icons") throw new Error("esperava ícones");
    l.slots.forEach((s, i) => {
      expect(conditionSlotAtPoint(l, s.x, s.y, 1)).toBe(i);
      // Logo fora da borda do círculo não é mais o badge.
      expect(conditionSlotAtPoint(l, s.x, s.y - l.r * 1.4, 1)).not.toBe(i);
    });
    // Centro do token não tem badge nenhum.
    expect(conditionSlotAtPoint(l, cell / 2, cell / 2, 1)).toBeNull();
  });

  it("pega o badge inteiro, não só o miolo do ícone (borda do fundo circular conta)", () => {
    const l = conditionLayout(cell, cell, 1, 1);
    if (l.mode !== "icons") throw new Error("esperava ícones");
    const s = l.slots[0]!;
    expect(conditionSlotAtPoint(l, s.x + l.r * 0.9, s.y, 1)).toBe(0);
    expect(conditionSlotAtPoint(l, s.x, s.y + l.r * 0.9, 1)).toBe(0);
  });

  it("no modo contador o alvo é o próprio contador, com raio igual ao desenhado na tela", () => {
    const escala = 0.2;
    const l = conditionLayout(cell, cell, escala, 8);
    if (l.mode !== "counter") throw new Error("esperava contador");
    expect(conditionSlotAtPoint(l, l.cx, l.cy, escala)).toBe(0);

    // O contador é desenhado em tamanho de TELA fixo, então o alvo tem que ter o mesmo tamanho em
    // tela — em pixels do mapa isso vira um raio grande no zoom baixo (é o token que ficou pequeno).
    const raioMapa = CONDITION_COUNTER_RADIUS / escala;
    expect(conditionSlotAtPoint(l, l.cx + raioMapa * 0.9, l.cy, escala)).toBe(0);
    expect(conditionSlotAtPoint(l, l.cx + raioMapa * 1.1, l.cy, escala)).toBeNull();
    expect(conditionSlotAtPoint(l, l.cx + cell * 3, l.cy, escala)).toBeNull();
  });

  it("desenho e hit usam a MESMA geometria: todo slot desenhado é alcançável pelo mouse", () => {
    for (const count of [1, 3, 6, 8, 38]) {
      for (const escala of [0.5, 1, 2]) {
        const l = conditionLayout(cell, cell, escala, count);
        if (l.mode !== "icons") continue;
        l.slots.forEach((s, i) => {
          expect(conditionSlotAtPoint(l, s.x, s.y, escala), `count=${count} escala=${escala} slot=${i}`).toBe(i);
        });
      }
    }
  });
});
