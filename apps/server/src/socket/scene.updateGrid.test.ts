import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { AckResult, ClientToServerEvents, GridConfig, Scene } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { toScene } from "../services/serialize.js";
import { registerSceneHandlers } from "./scene.js";
import type { TypedServer, TypedSocket } from "./types.js";

/**
 * Reproduz o bug relatado: "escolher a Escala (unitsPerCell) e salvar não persiste — ao reabrir,
 * volta ao padrão". Chama o handler REAL de `scene:updateGrid` (registerSceneHandlers), não uma
 * reimplementação da lógica de merge — se o bug estiver em qualquer ponto da cadeia (schema do
 * payload, merge, persistência, `toScene`), este teste pega.
 */

/** Socket/io de mentira só o suficiente pro handler rodar: `guarded()` só usa `.data` do socket e
 *  `.on()` pra registrar; `io.to().emit()` é só broadcast, que aqui não importa o destino. */
function fakeSocketAndIo(role: "gm" | "player" = "gm") {
  const handlers = new Map<string, (payload: unknown, ack: (res: AckResult<Scene>) => void) => Promise<void>>();
  const socket = {
    data: { roomId: "", participantId: "p1", role, nickname: "Mestre" },
    on: (event: string, handler: (payload: unknown, ack: (res: AckResult<Scene>) => void) => Promise<void>) => {
      handlers.set(event, handler);
    },
  } as unknown as TypedSocket;
  const io = { to: () => ({ emit: () => undefined }) } as unknown as TypedServer;
  registerSceneHandlers(io, socket);
  return {
    emit: (event: keyof ClientToServerEvents, payload: unknown) =>
      new Promise<AckResult<Scene>>((resolve) => {
        const handler = handlers.get(event);
        if (!handler) throw new Error(`handler não registrado: ${String(event)}`);
        void handler(payload, resolve);
      }),
    socket,
  };
}

describe("scene:updateGrid persiste unitsPerCell/unit (docs/SPEC.md §3.2, escala por mapa)", () => {
  let roomId: string | null = null;

  afterEach(async () => {
    if (roomId) await prisma.room.delete({ where: { id: roomId } });
    roomId = null;
  });

  it("grava unitsPerCell/unit e devolve o valor no ack e no scene:updated", async () => {
    const room = await prisma.room.create({ data: { name: "escala", inviteCode: randomUUID(), gmSecret: randomUUID(), systemId: "tormenta20" } });
    roomId = room.id;
    const sceneRow = await prisma.scene.create({ data: { roomId, name: "mapa" } });

    const { emit, socket } = fakeSocketAndIo("gm");
    socket.data.roomId = roomId;

    // Mesmo payload que o MapConfigModal manda hoje (grid inteiro, não só o campo novo).
    const grid: GridConfig = { type: "square", cellSize: 70, offsetX: 0, offsetY: 0, color: "#00000055", snap: true, unitsPerCell: 15, unit: "m" };
    const ack = await emit("scene:updateGrid", { sceneId: sceneRow.id, grid });

    expect(ack.ok).toBe(true);
    if (!ack.ok) throw new Error(ack.error);
    expect(ack.data.grid.unitsPerCell).toBe(15);
    expect(ack.data.grid.unit).toBe("m");

    // Reler do banco (como um "reabrir o modal" faria, via room:join/scene:enter) confirma que
    // persistiu de verdade, não só o ack otimista.
    const reread = toScene(await prisma.scene.findUniqueOrThrow({ where: { id: sceneRow.id } }));
    expect(reread.grid.unitsPerCell).toBe(15);
    expect(reread.grid.unit).toBe("m");
  });

  it("um 2º patch que só muda a cor não apaga a escala já salva (merge parcial preserva unitsPerCell)", async () => {
    const room = await prisma.room.create({ data: { name: "escala-2", inviteCode: randomUUID(), gmSecret: randomUUID(), systemId: "tormenta20" } });
    roomId = room.id;
    const sceneRow = await prisma.scene.create({ data: { roomId, name: "mapa" } });

    const { emit, socket } = fakeSocketAndIo("gm");
    socket.data.roomId = roomId;

    await emit("scene:updateGrid", { sceneId: sceneRow.id, grid: { unitsPerCell: 100, unit: "m" } });
    // Patch seguinte manda só o que o modal edita (o objeto inteiro de novo, mas simulando também
    // o caso de um evento que manda só um campo — GridConfigSchema.partial() aceita ambos).
    await emit("scene:updateGrid", { sceneId: sceneRow.id, grid: { color: "#ffffffff" } });

    const reread = toScene(await prisma.scene.findUniqueOrThrow({ where: { id: sceneRow.id } }));
    expect(reread.grid.unitsPerCell).toBe(100);
    expect(reread.grid.unit).toBe("m");
    expect(reread.grid.color).toBe("#ffffffff");
  });

  it("sem override no mapa, toScene devolve unitsPerCell/unit undefined (cai no padrão do sistema)", async () => {
    const room = await prisma.room.create({ data: { name: "escala-3", inviteCode: randomUUID(), gmSecret: randomUUID(), systemId: "tormenta20" } });
    roomId = room.id;
    const sceneRow = await prisma.scene.create({ data: { roomId, name: "mapa" } });
    const scene = toScene(sceneRow);
    expect(scene.grid.unitsPerCell).toBeUndefined();
    expect(scene.grid.unit).toBeUndefined();
  });
});
