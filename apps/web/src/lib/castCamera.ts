import { useEffect, useRef, useState } from "react";
import {
  autoCamera,
  followCamera,
  rotatedViewport,
  snapCenterToCells,
  tabletopZoom,
  tokenCenter,
  type CameraView,
  type Combat,
  type DisplayCameraMode,
  type DisplayViewPayload,
  type Point,
  type Scene,
  type TabletopPrefs,
  type Template,
  type Token,
  type Viewport,
} from "@tormenta-vtt/shared";
import { effectiveCellSize } from "./grid";
import { getSocket } from "../store/connection";
import { useCast } from "../store/cast";

/** Depois de um "Centralizar aqui" do Mestre, o modo automático espera este tempo antes de voltar
 *  a recalcular sozinho (docs/plano-cast.md §4.1) — senão o comando dele seria desfeito na hora. */
const CENTER_PAUSE_MS = 10_000;
/** Duração da transição suave entre enquadramentos (docs/plano-cast.md §3.2) — também reaproveitada
 *  por `HandoutOverlay` pro zoom/pan sincronizado do handout (docs/revisao-cast.md), mesma sensação
 *  de movimento. */
export const SMOOTH_MS = 400;

interface CastCameraInput {
  scene: Scene | null;
  tokens: Token[];
  combat: Combat | null;
  templates: Template[];
  cameraMode: DisplayCameraMode;
  /** Enquadramento cru mais recente vindo do servidor (display:view). */
  lastView: DisplayViewPayload | null;
  tabletop: TabletopPrefs;
  /** Tamanho FÍSICO real da tela (antes de qualquer rotação). */
  screenSize: Viewport;
}

/** Pontos dos tokens de JOGADOR visíveis agora (foco do modo automático fora de combate). */
function playerTokenPoints(tokens: Token[], cellSizePx: number): Point[] {
  return tokens.filter((t) => t.ownerId !== null && t.visible).map((t) => tokenCenter(t, cellSizePx));
}

/**
 * Cast — câmera da tela de exibição (docs/plano-cast.md §4). Decide PRA ONDE olhar (seguir o
 * Mestre / automático / livre, com zoom travado na mesa física) e devolve o enquadramento já
 * suavizado quadro a quadro — `DisplayPage` só passa `view` direto pro `controlledView` do
 * `VttCanvas`. `rotatedSize` é o tamanho que o container do canvas deve ter DE VERDADE (já
 * considerando a rotação 0/90/180/270 da calibração) — a rotação em si é aplicada por CSS em cima
 * disso, não aqui.
 */
