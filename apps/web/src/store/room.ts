import { create } from "zustand";
import {
  applyFogOp,
  FOG_SHAPES_WARN,
  type ArrivalPoint,
  type FogConfig,
  type FogOp,
  type GridConfig,
  type Participant,
  type RoomPublic,
  type RoomSnapshot,
  type Scene,
  type SceneDeleteResult,
} from "@tormenta-vtt/shared";
import { getSessionToken, getViewingScene, setLastNickname, setSessionToken, setViewingScene, clearSessionToken } from "../lib/session";
import { emitAck, getSocket, type AckOf } from "./connection";
import { useTokens } from "./tokens";
import { useChat } from "./chat";
import { useCombat } from "./combat";
import { useTemplates } from "./templates";
import { useTargets } from "./targets";
import { useCharacters } from "./characters";
import { useParty } from "./party";
import { useCompendium } from "./compendium";
import { useHandouts } from "./handouts";
import { usePins } from "./pins";
import { useDrawings } from "./drawings";
import { useEncounters } from "./encounters";
import { useSceneList } from "./sceneList";
import { toast } from "./ui";

export type JoinStatus =
  | { kind: "idle" }
  | { kind: "joining" }
  | { kind: "needsNickname"; error?: string }
  | { kind: "joined" }
  | { kind: "error"; message: string };

interface JoinParams {
  inviteCode: string;
  gmSecret: string | null;
  nickname?: string;
}

interface RoomState {
  status: JoinStatus;
  room: RoomPublic | null;
  me: Participant | null;
  participants: Participant[];
  scenes: Scene[];
  /**
   * Mapa que ESTE cliente está vendo (docs/plano-mapas.md §4). Jogador: sempre igual ao ativo
   * (derivado, ver `selectViewedScene`); este campo só importa de verdade pro GM, que pode navegar
   * mapas sem ativar. Persistido por aba em `sessionStorage` (`lib/session.ts`).
   */
  viewingSceneId: string | null;
  /** Últimos parâmetros de join, para reconectar automaticamente. */
  lastJoin: JoinParams | null;
  /** Trava de orçamento de deslocamento da SALA (docs/plano-movimento.md §4.3): true = vale o
   *  orçamento; GM pode desligar ("ignorar limite") em `combat:set-movement-limit`. */
  movementLimitEnabled: boolean;
  /** "Rolar iniciativa dos NPCs ao iniciar o combate" da SALA (SPEC §3.5), padrão ligada — GM
   *  desliga em `combat:set-auto-roll-npc-initiative`. */
  autoRollNpcInitiativeEnabled: boolean;
  /** "Jogadores podem desenhar" da SALA (SPEC §9.17), padrão ligada — GM desliga em
   *  `drawing:set-player-permission`. Só trava CRIAR um traço novo. */
  playerDrawingEnabled: boolean;

  join: (params: JoinParams) => Promise<void>;
  leave: () => void;
  applySnapshot: (snap: RoomSnapshot) => void;

  // Broadcasts
  upsertParticipant: (p: Participant) => void;
  markDisconnected: (id: string) => void;
  upsertScene: (scene: Scene) => void;
  removeScene: (sceneId: string) => void;
  applyReorder: (order: { sceneId: string; order: number }[]) => void;
  setActiveScene: (sceneId: string) => void;
  /** fog:updated: substitui a névoa da cena pelo estado completo do servidor. */
  applyFog: (sceneId: string, fog: FogConfig) => void;

  /**
   * Navega para um mapa sem os efeitos colaterais de `room:join` (docs/plano-mapas.md §5): busca
   * só tokens+combate daquele mapa, faz `replaceScene`/`setSceneState` e atualiza `viewingSceneId`.
   * GM: qualquer mapa não apagado da sala. Jogador: só o mapa ativo (ack de erro caso contrário).
   */
  enterScene: (sceneId: string) => Promise<boolean>;

