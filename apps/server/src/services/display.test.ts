import { describe, expect, it } from "vitest";
import type { ChatMessage, Drawing, Pin, Token } from "@tormenta-vtt/shared";
import { drawingVisibleTo } from "@tormenta-vtt/shared";
import { combatantValuesVisibleTo } from "./combat.js";
import { messageVisibleTo } from "./chatVisibility.js";
import { redactTokenForViewer, tokenVisibleTo } from "./visibility.js";
import { pinVisibleTo } from "./pins.js";
import { partyFor } from "./party.js";
import {
  addPreviewDemand,
  displayTokenMatches,
  displayViewer,
  getCameraMode,
  isBlackout,
  isDisplayAllowedEvent,
  removePreviewDemand,
  reportTabletopHint,
  setBlackout,
  setCameraMode,
} from "./display.js";

describe("displayTokenMatches (docs/plano-cast.md §1.2)", () => {
  it("token certo bate", () => {
    expect(displayTokenMatches({ displayToken: "abc123" }, "abc123")).toBe(true);
  });

  it("token errado, ou sala sem Cast ligado (null), não bate", () => {
    expect(displayTokenMatches({ displayToken: "abc123" }, "outro")).toBe(false);
    expect(displayTokenMatches({ displayToken: null }, "abc123")).toBe(false);
  });

  it("tamanhos diferentes não batem (sem lançar)", () => {
    expect(displayTokenMatches({ displayToken: "abc" }, "abcdef")).toBe(false);
  });
});

describe("isDisplayAllowedEvent (docs/plano-cast.md §1.5 — somente leitura)", () => {
  it("permite entrar, mandar miniatura e seguir o mapa ativo", () => {
    expect(isDisplayAllowedEvent("display:join")).toBe(true);
    expect(isDisplayAllowedEvent("display:frame")).toBe(true);
    expect(isDisplayAllowedEvent("scene:enter")).toBe(true);
  });

  it("recusa qualquer coisa que edite estado, inclusive administrar o próprio Cast", () => {
    for (const ev of ["token:update", "chat:send", "fog:update", "display:create-token", "display:view", "display:set-camera-mode"]) {
      expect(isDisplayAllowedEvent(ev)).toBe(false);
    }
  });
});

describe("modo de câmera (docs/plano-cast.md §4.1/§9 decisão 1)", () => {
  it("padrão sem escolha do GM: 'follow' (TV comum, sem dica de mesa física)", () => {
    expect(getCameraMode("room-cam-a")).toBe("follow");
  });

  it("padrão sem escolha do GM, mas com a tela reportando mesa física ligada: 'free'", () => {
    reportTabletopHint("room-cam-b", true);
    expect(getCameraMode("room-cam-b")).toBe("free");
    reportTabletopHint("room-cam-b", false);
    expect(getCameraMode("room-cam-b")).toBe("follow");
  });

  it("escolha explícita do GM fica travada, mesa física não volta a mudar sozinha", () => {
    setCameraMode("room-cam-c", "auto");
    reportTabletopHint("room-cam-c", true);
    expect(getCameraMode("room-cam-c")).toBe("auto");
  });

  it("muda só a sala certa", () => {
    setCameraMode("room-cam-d1", "auto");
    expect(getCameraMode("room-cam-d2")).toBe("follow");
  });
});

describe("blackout (docs/plano-cast.md §9 decisão 4)", () => {
  it("padrão desligado; liga/desliga só a sala certa", () => {
    expect(isBlackout("room-bo-a")).toBe(false);
    setBlackout("room-bo-a", true);
    expect(isBlackout("room-bo-a")).toBe(true);
    expect(isBlackout("room-bo-b")).toBe(false);
  });
});

describe("demanda de miniatura (docs/plano-cast.md §5)", () => {
  it("primeira aba a pedir liga a demanda (true); a segunda não muda nada (false)", () => {
    expect(addPreviewDemand("room-pv-a", "socket1")).toBe(true);
    expect(addPreviewDemand("room-pv-a", "socket2")).toBe(false);
  });

  it("desligar uma aba que ainda tem outra pedindo não avisa (false); a última avisa (true)", () => {
    addPreviewDemand("room-pv-b", "socket1");
    addPreviewDemand("room-pv-b", "socket2");
    expect(removePreviewDemand("room-pv-b", "socket1")).toBe(false);
    expect(removePreviewDemand("room-pv-b", "socket2")).toBe(true);
  });

  it("remover uma aba que não pedia não avisa", () => {
    expect(removePreviewDemand("room-pv-c", "socketX")).toBe(false);
  });
});

