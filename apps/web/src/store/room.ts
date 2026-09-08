import { create } from "zustand";
import { applyFogOp, FOG_SHAPES_WARN, type FogConfig, type FogOp, type GridConfig, type Participant, type RoomPublic, type RoomSnapshot, type Scene } from "@tormenta-vtt/shared";
import { getSessionToken, setLastNickname, setSessionToken, clearSessionToken } from "../lib/session";
import { emitAck, getSocket, type AckOf } from "./connection";
import { useTokens } from "./tokens";
import { useChat } from "./chat";
import { useCombat } from "./combat";
import { useCharacters } from "./characters";
import { useCompendium } from "./compendium";
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
  /** Últimos parâmetros de join, para reconectar automaticamente. */
  lastJoin: JoinParams | null;

  join: (params: JoinParams) => Promise<void>;
  leave: () => void;
  applySnapshot: (snap: RoomSnapshot) => void;

  // Broadcasts
  upsertParticipant: (p: Participant) => void;
  markDisconnected: (id: string) => void;
  upsertScene: (scene: Scene) => void;
  setActiveScene: (sceneId: string) => void;
  /** fog:updated: substitui a névoa da cena pelo estado completo do servidor. */
  applyFog: (sceneId: string, fog: FogConfig) => void;

  // Ações do GM
  setMap: (patch: { mapUrl: string | null; mapWidth: number | null; mapHeight: number | null }) => Promise<boolean>;
  updateGrid: (grid: Partial<GridConfig>) => Promise<boolean>;
  /** Névoa da cena ativa: aplica a operação local (otimista), emite e reverte se o ack falhar. */
  fogOp: (op: FogOp) => Promise<boolean>;
}

export const useRoom = create<RoomState>((set, get) => ({
  status: { kind: "idle" },
  room: null,
  me: null,
  participants: [],
  scenes: [],
  lastJoin: null,

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
    set({ status: { kind: "idle" }, room: null, me: null, participants: [], scenes: [], lastJoin: null });
    useTokens.getState().setAll([]);
    useChat.getState().setAll([]);
    useCombat.getState().setState(null);
    useCharacters.getState().setAll([]);
    useCompendium.getState().reset();
    // Desconectar e reconectar é o jeito simples de sair das salas do Socket.io.
    const socket = getSocket();
    socket.disconnect();
    socket.connect();
  },

  applySnapshot: (snap) => {
    set({ room: snap.room, me: snap.me, participants: snap.participants, scenes: snap.scenes });
    useTokens.getState().setAll(snap.tokens);
    useChat.getState().setAll(snap.chat);
    useCombat.getState().setState(snap.combat);
    useCharacters.getState().setAll(snap.characters);
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

  setActiveScene: (sceneId) => {
    set((s) => (s.room ? { room: { ...s.room, activeSceneId: sceneId } } : {}));
    // Tokens são da cena ativa: pede um snapshot novo.
    const last = get().lastJoin;
    if (last) void get().join(last);
  },

  applyFog: (sceneId, fog) => set((s) => ({ scenes: s.scenes.map((sc) => (sc.id === sceneId ? { ...sc, fog } : sc)) })),

  fogOp: async (op) => {
    const scene = selectActiveScene(get());
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

  setMap: async (patch) => {
    const sceneId = get().room?.activeSceneId;
    if (!sceneId) return false;
    const res = await emitAck("scene:setMap", { sceneId, ...patch });
    if (!res.ok) toast(res.error);
    return res.ok;
  },

  updateGrid: async (grid) => {
    const sceneId = get().room?.activeSceneId;
    if (!sceneId) return false;
    const res = await emitAck("scene:updateGrid", { sceneId, grid });
    if (!res.ok) toast(res.error);
    return res.ok;
  },
}));

/** Cena ativa (derivada). Use dentro de componentes: `useRoom(selectActiveScene)`. */
export const selectActiveScene = (s: RoomState): Scene | null =>
  s.scenes.find((sc) => sc.id === s.room?.activeSceneId) ?? null;

export const selectIsGm = (s: RoomState): boolean => s.me?.role === "gm";