export function useCastCamera(input: CastCameraInput): { view: CameraView | null; rotatedSize: Viewport } {
  const { scene, tokens, combat, templates, cameraMode, lastView, tabletop, screenSize } = input;
  const rotatedSize = rotatedViewport(screenSize, tabletop.rotation);
  const cellSizePx = scene ? effectiveCellSize(scene.grid) : 70;
  const lockedZoom = tabletop.enabled ? tabletopZoom({ pxPerCm: tabletop.pxPerCm, cellCm: tabletop.cellCm, cellSizePx }) : undefined;

  const [view, setView] = useState<CameraView | null>(null);
  const targetRef = useRef<CameraView | null>(null);
  const fromRef = useRef<CameraView | null>(null);
  const animRef = useRef<{ raf: number; startedAt: number } | null>(null);
  const centerPausedUntilRef = useRef(0);

  const startTransition = (target: CameraView) => {
    if (animRef.current) cancelAnimationFrame(animRef.current.raf);
    fromRef.current = view ?? target;
    targetRef.current = target;
    const startedAt = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - startedAt) / SMOOTH_MS);
      const from = fromRef.current!;
      const to = targetRef.current!;
      const eased = 1 - (1 - t) * (1 - t); // ease-out quadrático: chega suave, sem "bater"
      setView({
        center: { x: from.center.x + (to.center.x - from.center.x) * eased, y: from.center.y + (to.center.y - from.center.y) * eased },
        zoom: from.zoom + (to.zoom - from.zoom) * eased,
      });
      if (t < 1) animRef.current = { raf: requestAnimationFrame(tick), startedAt };
    };
    animRef.current = { raf: requestAnimationFrame(tick), startedAt };
  };

  // "Centralizar aqui" (qualquer modo) e "seguir o Mestre" (só no modo "follow") — eventos do servidor.
  useEffect(() => {
    if (!lastView || lastView.sceneId !== scene?.id) return;
    if (lastView.reason === "center") {
      centerPausedUntilRef.current = Date.now() + CENTER_PAUSE_MS;
    } else if (cameraMode !== "follow") {
      return; // "follow" fora de moda: um "seguir" de rotina não deveria mexer na tela.
    }
    const target = followCamera(lastView, rotatedSize, lockedZoom);
    startTransition(tabletop.enabled ? { ...target, center: snapCenterToCells(target.center, cellSizePx) } : target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastView]);

  // Modo automático: recalcula a cada mudança relevante (tokens, combate, gabaritos, zoom travado).
  useEffect(() => {
    if (cameraMode !== "auto" || Date.now() < centerPausedUntilRef.current) return;
    const activeCombatant = combat?.activeCombatantId ? combat.combatants.find((c) => c.id === combat.activeCombatantId) : null;
    const activeToken = activeCombatant ? tokens.find((t) => t.id === activeCombatant.tokenId) : null;

    let focus: Point[];
    let context: Point[];
    if (activeToken) {
      // Em combate: o combatente da vez é o ÚNICO foco obrigatório (zoom travado nunca abre mão
      // dele por causa de um gabarito longe) — gabaritos ativos e tokens de jogador entram como
      // contexto best-effort (puxam o enquadramento quando cabem, sem forçar).
      focus = [tokenCenter(activeToken, cellSizePx)];
      context = [...playerTokenPoints(tokens, cellSizePx), ...templates.map((tpl) => ({ x: tpl.x, y: tpl.y }))];
    } else {
      focus = playerTokenPoints(tokens, cellSizePx);
      context = [];
    }

    const current = view ?? { center: { x: 0, y: 0 }, zoom: lockedZoom ?? 1 };
    const next = autoCamera({ focus, context, viewport: rotatedSize, current, lockedZoom });
    if (next) startTransition(tabletop.enabled ? { ...next, center: snapCenterToCells(next.center, cellSizePx) } : next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraMode, tokens, combat, templates, lockedZoom, rotatedSize.width, rotatedSize.height]);

  // Mesa física: o zoom travado é recalculado a cada troca de mapa (cellSizePx muda). Isso tem que
  // valer em QUALQUER modo de câmera, inclusive "livre" — onde as duas transições acima nunca
  // rodam sozinhas — senão trocar de mapa em modo livre deixaria a mesa com a escala física do mapa
  // ANTERIOR. Correção instantânea (sem transição: é calibração, não um movimento de câmera),
  // mantendo o centro como estava.
  useEffect(() => {
    if (!tabletop.enabled || lockedZoom === undefined) return;
    setView((v) => (v && Math.abs(v.zoom - lockedZoom) > 1e-6 ? { ...v, zoom: lockedZoom } : v));
  }, [tabletop.enabled, lockedZoom]);

  useEffect(() => () => {
    if (animRef.current) cancelAnimationFrame(animRef.current.raf);
  }, []);

  return { view, rotatedSize };
}

/** Intervalo de checagem do enquadramento do Mestre — mesma cadência do plano (docs/plano-cast.md §4.1). */
const EMIT_GM_VIEW_INTERVAL_MS = 150;

/**
 * Cast, lado do GM (docs/plano-cast.md §4.1): manda o enquadramento atual pra tela ("seguir o
 * Mestre"), throttled e só quando vale a pena — modo "follow" e ao menos uma tela conectada (sem
 * tela, zero tráfego). `getView` lê `VttCanvasHandle.getView()` (`null` = canvas ainda não montado,
 * ex.: sem mapa aberto). Poll simples em vez de efeito reativo em stagePos/stageScale: essas duas
 * vivem DENTRO do `VttCanvas` (não sobem pro RoomPage), e um poll de 150ms é exatamente o throttle
 * que a emissão via evento precisaria de qualquer jeito.
 */
export function useEmitGmView(getView: () => { center: Point; viewWidth: number; viewHeight: number } | null, sceneId: string | null, enabled: boolean): void {
  const lastKeyRef = useRef("");
  useEffect(() => {
    if (!enabled || !sceneId) return;
    const id = setInterval(() => {
      const cast = useCast.getState();
      if (cast.displayCount === 0 || cast.cameraMode !== "follow") return;
      const v = getView();
      if (!v) return;
      const key = `${sceneId}:${v.center.x.toFixed(1)}:${v.center.y.toFixed(1)}:${v.viewWidth.toFixed(1)}:${v.viewHeight.toFixed(1)}`;
      if (key === lastKeyRef.current) return;
      lastKeyRef.current = key;
      getSocket().emit("display:view", { reason: "follow", sceneId, ...v }, () => undefined);
    }, EMIT_GM_VIEW_INTERVAL_MS);
    return () => clearInterval(id);
  }, [enabled, sceneId, getView]);
}
