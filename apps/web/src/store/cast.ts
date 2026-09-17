import { create } from "zustand";
import type { CastState, DisplayCameraMode, DisplayHandoutViewPayload, DisplayViewPayload, HandoutCard } from "@tormenta-vtt/shared";
import { emitAck, getSocket } from "./connection";
import { toast } from "./ui";

/**
 * Cast — tela de exibição (docs/plano-cast.md). Uma store só serve os DOIS lados, porque os dois
 * compartilham o mesmo `cameraMode`/`blackout` (broadcast pros dois) e é a mesma sala de qualquer
 * jeito — evita duas stores que precisariam ficar sincronizadas entre si:
 *  - GM: `displayToken`/`displayCount` (de `RoomSnapshot.cast`, GM only) + as ações (criar/revogar
 *    link, mudar modo, blackout, centralizar).
 *  - Tela: `cameraMode`/`blackout` (de `DisplaySnapshot`) + `lastView` (o `display:view` mais
 *    recente do Mestre, cru — `DisplayPage`/`lib/castCamera.ts` decidem o que fazer com ele) +
 *    `displayHandout` (overlay "para todos", docs/plano-cast.md §10).
 */
interface CastStoreState {
  displayToken: string | null;
  displayCount: number;
  cameraMode: DisplayCameraMode;
  blackout: boolean;

  /** Último enquadramento do Mestre repassado pelo servidor (tela). Cru: câmera decide o resto. */
  lastView: DisplayViewPayload | null;
  /** Handout "para todos" atualmente aberto (tela) — null = nenhum. */
  displayHandout: HandoutCard | null;
  /** Zoom/pan mais recente do Mestre no handout aberto (docs/revisao-cast.md) — cru, `HandoutOverlay`
   *  decide o enquadramento. Limpo ao fechar/trocar o handout ou ligar o blackout. */
  handoutView: DisplayHandoutViewPayload | null;
  /** O link foi revogado/trocado enquanto esta tela estava conectada — mostra aviso e para. */
  revoked: boolean;

  hydrateFromCastState: (cast: CastState) => void;
  hydrateForDisplay: (p: { cameraMode: DisplayCameraMode; blackout: boolean }) => void;
  reset: () => void;

  setPresenceCount: (count: number) => void;
  setTokenChanged: (token: string | null) => void;
  setCameraModeChanged: (mode: DisplayCameraMode) => void;
  setBlackoutChanged: (blackout: boolean) => void;
  setView: (view: DisplayViewPayload) => void;
  setDisplayHandout: (handout: HandoutCard | null) => void;
  setHandoutView: (view: DisplayHandoutViewPayload) => void;
  setRevoked: () => void;

  createLink: () => Promise<string | null>;
  revokeLink: () => Promise<boolean>;
  setCameraMode: (mode: DisplayCameraMode) => Promise<void>;
  setBlackout: (on: boolean) => Promise<void>;
  /** "Centralizar aqui": manda o enquadramento atual do Mestre, em qualquer modo de câmera. */
  centerHere: (view: Omit<DisplayViewPayload, "reason">) => void;
}

export const useCast = create<CastStoreState>((set, get) => ({
  displayToken: null,
  displayCount: 0,
  cameraMode: "follow",
  blackout: false,
  lastView: null,
  displayHandout: null,
  handoutView: null,
  revoked: false,

  hydrateFromCastState: (cast) => set({ displayToken: cast.displayToken, displayCount: cast.displayCount, cameraMode: cast.cameraMode, blackout: cast.blackout }),
  hydrateForDisplay: ({ cameraMode, blackout }) => set({ cameraMode, blackout }),
  reset: () =>
    set({
      displayToken: null,
      displayCount: 0,
      cameraMode: "follow",
      blackout: false,
      lastView: null,
      displayHandout: null,
      handoutView: null,
      revoked: false,
    }),

  setPresenceCount: (count) => set({ displayCount: count }),
  setTokenChanged: (displayToken) => set({ displayToken }),
  setCameraModeChanged: (cameraMode) => set({ cameraMode }),
  // Blackout cobre a tela toda (inclusive um handout aberto por baixo, ver DisplayPage) — mas o
  // ENQUADRAMENTO sincronizado não deveria sobreviver escondido: religar sem blackout reabre o
  // handout centralizado, esperando o Mestre mexer de novo (docs/revisao-cast.md).
  setBlackoutChanged: (blackout) => set({ blackout, handoutView: blackout ? null : get().handoutView }),
  setView: (lastView) => set({ lastView }),
  // Fechar ou trocar o handout limpa o enquadramento sincronizado — o próximo aberto começa
  // centralizado até o Mestre mexer de novo, nunca herda o zoom/pan de um handout anterior.
  setDisplayHandout: (displayHandout) => set({ displayHandout, handoutView: null }),
  setHandoutView: (view) => {
    if (get().displayHandout?.handoutId === view.handoutId) set({ handoutView: view });
  },
  setRevoked: () => set({ revoked: true }),

  createLink: async () => {
    const res = await emitAck("display:create-token", {});
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    set({ displayToken: res.data.displayToken });
    return res.data.displayToken;
  },
  revokeLink: async () => {
    const res = await emitAck("display:revoke-token", {});
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    set({ displayToken: null, displayCount: 0 });
    return true;
  },
  setCameraMode: async (mode) => {
    const prev = get().cameraMode;
    set({ cameraMode: mode }); // otimista: é preferência de sala, não vale a pena esperar o ack pra refletir
    const res = await emitAck("display:set-camera-mode", { mode });
    if (!res.ok) {
      set({ cameraMode: prev });
      toast(res.error);
    }
  },
  setBlackout: async (on) => {
    const prev = get().blackout;
    set({ blackout: on });
    const res = await emitAck("display:set-blackout", { blackout: on });
    if (!res.ok) {
      set({ blackout: prev });
      toast(res.error);
    }
  },
  centerHere: (view) => {
    void getSocket().emit("display:view", { ...view, reason: "center" }, () => undefined);
  },
}));
