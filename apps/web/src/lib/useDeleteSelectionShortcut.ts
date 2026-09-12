import { useEffect } from "react";
import { getSystemDefinition } from "@tormenta-vtt/shared";
import { selectIsGm, useRoom } from "../store/room";
import { useTokens } from "../store/tokens";
import { useTemplates } from "../store/templates";
import { useTemplateHistory } from "../store/templateHistory";
import { usePins } from "../store/pins";
import { useDrawings } from "../store/drawings";
import { useDrawingHistory } from "../store/drawingHistory";
import { useCharacters } from "../store/characters";
import { isTyping } from "./isTyping";
import { newId } from "./ids";
import { describeTemplateAreaChange } from "./templates";
import { effectiveCellSize } from "./grid";

/**
 * Apaga os tokens selecionados agora. Compartilhada pelo atalho Delete/Backspace (useDeleteSelectionShortcut,
 * abaixo) e pelo botão de lixeira do NpcQuickCard — os dois chamam esta MESMA função, nunca duplicam a
 * regra. Só o GM; jogador não apaga nada por aqui (TokenInspector.onDelete é outro caminho, com sua
 * própria confirmação, sem mudar). Sem confirmação para até 3 tokens; confirma se são mais de 3 ou se
 * algum está vinculado a uma ficha de jogador (delete mais sensível). Um único token:delete-many
 * (não um loop de token:delete): o servidor empilha UMA entrada de histórico pro lote inteiro,
 * então Ctrl+Z desfaz todos de uma vez (docs/plano-desfazer.md §2).
 */
export function deleteSelectedTokens(): void {
  if (!selectIsGm(useRoom.getState())) return;
  const { selectedIds, byId, deleteMany } = useTokens.getState();
  if (selectedIds.length === 0) return;

  const charById = useCharacters.getState().byId;
  const hasPlayerLinked = selectedIds.some((id) => {
    const characterId = byId[id]?.characterId;
    return characterId != null && charById[characterId]?.kind === "pc";
  });

  if (selectedIds.length > 3 || hasPlayerLinked) {
    const label = selectedIds.length === 1 ? `o token "${byId[selectedIds[0] ?? ""]?.name ?? ""}"` : `${selectedIds.length} tokens selecionados`;
    const warn = hasPlayerLinked
      ? selectedIds.length === 1
        ? " Ele está vinculado a uma ficha de jogador."
        : " Um ou mais estão vinculados a uma ficha de jogador."
      : "";
    if (!window.confirm(`Apagar ${label}?${warn}`)) return;
  }

  void deleteMany(selectedIds);
}

/**
 * Apaga o gabarito de área de efeito selecionado, se houver (docs/plano-gabaritos.md). Diferente
 * de `deleteSelectedTokens`: GM ou dono (o servidor confere de novo; selecionar um gabarito alheio
 * nem é possível pelo clique — VttCanvas só seleciona o que o usuário controla). Token e gabarito
 * nunca ficam selecionados juntos, então os dois `delete*` desta função nunca disparam ao mesmo tempo.
 * Jogador (não-GM): empilha no Ctrl+Z local antes de apagar — o GM já tem isso pela pilha geral do
 * servidor (socket/templates.ts empilha sozinho ao receber template:remove), docs/plano-gabaritos.md §4.
 */
function deleteSelectedTemplate(): void {
  const { selectedId, byScene, remove } = useTemplates.getState();
  if (!selectedId) return;
  const sceneId = Object.keys(byScene).find((id) => byScene[id]?.[selectedId]);
  const removed = sceneId ? byScene[sceneId]?.[selectedId] : undefined;
  if (!sceneId || !removed) return;

  if (!selectIsGm(useRoom.getState())) {
    const { room, scenes } = useRoom.getState();
    const def = room ? getSystemDefinition(room.systemId) : null;
    const scene = scenes.find((sc) => sc.id === sceneId);
    if (def && scene) {
      const cellSizePx = effectiveCellSize(scene.grid);
      useTemplateHistory.getState().push({
        summary: describeTemplateAreaChange("apagar", def, removed, cellSizePx),
        revert: () => useTemplates.getState().create(sceneId, removed),
      });
    }
  }
  void remove(sceneId, selectedId);
}

/**
 * Apaga o pino selecionado, se houver (docs/plano-narracao.md — pino se comporta como token: só
 * GM apaga, entra no desfazer do GM — `pin:remove` já empilha sozinho no servidor, socket/pins.ts,
 * mesmo padrão de `handout:delete`). Sem confirmação: Ctrl+Z corrige um clique errado tão bem
 * quanto um `confirm()` custaria uma interrupção (mesmo raciocínio do botão direito que o pino
 * tinha antes desta mudança).
 */
function deleteSelectedPin(): void {
  if (!selectIsGm(useRoom.getState())) return;
  const { selectedId, pinsByScene, remove } = usePins.getState();
  if (!selectedId) return;
  const sceneId = Object.keys(pinsByScene).find((id) => pinsByScene[id]?.[selectedId]);
  if (!sceneId) return;
  void remove(sceneId, selectedId);
}

/**
 * Apaga o traço de desenho selecionado, se houver (SPEC §9.17). GM ou dono — VttCanvas só deixa
 * selecionar o que o usuário controla (`canControlDrawing`), então não precisa reconferir aqui,
 * mesmo raciocínio de `deleteSelectedTemplate`. Jogador (não-GM): empilha no Ctrl+Z LOCAL antes de
 * apagar (o GM já tem a pilha geral — `socket/drawings.ts` empilha sozinho ao receber
 * `drawing:remove`), mesma decisão de gabaritos.
 */
function deleteSelectedDrawing(): void {
  const { selectedId, byScene, remove } = useDrawings.getState();
  if (!selectedId) return;
  const sceneId = Object.keys(byScene).find((id) => byScene[id]?.[selectedId]);
  const removed = sceneId ? byScene[sceneId]?.[selectedId] : undefined;
  if (!sceneId || !removed) return;

  if (!selectIsGm(useRoom.getState())) {
    // `remove` é soft delete (a linha continua no banco, docs/plano-desfazer.md) — recriar com o
    // MESMO id colidiria com a chave primária ainda existente; o "desfazer" local do jogador (sem
    // acesso ao undo do servidor) é uma cópia NOVA, com um id novo, não uma restauração de verdade.
    useDrawingHistory.getState().push({
      summary: "apagar desenho",
      revert: () => useDrawings.getState().create(sceneId, { ...removed, id: newId() }).then((d) => d !== null),
    });
  }
  void remove(sceneId, selectedId);
}

/**
 * Atalho global: Delete/Backspace apaga os tokens (só GM), o gabarito de área selecionado (GM ou
 * dono), o pino selecionado (só GM) ou o traço de desenho selecionado (GM ou dono), quando o foco
 * não está num campo de texto (isTyping). Multi-seleção de token apaga todos de uma vez. Token/
 * gabarito/pino/traço nunca ficam selecionados juntos (VttCanvas garante isso a cada seleção),
 * então só uma das quatro chamadas abaixo faz algo. Um único listener na janela (montado pela
 * página da mesa, ao lado de useToolShortcuts).
 */
export function useDeleteSelectionShortcut(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      deleteSelectedTokens();
      deleteSelectedTemplate();
      deleteSelectedPin();
      deleteSelectedDrawing();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