describe("displayViewer — a tela enxerga como um jogador sem tokens (docs/plano-cast.md §1.4)", () => {
  const viewer = displayViewer();
  const geomHidden = { fog: { enabled: true, base: "hidden" as const, shapes: [] }, cellSizePx: 70 };
  const geomOpen = { fog: { enabled: false, base: "hidden" as const, shapes: [] }, cellSizePx: 70 };

  const baseToken: Token = {
    id: "t1",
    sceneId: "s1",
    name: "Goblin",
    imageUrl: null,
    x: 100,
    y: 100,
    cells: 1,
    rotation: 0,
    zIndex: 0,
    visible: true,
    ownerId: null,
    color: "#e11d48",
    characterId: null,
    hp: null,
    conditions: [],
    hasNotes: true,
  };

  it("token invisível: não vê", () => {
    expect(tokenVisibleTo({ ...baseToken, visible: false }, viewer, geomOpen)).toBe(false);
  });

  it("token visível sob névoa não revelada: não vê (a tela nunca é dona de token)", () => {
    expect(tokenVisibleTo(baseToken, viewer, geomHidden)).toBe(false);
  });

  it("token visível, mapa sem névoa: vê", () => {
    expect(tokenVisibleTo(baseToken, viewer, geomOpen)).toBe(true);
  });

  it("token com dono real sob névoa: continua sem ver (a tela não é o dono)", () => {
    expect(tokenVisibleTo({ ...baseToken, ownerId: "ana" }, viewer, geomHidden)).toBe(false);
  });

  it("redactTokenForViewer some com hasNotes (a tela nunca vê nota do Mestre)", () => {
    expect(redactTokenForViewer(baseToken, viewer).hasNotes).toBe(false);
  });

  const basePin: Pin = {
    id: "p1",
    sceneId: "s1",
    kind: "note",
    x: 0,
    y: 0,
    visible: true,
    title: "Segredo",
    text: "só o GM sabe disso",
  };

  it("pino 'só GM' (visible:false) some da tela; do mapa ativo e visível aparece", () => {
    expect(pinVisibleTo({ ...basePin, visible: false }, viewer, "s1")).toBe(false);
    expect(pinVisibleTo(basePin, viewer, "s1")).toBe(true);
    expect(pinVisibleTo(basePin, viewer, "outro-mapa")).toBe(false);
  });

  const baseDrawing: Pick<Drawing, "visible" | "sceneId"> = { visible: true, sceneId: "s1" };

  it("traço 'só GM' some da tela", () => {
    expect(drawingVisibleTo({ ...baseDrawing, visible: false }, viewer, "s1")).toBe(false);
    expect(drawingVisibleTo(baseDrawing, viewer, "s1")).toBe(true);
  });

  it("combatente: iniciativa/bônus de rolagem às cegas ficam escondidos, como pra qualquer jogador", () => {
    expect(combatantValuesVisibleTo(viewer, null, "gm")).toEqual({ initiative: false, bonus: false });
    expect(combatantValuesVisibleTo(viewer, null, "all")).toEqual({ initiative: true, bonus: false });
    // Um token de jogador de verdade (dono "ana"): a tela nunca é ele, então nunca vê às cegas.
    expect(combatantValuesVisibleTo(viewer, "ana", "self")).toEqual({ initiative: false, bonus: false });
  });

  const baseMsg = { participantId: "gm1" } as Pick<ChatMessage, "participantId">;

  it("rolagem 'gm' ou 'self' de outro autor: invisível (mesmo sem a tela ter chat)", () => {
    expect(messageVisibleTo({ ...baseMsg, visibility: "gm" } as ChatMessage, viewer)).toBe(false);
    expect(messageVisibleTo({ ...baseMsg, visibility: "self" } as ChatMessage, viewer)).toBe(false);
    expect(messageVisibleTo({ ...baseMsg, visibility: "all" } as ChatMessage, viewer)).toBe(true);
  });

  it("visão de grupo: nenhuma entrada oculta aparece pra tela (mesma regra de qualquer jogador)", () => {
    const party = [
      { characterId: "c1", hidden: false },
      { characterId: "c2", hidden: true },
    ];
    expect(partyFor(party, new Set(["c1", "c2"]), viewer.role)).toEqual([{ characterId: "c1", hidden: false }]);
  });
});
