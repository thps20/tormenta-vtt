import { describe, expect, it } from "vitest";
import { filterTargetTokensByScene } from "./targets.js";

interface Row {
  id: string;
  sceneId: string;
}

const goblin: Row = { id: "t1", sceneId: "s1" };
const orc: Row = { id: "t2", sceneId: "s1" };
// Marcado num mapa antigo, esquecido lá (o GM não tem os alvos limpos ao trocar de mapa) — o
// achado da revisão (docs/revisao-alvos.md §5.2).
const ghostFromOldMap: Row = { id: "t3", sceneId: "s-antigo" };

describe("filterTargetTokensByScene (docs/revisao-alvos.md §5.2)", () => {
  it("mantém só os alvos do mapa que o autor está VENDO agora", () => {
    const rows = [goblin, orc, ghostFromOldMap];
    expect(filterTargetTokensByScene(["t1", "t2", "t3"], rows, "s1")).toEqual([goblin, orc]);
  });

  it("preserva a ordem em que o autor marcou, não a do banco", () => {
    const rows = [orc, goblin];
    expect(filterTargetTokensByScene(["t2", "t1"], rows, "s1")).toEqual([orc, goblin]);
  });

  it("id que não existe mais (token apagado) some em silêncio, sem afetar os outros", () => {
    expect(filterTargetTokensByScene(["t1", "t404", "t2"], [goblin, orc], "s1")).toEqual([goblin, orc]);
  });

  it("sem sceneId pra comparar (autor nunca chamou target:set nesta sala), descarta tudo", () => {
    expect(filterTargetTokensByScene(["t1", "t2"], [goblin, orc], undefined)).toEqual([]);
  });

  it("lista de ids vazia devolve lista vazia", () => {
    expect(filterTargetTokensByScene([], [goblin, orc], "s1")).toEqual([]);
  });
});
