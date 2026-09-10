import { useEffect, useRef } from "react";
import { DEFAULT_MAP_SIZE, getSystemDefinition, type SystemDefinition, type Token } from "@tormenta-vtt/shared";
import { canControl } from "../components/VttCanvas";
import { canMoveNow, movementBudgetFallback, sceneCombat, useCombat } from "../store/combat";
import { selectViewedScene, useRoom } from "../store/room";
import { useTokens } from "../store/tokens";
import { toast } from "../store/ui";
import { clampToMap, effectiveCellSize, snapToGrid } from "./grid";
import { isTyping } from "./isTyping";

/** `getSystemDefinition` lança se o id não existir; fora de uma sala não há nada pra checar mesmo. */
function safeSystemDef(systemId: string | undefined): SystemDefinition | null {
  if (!systemId) return null;
  try {
    return getSystemDefinition(systemId);
  } catch {
    return null;
  }
}

/** Tecla → direção (célula). Setas e WASD apontam pro mesmo lugar. */
const KEY_TO_DELTA: Record<string, { dx: number; dy: number }> = {
  arrowup: { dx: 0, dy: -1 },
  arrowdown: { dx: 0, dy: 1 },
  arrowleft: { dx: -1, dy: 0 },
  arrowright: { dx: 1, dy: 0 },
  w: { dx: 0, dy: -1 },
  s: { dx: 0, dy: 1 },
  a: { dx: -1, dy: 0 },
  d: { dx: 1, dy: 0 },
};

/** Depois de tanto tempo sem nova tecla, confirma a rajada — mesmo sem soltar (docs/plano-movimento.md D6). */
const CONFIRM_DELAY_MS = 250;

/**
 * Move o(s) token(s) selecionados com setas/WASD, com snap ao grid (docs/plano-movimento.md §3.1).
 * Shift = passo de 5 células. Só age com token selecionado (evita colidir com futuros atalhos de
 * letra) e nunca com o foco num campo de texto. Segurar a tecla é UM movimento, não N (D6): cada
 * passo aplica local + emite "ao vivo" (`tokens.moveLive`, já throttled a 33 ms); um patch final
 * (sem `live`) confirma ao soltar a tecla, ou 250 ms depois da última — assim Ctrl+Z desfaz a
 * rajada inteira de uma vez, não um passo por vez. Montado ao lado de `useToolShortcuts` na RoomPage.
 */
export function useTokenMoveShortcuts(): void {
  // Refs (não state): o handler de teclado não deve re-renderizar o componente a cada passo.
  const burstTokensRef = useRef<Token[] | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnedRef = useRef(false);

  useEffect(() => {
    const clearTimer = () => {
      if (confirmTimerRef.current) {
        clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = null;
      }
    };

    /** Fecha a rajada: manda o patch final (um token: patch; vários: patchMany, uma entrada de
     *  histórico só — mesma convenção do arraste em grupo, ver VttCanvas#handleTokenDragEnd).
     *  Se o destino não coube no orçamento de deslocamento (D2), manda a âncora em vez do destino
     *  — mesma função que o arraste usa (movementBudgetFallback), o servidor decide de novo. */
    const confirmBurst = () => {
      clearTimer();
      const tokens = burstTokensRef.current;
      burstTokensRef.current = null;
      warnedRef.current = false;
      if (!tokens || tokens.length === 0) return;

      const room = useRoom.getState();
      const scene = selectViewedScene(room);
      const def = safeSystemDef(room.room?.systemId);
      const combat = scene ? sceneCombat(useCombat.getState().byScene, scene.id) : null;
      const cellSizePx = scene ? effectiveCellSize(scene.grid) : 0;
      let toastedInsufficient = false;

      const { byId, patch, patchMany } = useTokens.getState();
      const patches = tokens.flatMap((t) => {
        const current = byId[t.id];
        if (!current) return [];
        let dest = { x: current.x, y: current.y };
        const fallback = def ? movementBudgetFallback(def, combat, room.movementLimitEnabled, cellSizePx, t.id, dest) : null;
        if (fallback) {
          dest = { x: fallback.x, y: fallback.y };
          if (!toastedInsufficient) {
            toast(`Deslocamento insuficiente (restam ${Math.round(fallback.remaining * 10) / 10} ${fallback.unit})`);
            toastedInsufficient = true;
          }
        }
        return [{ id: t.id, x: dest.x, y: dest.y }];
      });
      if (patches.length === 0) return;
      if (patches.length > 1) void patchMany(patches);
      else void patch(patches[0]!);
    };

    const scheduleConfirm = () => {
      clearTimer();
      confirmTimerRef.current = setTimeout(confirmBurst, CONFIRM_DELAY_MS);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const delta = KEY_TO_DELTA[e.key.toLowerCase()];
      if (!delta) return;

      const { selectedIds, byId: tokensById } = useTokens.getState();
      if (selectedIds.length === 0) return; // WASD só age com token selecionado

      const room = useRoom.getState();
      const me = room.me;
      const scene = selectViewedScene(room);
      if (!me || !scene) return;

      e.preventDefault();

      // Início de uma rajada nova: decide AGORA quem se move (não muda tecla a tecla). Filtra por
      // controle (GM ou dono) e pela trava de turno (canMoveNow espelha o servidor, que decide de novo).
      if (!burstTokensRef.current) {
        const combat = sceneCombat(useCombat.getState().byScene, scene.id);
        const movable: Token[] = [];
        let blocked = false;
        for (const id of selectedIds) {
          const t = tokensById[id];
          if (!t || !canControl(me, t)) continue;
          if (canMoveNow(combat, t, me) !== "ok") {
            blocked = true;
            continue;
          }
          movable.push(t);
        }
        if (blocked && !warnedRef.current) {
          toast("Não é o seu turno");
          warnedRef.current = true;
        }
        if (movable.length === 0) return;
        burstTokensRef.current = movable;
      }

      const cellSize = effectiveCellSize(scene.grid);
      const step = cellSize * (e.shiftKey ? 5 : 1);
      const map = { width: scene.mapWidth ?? DEFAULT_MAP_SIZE.width, height: scene.mapHeight ?? DEFAULT_MAP_SIZE.height };
      const { byId, moveLive } = useTokens.getState();
      for (const t of burstTokensRef.current) {
        const current = byId[t.id] ?? t;
        const raw = { x: current.x + delta.dx * step, y: current.y + delta.dy * step };
        const snapped = scene.grid.type === "none" ? raw : snapToGrid(raw.x, raw.y, scene.grid);
        const settled = clampToMap(snapped.x, snapped.y, current, map);
        moveLive(t.id, settled.x, settled.y);
      }
      scheduleConfirm();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (KEY_TO_DELTA[e.key.toLowerCase()]) confirmBurst();
    };
    // Se a janela perde o foco com a tecla apertada, o keyup nunca chega.
    const onBlur = () => confirmBurst();

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      clearTimer();
    };
  }, []);
}
