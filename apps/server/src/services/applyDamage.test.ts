import { describe, expect, it } from "vitest";
import { checkApplyDamageTarget } from "./applyDamage.js";

const gm = { role: "gm" as const, participantId: "gm-1" };
const player = { role: "player" as const, participantId: "p-1" };

const linkedToken = { name: "Goblin", ownerId: null, characterId: "char-1", hp: null };
const ownedToken = { name: "Herói", ownerId: "p-1", characterId: null, hp: { current: 10, max: 20 } };
const strangerToken = { name: "PC alheio", ownerId: "p-2", characterId: null, hp: { current: 10, max: 20 } };

describe("checkApplyDamageTarget", () => {
  it("GM pode em qualquer token", () => {
    expect(checkApplyDamageTarget(gm, linkedToken, { tokenBar: "pv" })).toBeNull();
    expect(checkApplyDamageTarget(gm, strangerToken, { tokenBar: "pv" })).toBeNull();
  });

  it("jogador pode no token que possui", () => {
    expect(checkApplyDamageTarget(player, ownedToken, { tokenBar: "pv" })).toBeNull();
  });

  it("jogador não pode em token alheio nem sem dono", () => {
    expect(checkApplyDamageTarget(player, strangerToken, { tokenBar: "pv" })).toMatch(/não controla/);
    expect(checkApplyDamageTarget(player, linkedToken, { tokenBar: "pv" })).toMatch(/não controla/);
  });

  it("token vinculado a ficha exige que o sistema defina tokenBar", () => {
    expect(checkApplyDamageTarget(gm, linkedToken, {})).toMatch(/não define barra de PV/);
  });

  it("token solto sem hp definido não pode ser alvo", () => {
    const noHp = { name: "Sem PV", ownerId: null, characterId: null, hp: null };
    expect(checkApplyDamageTarget(gm, noHp, { tokenBar: "pv" })).toMatch(/não tem PV definido/);
  });

  it("token solto com hp definido pode ser alvo mesmo sem tokenBar no sistema", () => {
    expect(checkApplyDamageTarget(gm, ownedToken, {})).toBeNull();
  });
});
