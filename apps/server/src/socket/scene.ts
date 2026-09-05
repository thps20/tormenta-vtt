import { SceneActivateSchema, SceneCreateSchema, SceneSetMapSchema, SceneUpdateGridSchema } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { toScene } from "../services/serialize.js";
import { guarded, HandlerError } from "./ack.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

/** Garante que a cena existe e pertence à sala do socket (evita editar cena alheia). */
async function requireScene(sceneId: string, roomId: string) {
  const scene = await prisma.scene.findUnique({ where: { id: sceneId } });
  if (!scene || scene.roomId !== roomId) throw new HandlerError("Cena não encontrada");
  return scene;
}

export function registerSceneHandlers(io: TypedServer, socket: TypedSocket): void {
  const gmOnly = { gmOnly: true };

  socket.on(
    "scene:create",
    guarded(socket, SceneCreateSchema, async ({ name }, ctx) => {
      const scene = toScene(await prisma.scene.create({ data: { roomId: ctx.roomId, name } }));
      io.to(rooms.all(ctx.roomId)).emit("scene:created", scene);
      return scene;
    }, gmOnly),
  );

  socket.on(
    "scene:activate",
    guarded(socket, SceneActivateSchema, async ({ sceneId }, ctx) => {
      await requireScene(sceneId, ctx.roomId);
      await prisma.room.update({ where: { id: ctx.roomId }, data: { activeSceneId: sceneId } });
      // Clientes reagem pedindo um snapshot novo (tokens da cena nova).
      io.to(rooms.all(ctx.roomId)).emit("room:activeSceneChanged", { sceneId });
    }, gmOnly),
  );

  socket.on(
    "scene:setMap",
    guarded(socket, SceneSetMapSchema, async ({ sceneId, mapUrl, mapWidth, mapHeight }, ctx) => {
      await requireScene(sceneId, ctx.roomId);
      const scene = toScene(
        await prisma.scene.update({ where: { id: sceneId }, data: { mapUrl, mapWidth, mapHeight } }),
      );
      io.to(rooms.all(ctx.roomId)).emit("scene:updated", scene);
      return scene;
    }, gmOnly),
  );

  socket.on(
    "scene:updateGrid",
    guarded(socket, SceneUpdateGridSchema, async ({ sceneId, grid }, ctx) => {
      const current = toScene(await requireScene(sceneId, ctx.roomId));
      // Merge parcial: só os campos enviados mudam.
      const merged = { ...current.grid, ...grid };
      const scene = toScene(await prisma.scene.update({ where: { id: sceneId }, data: { grid: merged } }));
      io.to(rooms.all(ctx.roomId)).emit("scene:updated", scene);
      return scene;
    }, gmOnly),
  );
}
