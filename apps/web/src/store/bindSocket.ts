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
import { useCompendium } from "./compendium";
import { usePins } from "./pins";
import { useDrawings } from "./drawings";
import { useEncounters } from "./encounters";
import { useMacros } from "./macros";
import { useCast } from "./cast";
import { useLibrary } from "./library";
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
    const { lastJoin, lastJoinDisplay, status } = useRoom.getState();
    if (status.kind !== "joined") return;
    if (lastJoin) void useRoom.getState().join(lastJoin);
    // Cast (docs/plano-cast.md): tela de exibição reconecta com o mesmo token, sozinha — se ele
    // foi revogado nesse meio, o ack vem com erro e ela mostra o aviso (ver DisplayPage).
    else if (lastJoinDisplay) void useRoom.getState().joinDisplay(lastJoinDisplay);
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

  // Acervo (docs/plano-preparo.md §1): Asset e favoritos só chegam pro GM (rooms.gm).
  socket.on("asset:created", (a) => useLibrary.getState().upsertAsset(a));
  socket.on("asset:updated", (a) => useLibrary.getState().upsertAsset(a));
  socket.on("asset:deleted", ({ id }) => useLibrary.getState().removeAssetLocal(id));
  socket.on("library:favoritesChanged", ({ favorites }) => useLibrary.getState().setFavorites(favorites));

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

  // Homebrew da sala (§9.18): biblioteca só chega pro GM (rooms.gm), mesmo padrão de handout:*.
  socket.on("compendium:room-created", (entry) => useCompendium.getState().upsertRoomEntry(entry));
  socket.on("compendium:room-updated", (entry) => useCompendium.getState().upsertRoomEntry(entry));
  socket.on("compendium:room-deleted", ({ entryId }) => useCompendium.getState().removeRoomEntry(entryId));

  // Macros (§9.20): só chega nas próprias abas do participante dono (rooms.participant).
  socket.on("macro:created", (macro) => useMacros.getState().upsertMacro(macro));
  socket.on("macro:updated", (macro) => useMacros.getState().upsertMacro(macro));
  socket.on("macro:removed", ({ id }) => useMacros.getState().removeMacro(id));
  socket.on("macro:reordered", ({ order }) => useMacros.getState().applyReorder(order));

  socket.on("server:error", ({ message }) => toast(message));

  // Cast — tela de exibição (docs/plano-cast.md). `display:presence`/`display:tokenChanged`/
  // `display:frame` só chegam ao GM (rooms.gm); `display:view`/`display:previewDemand`/
  // `display:handout` só à tela (rooms.display); `cameraModeChanged`/`blackoutChanged` chegam aos
  // dois — a mesma store serve ambos (ver store/cast.ts).
  socket.on("display:presence", ({ count }) => useCast.getState().setPresenceCount(count));
  socket.on("display:tokenChanged", ({ displayToken }) => useCast.getState().setTokenChanged(displayToken));
  socket.on("display:cameraModeChanged", ({ mode }) => useCast.getState().setCameraModeChanged(mode));
  socket.on("display:blackoutChanged", ({ blackout }) => useCast.getState().setBlackoutChanged(blackout));
  socket.on("display:view", (view) => useCast.getState().setView(view));
  socket.on("display:previewDemand", ({ on }) => useCast.getState().setPreviewDemandChanged(on));
  socket.on("display:frame", ({ dataUrl }) => useCast.getState().setPreviewFrame(dataUrl));
  socket.on("display:handout", ({ handout }) => useCast.getState().setDisplayHandout(handout));
  socket.on("display:handout-view", (view) => useCast.getState().setHandoutView(view));
  socket.on("display:revoked", () => useCast.getState().setRevoked());
}
