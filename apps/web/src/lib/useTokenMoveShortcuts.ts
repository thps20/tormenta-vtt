import { useEffect, useRef } from "react";
import { DEFAULT_MAP_SIZE, getSystemDefinition, tokenPixelSize, type SystemDefinition, type Token } from "@tormenta-vtt/shared";
import { canControl } from "../components/VttCanvas";
import { canMoveNow, movementBudgetFallback, sceneCombat, useCombat } from "../store/combat";
import { selectViewedScene, useRoom } from "../store/room";
import { useTokens } from "../store/tokens";
import { toast } from "../store/ui";
import { clampToMap, effectiveCellSize, snapToGrid } from "./grid";
import { isTyping } from "./isTyping";
import { KEY_TO_DELTA, isToolShortcutKey, markKeyConsumed } from "./shortcutKeys";

/** `getSystemDefinition` lança se o id não existir; fora de uma sala não há nada pra checar mesmo. */
function safeSystemDef(systemId: string | undefined): SystemDefinition | null {
  if (!systemId) return null;
  try {
    return getSystemDefinition(systemId);
  } catch {
    return null;
  }
}

/** Depois de tanto tempo sem nova tecla, confirma a rajada — mesmo sem soltar (docs/plano-movimento.md D6). */
const CONFIRM_DELAY_MS = 250;

/**
 * Move o(s) token(s) selecionados com setas/WASD, com snap ao grid (docs/plano-movimento.md §3.1).
 * Shift = passo de 5 células. Só age com token selecionado (evita colidir com futuros atalhos de
 * letra) e nunca com o foco num campo de texto. Segurar a tecla é UM movimento, não N (D6): cada
 * passo aplica local + emite "ao vivo" (`tokens.moveLive`, já throttled a 33 ms); um patch final
 * (sem `live`) confirma ao soltar a tecla, ou 250 ms depois da última — assim Ctrl+Z desfaz a
 * rajada inteira de uma vez, não um passo por vez. Montado ao lado de `useToolShortcuts` na RoomPage.
 *
 * **Consome a tecla** quando de fato move alguém: listener na fase de CAPTURA da janela (roda antes
 * de qualquer outro, não importa a ordem de montagem dos hooks) + `preventDefault`,
 * `stopPropagation` e `markKeyConsumed`. É isso que resolve a colisão do **D** (mover para a direita
 * × ferramenta Desenho): com token selecionado que este usuário pode mover, o atalho de ferramenta
 * nem chega a rodar. Sem seleção — ou com seleção que ele não pode mover agora — a tecla segue o
 * caminho normal e o D volta a ser Desenho.
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
        // `t.x`/`t.y` = onde o token estava no INÍCIO da rajada (burstTokensRef guarda o snapshot
        // de lá, nunca atualizado durante o gesto): se o patch final for recusado (ex.: o turno
        // mudou de mão enquanto a tecla estava segurada), o revert do store volta pra cá — não pra
        // onde o `moveLive` tinha deixado localmente, que pode já estar fora de sincronia com o
        // servidor (os ecos ao vivo não têm ack, ver store/tokens.ts#revertTarget).
        return [{ id: t.id, x: dest.x, y: dest.y, dragFrom: { x: t.x, y: t.y } }];
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

      // Seta nunca é atalho de outra coisa: segura a rolagem da página mesmo que o movimento não
      // vá acontecer (sem seleção, fora do turno...).
      if (e.key.startsWith("Arrow")) e.preventDefault();

      /** Esta tecla é nossa: ninguém mais reage a ela (ver o comentário do hook). */
      const consume = () => {
        e.preventDefault();
        e.stopPropagation();
        markKeyConsumed(e);
      };

      const { selectedIds, byId: tokensById } = useTokens.getState();
      if (selectedIds.length === 0) {
        // WASD só age com token selecionado. Arrastar já seleciona sozinho (VttCanvas
        // #handleTokenDragStart, padrão Foundry), então isto só dispara sem NENHUMA interação antes
        // (ninguém clicou nem arrastou nada ainda). Sem o aviso, a tecla não fazia nada em silêncio
        // — parecia "o teclado não funciona" (docs/fix-movimento-turno.md).
        // Letra que também é ferramenta (D = Desenho): sem seleção ela troca a ferramenta, então o
        // aviso seria falso.
        if (!warnedRef.current && !isToolShortcutKey(e.key)) {
          toast("Selecione um token para mover com o teclado");
          warnedRef.current = true;
        }
        return;
      }

      const room = useRoom.getState();
      const me = room.me;
      const scene = selectViewedScene(room);
      if (!me || !scene) return;

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
        if (blocked) {
          // Token que este usuário controla, mas não é a vez dele: a tecla ainda era uma tentativa
          // de mover (não pode virar "trocar de ferramenta" no meio do combate), então consome.
          consume();
          if (!warnedRef.current) {
            toast("Não é o seu turno");
            warnedRef.current = true;
          }
        }
        if (movable.length === 0) return;
        burstTokensRef.current = movable;
      }
      // Daqui pra baixo o movimento VAI acontecer: só agora a tecla é consumida (seleção que este
      // usuário nem controla segue adiante, e o atalho de ferramenta continua valendo).
      consume();

      const cellSize = effectiveCellSize(scene.grid);
      const step = cellSize * (e.shiftKey ? 5 : 1);
      const map = { width: scene.mapWidth ?? DEFAULT_MAP_SIZE.width, height: scene.mapHeight ?? DEFAULT_MAP_SIZE.height };
      const { byId, moveLive } = useTokens.getState();
      for (const t of burstTokensRef.current) {
        const current = byId[t.id] ?? t;
        const raw = { x: current.x + delta.dx * step, y: current.y + delta.dy * step };
        const snapped = scene.grid.type === "none" ? raw : snapToGrid(raw.x, raw.y, scene.grid);
        const settled = clampToMap(snapped.x, snapped.y, tokenPixelSize(current.cells, cellSize), map);
        moveLive(t.id, settled.x, settled.y);
      }
      scheduleConfirm();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (KEY_TO_DELTA[e.key.toLowerCase()]) confirmBurst();
    };
    // Se a janela perde o foco com a tecla apertada, o keyup nunca chega.
    const onBlur = () => confirmBurst();

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      clearTimer();
    };
  }, []);
}
