import { create } from "zustand";
import { toggleTarget } from "@tormenta-vtt/shared";
import { emitAck } from "./connection";
import { selectViewedScene, useRoom } from "./room";
import { toast } from "./ui";

/**
 * Alvos marcados (docs/plano-alvos.md): efêmeros, nunca persistidos no cliente. `mine` é a MINHA
 * lista (Alt/Y no canvas, gabarito de área); `others` é a dos demais, já filtrada pelo servidor
 * (broadcast `target:updated`) — jogador nunca recebe os alvos do GM aqui.
 */
interface TargetsState {
  mine: string[];
  /** De onde `mine` veio: manual (Alt/Y) ou um gabarito de área que eu coloquei (docs/plano-alvos.md §3.6). */
  source: { kind: "manual" } | { kind: "template"; templateId: string };
  /** Alvos dos outros participantes, por participantId (nunca inclui o GM). */
  others: Record<string, { sceneId: string; tokenIds: string[] }>;

  /** room:join / leave. */
  setSnapshot: (targets: { participantId: string; sceneId: string; tokenIds: string[] }[], meId: string) => void;
  reset: () => void;
  /** Broadcast `target:updated` (inclusive eco das próprias outras abas). */
  applyRemote: (p: { participantId: string; sceneId: string; tokenIds: string[] }) => void;

  /** Alt (sem Shift) vira o único alvo; Shift+Alt entra/sai da lista. Otimista com ack e reversão. */
  toggle: (tokenId: string, additive: boolean) => Promise<void>;
  /** Alt em área vazia, ou apagar o gabarito de origem: limpa tudo. */
  clear: () => Promise<void>;
  /** Tokens dentro de um gabarito que EU coloquei (docs/plano-alvos.md §3.6) — substitui `mine` por
   *  inteiro; recalculado pelo chamador a cada vez que o gabarito muda. */
  setFromTemplate: (templateId: string, tokenIds: string[]) => Promise<void>;
}

async function send(tokenIds: string[]): Promise<{ ok: boolean; tokenIds?: string[] }> {
  const scene = selectViewedScene(useRoom.getState());
  if (!scene) return { ok: false };
  const res = await emitAck("target:set", { sceneId: scene.id, tokenIds });
  if (!res.ok) {
    toast(res.error);
    return { ok: false };
  }
  return { ok: true, tokenIds: res.data.tokenIds };
}

export const useTargets = create<TargetsState>((set, get) => ({
  mine: [],
  source: { kind: "manual" },
  others: {},

  setSnapshot: (targets, meId) => {
    const mine = targets.find((t) => t.participantId === meId)?.tokenIds ?? [];
    const others = Object.fromEntries(targets.filter((t) => t.participantId !== meId).map((t) => [t.participantId, { sceneId: t.sceneId, tokenIds: t.tokenIds }]));
    set({ mine, others, source: { kind: "manual" } });
  },
  reset: () => set({ mine: [], others: {}, source: { kind: "manual" } }),

  applyRemote: (p) => {
    if (p.participantId === useRoom.getState().me?.id) {
      set({ mine: p.tokenIds });
      return;
    }
    set((s) => ({ others: { ...s.others, [p.participantId]: { sceneId: p.sceneId, tokenIds: p.tokenIds } } }));
  },

  toggle: async (tokenId, additive) => {
    const previous = get().mine;
    const next = toggleTarget(previous, tokenId, additive);
    set({ mine: next, source: { kind: "manual" } });
    const res = await send(next);
    if (!res.ok) {
      set({ mine: previous });
      return;
    }
    set({ mine: res.tokenIds ?? [] });
  },

  clear: async () => {
    const previous = get().mine;
    if (previous.length === 0) {
      set({ source: { kind: "manual" } });
      return;
    }
    set({ mine: [], source: { kind: "manual" } });
    const res = await send([]);
    if (!res.ok) set({ mine: previous });
  },

  setFromTemplate: async (templateId, tokenIds) => {
    const previous = get().mine;
    set({ mine: tokenIds, source: { kind: "template", templateId } });
    const res = await send(tokenIds);
    if (!res.ok) {
      set({ mine: previous });
      return;
    }
    set({ mine: res.tokenIds ?? [] });
  },
}));
