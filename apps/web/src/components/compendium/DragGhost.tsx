import React, { useEffect, useRef } from "react";
import type { SystemDefinition } from "@tormenta-vtt/shared";
import { Skull } from "lucide-react";
import { useCompendium } from "../../store/compendium";
import { useEncounters } from "../../store/encounters";
import { creatureIcon, kindIcon } from "../character/kindIcons";

/** Distância (px) a partir da qual um pressionar-e-mover vira arrasto, e não clique. */
const DRAG_THRESHOLD = 4;

/**
 * Arrasto de entradas do compêndio com pointer events (não HTML5 drag, que não
 * conversa bem com o Konva). O pointerdown na linha só anota o candidato; o
 * arrasto começa quando o cursor se move mais que DRAG_THRESHOLD. Move/solta são
 * ouvidos na janela, então funcionam mesmo com a paleta em pointer-events: none.
 */
export function useCompendiumDrag(): { onRowPointerDown: (e: React.PointerEvent, entryId: string) => void } {
  const pending = useRef<{ entryId: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const point = { x: e.clientX, y: e.clientY };
      const s = useCompendium.getState();
      if (s.drag) {
        s.moveDrag(point);
        return;
      }
      const p = pending.current;
      if (p && Math.hypot(point.x - p.x, point.y - p.y) > DRAG_THRESHOLD) {
        s.startDrag(p.entryId, point);
        s.moveDrag(point);
      }
    };
    const onUp = () => {
      pending.current = null;
      if (useCompendium.getState().drag) useCompendium.getState().endDrag();
    };
    // Esc durante o arrasto cancela só o arrasto (a paleta continua aberta).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useCompendium.getState().drag) {
        e.stopPropagation();
        pending.current = null;
        useCompendium.getState().cancelDrag();
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey, true);
      useCompendium.getState().cancelDrag();
    };
  }, []);

  const onRowPointerDown = (e: React.PointerEvent, entryId: string) => {
    if (e.button !== 0) return;
    pending.current = { entryId, x: e.clientX, y: e.clientY };
  };
  return { onRowPointerDown };
}

/** "Fantasma" que segue o cursor durante o arrasto. Fica fora da paleta para não herdar a translucidez dela. */
export const DragGhost: React.FC<{ def: SystemDefinition }> = ({ def }) => {
  const drag = useCompendium((s) => s.drag);
  const entry = useCompendium((s) => (s.drag ? s.entries.find((e) => e.id === s.drag?.entryId) : undefined));
  if (!drag || !entry) return null;
  const index = entry.type === "item" ? def.itemKinds.findIndex((k) => k.key === entry.kind) : -1;
  const Icon = entry.type === "item" ? kindIcon(Math.max(0, index)) : creatureIcon;
  const kindLabel = entry.type === "item" ? (def.itemKinds[index]?.label ?? entry.kind) : "Criatura";
  const overTarget = drag.targetId !== null;
  return (
    <div
      id="compendium-drag-ghost"
      className={`fixed z-[60] pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-[#1a1712]/95 shadow-[0_8px_24px_rgba(0,0,0,0.7)] text-xs font-serif transition-colors ${
        overTarget ? "border-[#d4af37] text-amber-100" : "border-zinc-600 text-zinc-300"
      }`}
      style={{ left: drag.point.x + 14, top: drag.point.y + 10 }}
    >
      <Icon className={`w-3.5 h-3.5 ${overTarget ? "text-[#d4af37]" : "text-zinc-500"}`} />
      <span className="font-bold">{entry.name}</span>
      <span className="text-[10px] text-zinc-500">{kindLabel}</span>
    </div>
  );
};

/**
 * Arrasto de um encontro salvo pro mapa (§9.14): mesmo mecanismo de useCompendiumDrag, cartão
 * próprio porque o que se arrasta é um SavedEncounter (store/encounters.ts), não uma CompendiumEntry.
 */
export function useEncounterDrag(): { onRowPointerDown: (e: React.PointerEvent, encounterId: string) => void } {
  const pending = useRef<{ encounterId: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const point = { x: e.clientX, y: e.clientY };
      const s = useEncounters.getState();
      if (s.drag) {
        s.moveDrag(point);
        return;
      }
      const p = pending.current;
      if (p && Math.hypot(point.x - p.x, point.y - p.y) > DRAG_THRESHOLD) {
        s.startDrag(p.encounterId, point);
        s.moveDrag(point);
      }
    };
    const onUp = () => {
      pending.current = null;
      if (useEncounters.getState().drag) useEncounters.getState().endDrag();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && useEncounters.getState().drag) {
        e.stopPropagation();
        pending.current = null;
        useEncounters.getState().cancelDrag();
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("keydown", onKey, true);
      useEncounters.getState().cancelDrag();
    };
  }, []);

  const onRowPointerDown = (e: React.PointerEvent, encounterId: string) => {
    if (e.button !== 0) return;
    pending.current = { encounterId, x: e.clientX, y: e.clientY };
  };
  return { onRowPointerDown };
}

/**
 * Fantasma do arrasto de um encontro: um rótulo simples com o total de criaturas, não a espiral
 * exata (isso duplicaria expandEncounterEntries no cliente só pra preview visual — decisão
 * deliberada, ver plano da feature). O servidor calcula a posição real de cada uma ao soltar.
 */
export const EncounterDragGhost: React.FC = () => {
  const drag = useEncounters((s) => s.drag);
  const encounter = useEncounters((s) => (s.drag ? s.items.find((e) => e.id === s.drag?.encounterId) : undefined));
  if (!drag || !encounter) return null;
  const overTarget = drag.targetId !== null;
  const total = encounter.entries.reduce((sum, e) => sum + e.count, 0);
  return (
    <div
      id="encounter-drag-ghost"
      className={`fixed z-[60] pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-lg border bg-[#1a1712]/95 shadow-[0_8px_24px_rgba(0,0,0,0.7)] text-xs font-serif transition-colors ${
        overTarget ? "border-[#d4af37] text-amber-100" : "border-zinc-600 text-zinc-300"
      }`}
      style={{ left: drag.point.x + 14, top: drag.point.y + 10 }}
    >
      <Skull className={`w-3.5 h-3.5 ${overTarget ? "text-[#d4af37]" : "text-zinc-500"}`} />
      <span className="font-bold">{encounter.name}</span>
      <span className="text-[10px] text-zinc-500">{total} criatura{total === 1 ? "" : "s"}</span>
    </div>
  );
};
