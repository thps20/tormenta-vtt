import type { Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@tormenta-vtt/shared";
import { useRoom } from "./room";
import { useTokens } from "./tokens";
import { useChat } from "./chat";
import { useInitiative } from "./initiative";
import { useCharacters } from "./characters";
import { useTools } from "./tools";
import { toast } from "./ui";

/**
 * Liga cada broadcast do servidor à store certa. Chamado uma única vez ao
 * criar o socket. Componentes nunca fazem socket.on: só leem as stores.
 */
export function bindSocket(socket: Socket<ServerToClientEvents, ClientToServerEvents>): void {
  // Reconexão automática: se a conexão caiu e voltou, entra de novo na sala
  // com o sessionToken salvo (o servidor devolve um snapshot fresco).
  socket.on("connect", () => {
    // Na primeira conexão o join inicial já está na fila do socket; só reentramos se a
    // conexão caiu depois de já termos entrado.
    const { lastJoin, status } = useRoom.getState();
    if (lastJoin && status.kind === "joined") void useRoom.getState().join(lastJoin);
  });

  socket.on("room:participantJoined", (p) => useRoom.getState().upsertParticipant(p));
  socket.on("room:participantLeft", ({ id }) => {
    useRoom.getState().markDisconnected(id);
    // Quem caiu no meio de uma medição não vai mandar o "apagar".
    useTools.getState().removeRemoteRuler(id);
  });
  socket.on("room:activeSceneChanged", ({ sceneId }) => useRoom.getState().setActiveScene(sceneId));

  socket.on("scene:created", (scene) => useRoom.getState().upsertScene(scene));
  socket.on("scene:updated", (scene) => useRoom.getState().upsertScene(scene));
  socket.on("fog:updated", ({ sceneId, fog }) => useRoom.getState().applyFog(sceneId, fog));

  socket.on("token:created", (token) => useTokens.getState().upsert(token));
  socket.on("token:updated", (token) => useTokens.getState().upsert(token));
  socket.on("token:deleted", ({ tokenId }) => useTokens.getState().remove(tokenId));

  socket.on("chat:message", (msg) => useChat.getState().append(msg));

  socket.on("initiative:updated", (state) => useInitiative.getState().setState(state));

  socket.on("ruler:updated", (p) => useTools.getState().setRemoteRuler(p));

  socket.on("character:created", (c) => useCharacters.getState().upsert(c));
  socket.on("character:updated", (c) => useCharacters.getState().upsert(c));
  socket.on("character:deleted", ({ characterId }) => useCharacters.getState().remove(characterId));

  socket.on("server:error", ({ message }) => toast(message));
}
