import { useEffect } from "react";
import { isTyping } from "./isTyping";

/**
 * Atalho global pra recolher/expandir o painel lateral (chat/iniciativa/fichas): `\` (barra
 * invertida) ou Ctrl+B, fora de campo de texto — mesma proteção `isTyping` dos outros atalhos
 * (cobre o chat, onde `\` deveria só digitar). `onToggle` decide o resto (persiste em
 * localStorage, ver Table em RoomPage.tsx).
 */
export function useSidePanelShortcut(onToggle: () => void): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const isBackslash = e.key === "\\" && !e.ctrlKey && !e.metaKey && !e.altKey;
      const isCtrlB = e.key.toLowerCase() === "b" && (e.ctrlKey || e.metaKey) && !e.altKey;
      if (!isBackslash && !isCtrlB) return;
      e.preventDefault();
      onToggle();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onToggle]);
}
