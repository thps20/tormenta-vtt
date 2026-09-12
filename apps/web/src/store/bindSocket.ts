import type { Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@tormenta-vtt/shared";
import { useRoom } from "./room";
import { useTokens } from "./tokens";
import { useChat } from "./chat";
import { useCombat } from "./combat";
import { useTemplates } from "./templates";
import { useTargets } from "./targets";
import { useCharacters } from "./characters";
import { useParty } from "./party";
import { useHistory } from "./history";
import { useSceneList } from "./sceneList";
import { useTools } from "./tools";
import { useHandouts } from "./handouts";
import { usePins } from "./pins";
import { useDrawings } from "./drawings";
import { useEncounters } from "./encounters";
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
  socket.on("room:activeSceneChanged", ({ sceneId }) => {
    useRoom.getState().setActiveScene(sceneId);
    useSceneList.getState().refreshIfLoaded();
  });

  socket.on("scene:created", (scene) => {
    useRoom.getState().upsertScene(scene);
    useSceneList.getState().refreshIfLoaded();
  });
  socket.on("scene:updated", (scene) => useRoom.getState().upsertScene(scene));
  socket.on("scene:deleted", ({ sceneId }) => {
    useRoom.getState().removeScene(sceneId);
    useSceneList.getState().refreshIfLoaded();
  });
  socket.on("scene:reordered", ({ order }) => useRoom.getState().applyReorder(order));
  socket.on("fog:updated", ({ sceneId, fog }) => useRoom.getState().applyFog(sceneId, fog));

  socket.on("token:created", (token) => useTokens.getState().upsert(token));
  socket.on("token:updated", (token) => useTokens.getState().upsert(token));
  socket.on("token:deleted", ({ tokenId }) => useTokens.getState().remove(tokenId));

  socket.on("target:updated", (p) => useTargets.getState().applyRemote(p));

  socket.on("chat:message", (msg) => {
    useChat.getState().append(msg);
    // Handout mostrado AO VIVO abre sozinho pra quem recebe (a mensagem já veio filtrada pelo
    // servidor: se chegou aqui, este cliente pode vê-la). Histórico do room:join usa setAll, não
    // este handler — quem entra depois só vê a miniatura no chat e clica pra abrir (SPEC §9.10).
    useHandouts.getState().openFromLiveMessage(msg);
  });

  socket.on("combat:updated", ({ sceneId, combat }) => useCombat.getState().setSceneState(sceneId, combat));
  socket.on("combat:movementLimitChanged", ({ enabled }) => useRoom.getState().setMovementLimitEnabled(enabled));
  socket.on("combat:autoRollNpcInitiativeChanged", ({ enabled }) => useRoom.getState().setAutoRollNpcInitiativeEnabled(enabled));
  socket.on("drawing:playerPermissionChanged", ({ enabled }) => useRoom.getState().setPlayerDrawingEnabled(enabled));

  socket.on("ruler:updated", (p) => useTools.getState().setRemoteRuler(p));

  socket.on("template:upserted", ({ sceneId, template }) => useTemplates.getState().upsertLocal(sceneId, template));
  socket.on("template:removed", ({ sceneId, templateId }) => useTemplates.getState().removeLocal(sceneId, templateId));

  socket.on("character:created", (c) => useCharacters.getState().upsert(c));
  socket.on("character:updated", (c) => useCharacters.getState().upsert(c));
  socket.on("character:deleted", ({ characterId }) => useCharacters.getState().remove(characterId));

  // Visão de grupo (SPEC §9.15): lista completa, já filtrada por quem recebe — substitui, não faz merge.
  socket.on("party:updated", ({ party }) => useParty.getState().setAll(party));

  socket.on("history:updated", (p) => useHistory.getState().setState(p));

  // Handouts (§9.10): biblioteca só chega pro GM (rooms.gm).
  socket.on("handout:created", (h) => useHandouts.getState().upsertLibrary(h));
  socket.on("handout:updated", (h) => useHandouts.getState().upsertLibrary(h));
  socket.on("handout:deleted", ({ id }) => useHandouts.getState().removeFromLibrary(id));
  socket.on("handout:closed", ({ messageId }) => useHandouts.getState().closeIfOpen(messageId));

  // Pinos no mapa (docs/plano-narracao.md): mesma regra de broadcast de mapa de sempre.
  socket.on("pin:created", ({ sceneId, pin }) => usePins.getState().upsertPin(sceneId, pin));
  socket.on("pin:updated", ({ sceneId, pin }) => usePins.getState().upsertPin(sceneId, pin));
  socket.on("pin:removed", ({ sceneId, pinId }) => usePins.getState().removePin(sceneId, pinId));

  // Desenho livre no mapa (§9.17): mesma regra de broadcast de mapa de sempre.
  socket.on("drawing:created", ({ sceneId, drawing }) => useDrawings.getState().upsertLocal(sceneId, drawing));
  socket.on("drawing:updated", ({ sceneId, drawing }) => useDrawings.getState().upsertLocal(sceneId, drawing));
  socket.on("drawing:removed", ({ sceneId, drawingId }) => useDrawings.getState().removeLocal(sceneId, drawingId));
  socket.on("drawing:cleared", ({ sceneId, drawingIds }) => useDrawings.getState().removeManyLocal(sceneId, drawingIds));

  socket.on("encounter:created", (e) => useEncounters.getState().upsert(e));
  socket.on("encounter:updated", (e) => useEncounters.getState().upsert(e));
  socket.on("encounter:deleted", ({ id }) => useEncounters.getState().removeLocal(id));

  socket.on("server:error", ({ message }) => toast(message));
}
