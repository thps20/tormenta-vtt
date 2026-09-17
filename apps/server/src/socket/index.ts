import type { FastifyBaseLogger } from "fastify";
import { isDisplayAllowedEvent } from "../services/display.js";
import { registerDisplayHandlers } from "./display.js";
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
import { registerMacroHandlers } from "./macros.js";
import type { TypedServer } from "./types.js";

/** Ponto único que liga todos os handlers de socket. */
export function registerSocketHandlers(io: TypedServer, log: FastifyBaseLogger): void {
  io.on("connection", (socket) => {
    log.info({ socketId: socket.id }, "socket conectado");
    // socket.data começa vazio; room:join (ou display:join, pra tela de exibição) preenche.
    socket.data.roomId = "";
    socket.data.participantId = "";
    socket.data.role = "player";
    socket.data.nickname = "";
    socket.data.isDisplay = false;

    // Somente leitura da tela de exibição (docs/plano-cast.md §1.5): garantia central, não cada
    // handler lembrando de checar. Um socket de tela só passa por eventos de `isDisplayAllowedEvent`
    // — qualquer outro é recusado ANTES de chegar no handler (`guarded`/schema nem rodam). Registrado
    // antes de tudo: intercepta todo pacote de entrada deste socket, não só os handlers abaixo dele.
    socket.use(([eventName], next) => {
      if (socket.data.isDisplay && !isDisplayAllowedEvent(eventName)) {
        next(new Error("Tela de exibição é somente leitura"));
        return;
      }
      next();
    });

    // Registrado antes dos demais: seu listener de "disconnect" precisa ler socket.data.roomId
    // ANTES do de `registerRoomHandlers` limpar (listeners do mesmo evento rodam na ordem de
    // registro) — ver comentário em socket/room.ts.
    registerDisplayHandlers(io, socket);
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
    registerMacroHandlers(io, socket);

    socket.on("disconnect", (reason) => {
      log.info({ socketId: socket.id, reason }, "socket desconectado");
    });
  });
}
