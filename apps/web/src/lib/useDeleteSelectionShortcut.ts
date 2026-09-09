import { useEffect } from "react";
import { selectIsGm, useRoom } from "../store/room";
import { useTokens } from "../store/tokens";
import { useCharacters } from "../store/characters";
import { isTyping } from "./isTyping";

/**
 * Apaga os tokens selecionados agora. Compartilhada pelo atalho Delete/Backspace (useDeleteSelectionShortcut,
 * abaixo) e pelo botão de lixeira do NpcQuickCard — os dois chamam esta MESMA função, nunca duplicam a
 * regra. Só o GM; jogador não apaga nada por aqui (TokenInspector.onDelete é outro caminho, com sua
 * própria confirmação, sem mudar). Sem confirmação para até 3 tokens (o Ctrl+Z de tokens vem depois);
 * confirma se são mais de 3 ou se algum está vinculado a uma ficha de jogador (delete mais sensível).
 */
export function deleteSelectedTokens(): void {
  if (!selectIsGm(useRoom.getState())) return;
  const { selectedIds, byId, delete: deleteToken } = useTokens.getState();
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

  for (const id of selectedIds) void deleteToken(id);
}

/**
 * Atalho global: Delete/Backspace apaga os tokens selecionados no canvas, quando o foco não está
 * num campo de texto (isTyping). Multi-seleção apaga todos de uma vez. Um único listener na janela
 * (montado pela página da mesa, ao lado de useToolShortcuts).
 */
export function useDeleteSelectionShortcut(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      deleteSelectedTokens();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