  // Ações do GM (mapas)
  createScene: (payload: { name: string; mapUrl?: string | null; mapWidth?: number | null; mapHeight?: number | null }) => Promise<Scene | null>;
  /** Ativar: opcionalmente leva tokens do mapa ativo atual (diálogo "Levar para o mapa", §8). */
  activateScene: (payload: { sceneId: string; moveTokenIds?: string[]; dropPoint?: ArrivalPoint }) => Promise<boolean>;
  renameScene: (sceneId: string, name: string) => Promise<boolean>;
  duplicateScene: (sceneId: string, name?: string) => Promise<Scene | null>;
  /** Ver SceneDeleteResult: "needs-confirm" ainda não apagou nada. */
  deleteScene: (sceneId: string, confirmMovePlayerTokens?: boolean) => Promise<SceneDeleteResult | null>;
  reorderScenes: (sceneIds: string[]) => Promise<boolean>;
  setSceneArrival: (sceneId: string, arrival: ArrivalPoint | null) => Promise<boolean>;
  setMap: (patch: { mapUrl: string | null; mapWidth: number | null; mapHeight: number | null }) => Promise<boolean>;
  updateGrid: (grid: Partial<GridConfig>) => Promise<boolean>;
  /** Névoa da cena visitada: aplica a operação local (otimista), emite e reverte se o ack falhar. */
  fogOp: (op: FogOp) => Promise<boolean>;
  /** `combat:movementLimitChanged` (broadcast) e o retorno do próprio `combat:set-movement-limit`. */
  setMovementLimitEnabled: (enabled: boolean) => void;
  /** `combat:autoRollNpcInitiativeChanged` (broadcast) e o retorno de `combat:set-auto-roll-npc-initiative`. */
  setAutoRollNpcInitiativeEnabled: (enabled: boolean) => void;
  /** `drawing:playerPermissionChanged` (broadcast) e o retorno do próprio `drawing:set-player-permission`. */
  setPlayerDrawingEnabled: (enabled: boolean) => void;
}

