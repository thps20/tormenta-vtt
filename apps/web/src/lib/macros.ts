import type { Character, MacroAction } from "@tormenta-vtt/shared";

/**
 * "Arrastar uma ação da ficha para a barra" (docs/SPEC.md §9.20): mimetype próprio do
 * `dataTransfer`, lido só pelo `MacroBar` — os botões de ação de `ItemsSection.tsx` são a origem.
 */
export const MACRO_DRAG_MIME = "application/x-tvtt-macro-action";

export interface MacroDragPayload {
  /** Rótulo padrão pro formulário ("Espada longa: Ataque", "Bola de fogo"). */
  label: string;
  action: Extract<MacroAction, { type: "characterAction" | "useItem" }>;
}

export function encodeMacroDrag(payload: MacroDragPayload): string {
  return JSON.stringify(payload);
}

/** `null` = não é um drag de ação de ficha (ou dado corrompido) — o alvo ignora em silêncio. */
export function decodeMacroDrag(raw: string): MacroDragPayload | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("action" in parsed) || !("label" in parsed)) return null;
    return parsed as MacroDragPayload;
  } catch {
    return null;
  }
}

export type MacroTargetCheck = { ok: true } | { ok: false; reason: string };

/**
 * Confere se a ficha/item/ação que uma macro `characterAction`/`useItem` aponta ainda existe —
 * "macro de ficha que aponta para item apagado fica esmaecida com aviso, não quebra" (não é
 * permissão: quem editou a própria ficha e apagou o item não devia levar um erro de ack só de
 * olhar a barra). `roll`/`chatText` nunca dependem de personagem nenhum: sempre `ok`.
 */
/**
 * Descrição amigável de uma `characterAction`/`useItem` pra prévia do editor de macro ("Espada
 * longa: Ataque", "Bola de fogo") — cai num texto genérico se a referência já sumiu (mesma checagem
 * de `resolveMacroTarget`, sem duplicar erro nenhum: aqui é só rótulo, não trava nada).
 */
export function describeCharacterAction(action: Extract<MacroAction, { type: "characterAction" | "useItem" }>, characters: Character[]): string {
  const item = characters.find((c) => c.id === action.characterId)?.items.find((i) => i.id === action.itemId);
  if (!item) return action.type === "useItem" ? "Usar item" : "Ação de ficha";
  if (action.type === "useItem") return item.name;
  const actionLabel = item.actions.find((a) => a.id === action.actionId)?.label;
  return actionLabel ? `${item.name}: ${actionLabel}` : item.name;
}

export function resolveMacroTarget(action: MacroAction, characters: Character[]): MacroTargetCheck {
  if (action.type !== "characterAction" && action.type !== "useItem") return { ok: true };
  const character = characters.find((c) => c.id === action.characterId);
  if (!character) return { ok: false, reason: "Personagem não encontrado" };
  const item = character.items.find((i) => i.id === action.itemId);
  if (!item) return { ok: false, reason: "Item não encontrado" };
  if (action.type === "useItem") return { ok: true };
  const found = item.actions.some((a) => a.id === action.actionId);
  return found ? { ok: true } : { ok: false, reason: "Ação não encontrada" };
}
