import Fastify from "fastify";
import cors from "@fastify/cors";
import { Server as SocketServer } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "@tormenta-vtt/shared";
import { env } from "./env.js";
import { prisma } from "./db.js";
import { registerRoomRoutes } from "./http/rooms.js";
import { registerUploadRoutes } from "./http/upload.js";
import { registerSocketHandlers } from "./socket/index.js";
import { scheduleTokenTrashCleanup } from "./services/cleanup.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: env.CORS_ORIGIN });

// --- HTTP ---------------------------------------------------------------

app.get("/health", async () => {
  // Faz um SELECT 1 para confirmar que o banco responde.
  let db: "ok" | "error" = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "error";
  }
  return { status: "ok", db, uptime: process.uptime() };
});

app.get("/", async () => ({ name: "tormenta-vtt server", version: "0.1.0" }));

await registerRoomRoutes(app);
await registerUploadRoutes(app);

// --- Socket.io ----------------------------------------------------------
// O Socket.io é "plugado" no servidor HTTP do Fastify. Os generics garantem
// que só emitimos/ouvimos eventos definidos no contrato de packages/shared.

await app.ready();

const io = new SocketServer<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(
  app.server,
  { cors: { origin: env.CORS_ORIGIN } },
);

registerSocketHandlers(io, app.log);

// Limpeza definitiva de tokens apagados há mais de TOKEN_TRASH_RETENTION_DAYS dias
// (docs/plano-desfazer.md §8): roda uma vez agora e depois a cada 6h.
const cleanupTimer = scheduleTokenTrashCleanup(app.log);

// --- Start --------------------------------------------------------------

try {
  await app.listen({ port: env.SERVER_PORT, host: "0.0.0.0" });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Encerramento limpo (Ctrl+C): fecha sockets, HTTP e Prisma.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    app.log.info(`recebido ${signal}, encerrando...`);
    clearInterval(cleanupTimer);
    io.close();
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}
