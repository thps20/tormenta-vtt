import type { FastifyBaseLogger } from "fastify";
import { registerRoomHandlers } from "./room.js";
import { registerSceneHandlers } from "./scene.js";
import { registerTokenHandlers } from "./token.js";
import { registerChatHandlers } from "./chat.js";
import { registerCombatHandlers } from "./combat.js";
import { registerCharacterHandlers } from "./character.js";
import { registerRulerHandlers } from "./ruler.js";
import { registerFogHandlers } from "./fog.js";
import { registerTemplateHandlers } from "./templates.js";
import { registerCompendiumHandlers } from "./compendium.js";
import { registerHistoryHandlers } from "./history.js";
import { registerHandoutHandlers } from "./handout.js";
import { registerPinHandlers } from "./pins.js";
import { registerDrawingHandlers } from "./drawings.js";
import { registerNotesHandlers } from "./notes.js";
import { registerTargetHandlers } from "./targets.js";
import { registerEncounterHandlers } from "./encounter.js";
import { registerPartyHandlers } from "./party.js";
import type { TypedServer } from "./types.js";

/** Ponto único que liga todos os handlers de socket. */
export function registerSocketHandlers(io: TypedServer, log: FastifyBaseLogger): void {
  io.on("connection", (socket) => {
    log.info({ socketId: socket.id }, "socket conectado");
    // socket.data começa vazio; room:join preenche.
    socket.data.roomId = "";
    socket.data.participantId = "";
    socket.data.role = "player";
    socket.data.nickname = "";

    registerRoomHandlers(io, socket);
    registerSceneHandlers(io, socket);
    registerTokenHandlers(io, socket);
    registerChatHandlers(io, socket);
    registerCombatHandlers(io, socket);
    registerCharacterHandlers(io, socket);
    registerRulerHandlers(io, socket);
    registerFogHandlers(io, socket);
    registerTemplateHandlers(io, socket);
    registerCompendiumHandlers(io, socket);
    registerHistoryHandlers(io, socket);
    registerHandoutHandlers(io, socket);
    registerPinHandlers(io, socket);
    registerDrawingHandlers(io, socket);
    registerNotesHandlers(io, socket);
    registerTargetHandlers(io, socket);
    registerEncounterHandlers(io, socket);
    registerPartyHandlers(io, socket);

    socket.on("disconnect", (reason) => {
      log.info({ socketId: socket.id, reason }, "socket desconectado");
    });
  });
}