export const useRoom = create<RoomState>((set, get) => ({
  status: { kind: "idle" },
  room: null,
  me: null,
  participants: [],
  scenes: [],
  viewingSceneId: null,
  lastJoin: null,
  movementLimitEnabled: true,
  autoRollNpcInitiativeEnabled: true,
  playerDrawingEnabled: true,

  join: async (params) => {
    const socket = getSocket();
    set({ status: { kind: "joining" }, lastJoin: params });
    // A URL com ?gm= define o papel desejado; a sessão salva é separada por papel.
    const role = params.gmSecret ? "gm" : "player";
    const sessionToken = getSessionToken(params.inviteCode, role) ?? undefined;

    // Sem sessão salva e sem nickname: a UI precisa perguntar antes.
    if (!sessionToken && !params.nickname && !params.gmSecret) {
      set({ status: { kind: "needsNickname" } });
      return;
    }

    const res = await new Promise<AckOf<"room:join">>((resolve) =>
      socket.emit(
        "room:join",
        { inviteCode: params.inviteCode, nickname: params.nickname, gmSecret: params.gmSecret ?? undefined, sessionToken },
        resolve,
      ),
    );

    if (!res.ok) {
      if (res.error === "Sala não encontrada") {
        set({ status: { kind: "error", message: res.error } });
        return;
      }
      // Sessão inválida ou sem nickname: limpa e pede o nickname.
      clearSessionToken(params.inviteCode, role);
      set({ status: { kind: "needsNickname", error: params.nickname ? res.error : undefined } });
      return;
    }

    setSessionToken(params.inviteCode, role, res.data.sessionToken);
    if (params.nickname) setLastNickname(params.nickname);
    get().applySnapshot(res.data);
    set({ status: { kind: "joined" } });
  },

  leave: () => {
    set({
      status: { kind: "idle" },
      room: null,
      me: null,
      participants: [],
      scenes: [],
      viewingSceneId: null,
      lastJoin: null,
      movementLimitEnabled: true,
      autoRollNpcInitiativeEnabled: true,
      playerDrawingEnabled: true,
    });
    useTokens.getState().setAll([]);
    useChat.getState().setAll([]);
    useCombat.getState().setSnapshot(null, null);
    useTemplates.getState().setSnapshot(null, []);
    useTargets.getState().reset();
    useCharacters.getState().setAll([]);
    useParty.getState().setAll([]);
    useCompendium.getState().reset();
    useHandouts.getState().reset();
    usePins.getState().reset();
    useDrawings.getState().reset();
    useEncounters.getState().reset();
    useSceneList.getState().reset();
    // Desconectar e reconectar é o jeito simples de sair das salas do Socket.io.
    const socket = getSocket();
    socket.disconnect();
    socket.connect();
  },

  applySnapshot: (snap) => {
    set({
      room: snap.room,
      me: snap.me,
      participants: snap.participants,
      scenes: snap.scenes,
      movementLimitEnabled: snap.movementLimitEnabled,
      autoRollNpcInitiativeEnabled: snap.autoRollNpcInitiativeEnabled,
      playerDrawingEnabled: snap.playerDrawingEnabled,
    });
    useTokens.getState().setAll(snap.tokens);
    useChat.getState().setAll(snap.chat);
    useCombat.getState().setSnapshot(snap.room.activeSceneId, snap.combat);
    useTemplates.getState().setSnapshot(snap.room.activeSceneId, snap.templates);
    usePins.getState().setSnapshot(snap.room.activeSceneId, snap.pins);
    useDrawings.getState().setSnapshot(snap.room.activeSceneId, snap.drawings);
    useTargets.getState().setSnapshot(snap.targets, snap.me.id);
    useCharacters.getState().setAll(snap.characters);
    useParty.getState().setAll(snap.party);

    // Jogador sempre vê o ativo (derivado, sem sessionStorage). GM: restaura o mapa que estava
    // visitando (F5 no meio da preparação); se o id salvo não existe mais (mapa apagado) ou é o
    // próprio ativo (já veio no snapshot), fica nele sem round-trip extra.
    if (snap.me.role !== "gm") {
      set({ viewingSceneId: snap.room.activeSceneId });
      return;
    }
    const saved = getViewingScene(snap.room.id);
    const target = saved && snap.scenes.some((sc) => sc.id === saved) ? saved : snap.room.activeSceneId;
    if (target && target !== snap.room.activeSceneId) void get().enterScene(target);
    else set({ viewingSceneId: snap.room.activeSceneId });
  },

  upsertParticipant: (p) =>
    set((s) => ({
      participants: s.participants.some((x) => x.id === p.id)
        ? s.participants.map((x) => (x.id === p.id ? p : x))
        : [...s.participants, p],
    })),

  markDisconnected: (id) =>
    set((s) => ({ participants: s.participants.map((p) => (p.id === id ? { ...p, connected: false } : p)) })),

  upsertScene: (scene) =>
    set((s) => ({
      scenes: s.scenes.some((x) => x.id === scene.id) ? s.scenes.map((x) => (x.id === scene.id ? scene : x)) : [...s.scenes, scene],
    })),

  removeScene: (sceneId) =>
    set((s) => ({
      scenes: s.scenes.filter((sc) => sc.id !== sceneId),
      // Quem estava vendo o mapa apagado cai pro ativo (sempre existe: invariante do §3 do plano).
      viewingSceneId: s.viewingSceneId === sceneId ? (s.room?.activeSceneId ?? null) : s.viewingSceneId,
    })),

  applyReorder: (order) => {
    const orderById = new Map(order.map((o) => [o.sceneId, o.order]));
    set((s) => ({ scenes: s.scenes.map((sc) => (orderById.has(sc.id) ? { ...sc, order: orderById.get(sc.id)! } : sc)) }));
  },

  setActiveScene: (sceneId) => {
    const s = get();
    const wasViewingPreviousActive = s.viewingSceneId === s.room?.activeSceneId;
    const isPlayer = s.me?.role === "player";
    set((st) => (st.room ? { room: { ...st.room, activeSceneId: sceneId } } : {}));
    // Jogador sempre segue; GM só se estava vendo o mapa que era ativo (quem clicou em "Ativar"
    // já mudou viewingSceneId otimisticamente em activateScene, então cai aqui de qualquer jeito;
    // quem estava visitando outro mapa fica onde está — a faixa de aviso muda pra apontar pro novo).
    if (isPlayer || wasViewingPreviousActive) void get().enterScene(sceneId);
  },

  applyFog: (sceneId, fog) => set((s) => ({ scenes: s.scenes.map((sc) => (sc.id === sceneId ? { ...sc, fog } : sc)) })),

  enterScene: async (sceneId) => {
    const res = await emitAck("scene:enter", { sceneId });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    useTokens.getState().replaceScene(sceneId, res.data.tokens);
    useCombat.getState().setSceneState(sceneId, res.data.combat);
    useTemplates.getState().replaceScene(sceneId, res.data.templates);
    usePins.getState().replaceScene(sceneId, res.data.pins);
    useDrawings.getState().replaceScene(sceneId, res.data.drawings);
    set({ viewingSceneId: sceneId });
    const roomId = get().room?.id;
    if (roomId) setViewingScene(roomId, sceneId);
    return true;
  },

  createScene: async (payload) => {
    const res = await emitAck("scene:create", payload);
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsertScene(res.data);
    return res.data;
  },

  activateScene: async (payload) => {
    const res = await emitAck("scene:activate", payload);
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    // Quem ativou segue sempre pro destino, mesmo que estivesse visitando um terceiro mapa.
    void get().enterScene(payload.sceneId);
    return true;
  },

  renameScene: async (sceneId, name) => {
    const res = await emitAck("scene:rename", { sceneId, name });
    if (!res.ok) toast(res.error);
    else get().upsertScene(res.data);
    return res.ok;
  },

  duplicateScene: async (sceneId, name) => {
    const res = await emitAck("scene:duplicate", { sceneId, name });
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsertScene(res.data);
    return res.data;
  },

  deleteScene: async (sceneId, confirmMovePlayerTokens) => {
    const res = await emitAck("scene:delete", { sceneId, confirmMovePlayerTokens });
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    // "deleted": scene:deleted já chega pelo broadcast (removeScene). "needs-confirm": nada mudou
    // ainda, a UI decide se pergunta e reenvia com confirmMovePlayerTokens: true.
    return res.data;
  },

  reorderScenes: async (sceneIds) => {
    const previous = get().scenes.map((s) => ({ sceneId: s.id, order: s.order }));
    // 1. otimista
    get().applyReorder(sceneIds.map((sceneId, order) => ({ sceneId, order })));
    const res = await emitAck("scene:reorder", { sceneIds });
    if (!res.ok) {
      get().applyReorder(previous);
      toast(res.error);
      return false;
    }
    get().applyReorder(res.data.order);
    return true;
  },

  setSceneArrival: async (sceneId, arrival) => {
    const res = await emitAck("scene:setArrival", { sceneId, arrival });
    if (!res.ok) toast(res.error);
    else get().upsertScene(res.data);
    return res.ok;
  },

  setMap: async (patch) => {
    const sceneId = selectViewedScene(get())?.id;
    if (!sceneId) return false;
    const res = await emitAck("scene:setMap", { sceneId, ...patch });
    if (!res.ok) toast(res.error);
    return res.ok;
  },

  updateGrid: async (grid) => {
    const sceneId = selectViewedScene(get())?.id;
    if (!sceneId) return false;
    const res = await emitAck("scene:updateGrid", { sceneId, grid });
    if (!res.ok) toast(res.error);
    return res.ok;
  },

  fogOp: async (op) => {
    const scene = selectViewedScene(get());
    if (!scene) return false;
    const previous = scene.fog;
    // 1. otimista, com a mesma função pura que o servidor usa.
    const local = applyFogOp(previous, op);
    if (!local.ok) {
      toast(local.error);
      return false;
    }
    get().applyFog(scene.id, local.fog);
    const count = local.fog.shapes.length;
    // Aviso ao cruzar o limite "amarelo" e a cada 50 formas depois dele (o servidor recusa no limite duro).
    if (op.type === "add" && count > FOG_SHAPES_WARN && (count - FOG_SHAPES_WARN - 1) % 50 === 0) {
      toast(`A névoa já tem ${count} formas. Use "Revelar tudo" ou "Ocultar tudo" para recomeçar do zero.`, "info");
    }
    // 2. ack: o servidor devolve o estado que valeu (o broadcast fog:updated também chega; aplicar é idempotente).
    const res = await emitAck("fog:update", { sceneId: scene.id, op });
    if (!res.ok) {
      // 3. reverte
      get().applyFog(scene.id, previous);
      toast(res.error);
      return false;
    }
    get().applyFog(scene.id, res.data);
    return true;
  },

  setMovementLimitEnabled: (enabled) => set({ movementLimitEnabled: enabled }),
  setAutoRollNpcInitiativeEnabled: (enabled) => set({ autoRollNpcInitiativeEnabled: enabled }),
  setPlayerDrawingEnabled: (enabled) => set({ playerDrawingEnabled: enabled }),
}));

/** Mapa ATIVO da sala (derivado). Use para a faixa de aviso e o painel "Mapas". */
export const selectActiveScene = (s: RoomState): Scene | null =>
  s.scenes.find((sc) => sc.id === s.room?.activeSceneId) ?? null;

/**
 * Mapa que ESTE cliente está VENDO (docs/plano-mapas.md §4): substitui `selectActiveScene` em
 * quase todo lugar (canvas, névoa, régua, combate, seletor de alvos, MapConfigModal, spawn de
 * criatura). Jogador: sempre o ativo. GM: `viewingSceneId`, com o ativo como reserva enquanto o
 * primeiro `scene:enter` ainda não voltou.
 */
export const selectViewedScene = (s: RoomState): Scene | null => {
  if (s.me?.role !== "gm") return selectActiveScene(s);
  return s.scenes.find((sc) => sc.id === s.viewingSceneId) ?? selectActiveScene(s);
};

export const selectIsGm = (s: RoomState): boolean => s.me?.role === "gm";
