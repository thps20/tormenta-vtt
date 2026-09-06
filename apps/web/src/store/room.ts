import { create } from "zustand";
import type { GridConfig, Participant, RoomPublic, RoomSnapshot, Scene } from "@tormenta-vtt/shared";
import { getSessionToken, setLastNickname, setSessionToken, clearSessionToken } from "../lib/session";
import { emitAck, getSocket, type AckOf } from "./connection";
import { useTokens } from "./tokens";
import { useChat } from "./chat";
import { useInitiative } from "./initiative";
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

  // Ações do GM
  setMap: (patch: { mapUrl: string | null; mapWidth: number | null; mapHeight: number | null }) => Promise<boolean>;
  updateGrid: (grid: Partial<GridConfig>) => Promise<boolean>;
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
    useInitiative.getState().setState(null);
    // Desconectar e reconectar é o jeito simples de sair das salas do Socket.io.
    const socket = getSocket();
    socket.disconnect();
    socket.connect();
  },

  applySnapshot: (snap) => {
    set({ room: snap.room, me: snap.me, participants: snap.participants, scenes: snap.scenes });
    useTokens.getState().setAll(snap.tokens);
    useChat.getState().setAll(snap.chat);
    useInitiative.getState().setState(snap.initiative);
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
