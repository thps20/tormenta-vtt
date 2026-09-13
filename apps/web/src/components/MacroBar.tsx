import React, { useState } from "react";
import { AlertTriangle, Pencil, Plus, Trash2 } from "lucide-react";
import type { Macro, MacroAction } from "@tormenta-vtt/shared";
import { DEFAULT_PIN_ICONS } from "../lib/pinIcons";
import { decodeMacroDrag, describeCharacterAction, MACRO_DRAG_MIME, resolveMacroTarget } from "../lib/macros";
import { sortedCharacters, useCharacters } from "../store/characters";
import { orderedMacros, useMacros } from "../store/macros";
import { MacroFormPopover, summarizeMacroAction, type MacroFormValue } from "./MacroFormPopover";

/**
 * Barra de macros (docs/SPEC.md §9.20): botões pessoais, um por macro, na ordem salva — clique
 * executa (`useMacros.run`), arrastar reordena (mesmo padrão de `MapsPanel.tsx`), soltar uma ação
 * arrastada da ficha (`MACRO_DRAG_MIME`) cria uma macro nova já com a ação certa. Um "+" no fim
 * cria uma macro de rolagem livre ou texto (os dois tipos que não dependem de nenhuma ficha).
 * Editar/apagar aparecem no hover de cada botão. Fica sempre visível quando há pelo menos uma
 * macro OU o próprio criador está aberto; o botão da barra superior só abre o criador.
 */
export function useMacroBarController() {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [quickCreateDraft, setQuickCreateDraft] = useState<{ action: MacroAction; label: string } | null>(null);
  /** "Salvar como macro" nos cards do chat (ItemCardMessage, rolagem livre): abre o criador já com
   *  a ação travada, só faltando nome/ícone/cor — mesmo caminho de "arrastar da ficha". */
  const openQuickCreate = (action: MacroAction, label: string) => setQuickCreateDraft({ action, label });
  return { creating, setCreating, editingId, setEditingId, quickCreateDraft, setQuickCreateDraft, openQuickCreate };
}

export type MacroBarController = ReturnType<typeof useMacroBarController>;

export const MacroBar: React.FC<{ controller: MacroBarController; immersiveHidden?: boolean }> = ({ controller, immersiveHidden }) => {
  const macros = orderedMacros(useMacros((s) => s.macros));
  const characters = sortedCharacters(useCharacters((s) => s.byId));
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dragOverBar, setDragOverBar] = useState(false);
  const { creating, setCreating, editingId, setEditingId, quickCreateDraft, setQuickCreateDraft } = controller;

  const editingMacro = macros.find((m) => m.id === editingId) ?? null;

  const handleDrop = (targetId: string) => {
    setDragOverId(null);
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      return;
    }
    const ids = macros.map((m) => m.id);
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from !== -1 && to !== -1) {
      const next = [...ids];
      next.splice(from, 1);
      next.splice(to, 0, draggedId);
      void useMacros.getState().reorder(next);
    }
    setDraggedId(null);
  };

  const handleBarDrop = (e: React.DragEvent) => {
    setDragOverBar(false);
    const raw = e.dataTransfer.getData(MACRO_DRAG_MIME);
    if (!raw) return;
    const payload = decodeMacroDrag(raw);
    if (!payload) return;
    e.preventDefault();
    setQuickCreateDraft({ action: payload.action, label: payload.label });
  };

  if (macros.length === 0 && !creating && !quickCreateDraft) {
    // Nada pra mostrar: barra vazia não ocupa espaço. O botão "Macros" da barra superior sempre
    // consegue abrir o criador (ver RoomPage), então a barra reaparece na hora de criar a primeira.
    return (
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(MACRO_DRAG_MIME)) e.preventDefault();
        }}
        onDrop={handleBarDrop}
        className="fixed bottom-3 left-1/2 -translate-x-1/2 z-30"
      />
    );
  }

  return (
    <>
      <div
        id="macro-bar"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(MACRO_DRAG_MIME)) {
            e.preventDefault();
            setDragOverBar(true);
          }
        }}
        onDragLeave={() => setDragOverBar(false)}
        onDrop={handleBarDrop}
        style={{ opacity: immersiveHidden ? 0 : 1, pointerEvents: immersiveHidden ? "none" : undefined }}
        className={`fixed bottom-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 px-1.5 py-1.5 rounded-lg border shadow-xl transition-all duration-300 ${
          dragOverBar ? "bg-[#2d2417] border-[#d4af37]" : "bg-[#161513]/95 border-[#2d2417]"
        }`}
      >
        {macros.map((macro, index) => (
          <MacroButton
            key={macro.id}
            macro={macro}
            shortcutKey={index < 9 ? String(index + 1) : undefined}
            beingDragged={draggedId === macro.id}
            isDropTarget={dragOverId === macro.id}
            broken={!resolveMacroTarget(macro.action, characters).ok}
            onRun={() => {
              const check = resolveMacroTarget(macro.action, characters);
              if (!check.ok) return;
              void useMacros.getState().run(macro);
            }}
            onEdit={() => setEditingId(macro.id)}
            onRemove={() => void useMacros.getState().remove(macro.id)}
            onDragStart={() => setDraggedId(macro.id)}
            onDragOver={() => draggedId && draggedId !== macro.id && setDragOverId(macro.id)}
            onDrop={() => handleDrop(macro.id)}
            onDragEnd={() => {
              setDraggedId(null);
              setDragOverId(null);
            }}
          />
        ))}

        <button
          id="btn-macro-new"
          onClick={() => setCreating(true)}
          title="Nova macro"
          className="w-9 h-9 flex items-center justify-center rounded border border-dashed border-[#3d3d3d] text-zinc-500 hover:text-[#d4af37] hover:border-[#d4af37] transition-colors cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {creating && (
        <MacroFormPopover
          title="Nova macro"
          onCancel={() => setCreating(false)}
          onSubmit={(value: MacroFormValue) => {
            setCreating(false);
            void useMacros.getState().create(value);
          }}
        />
      )}

      {quickCreateDraft && (
        <MacroFormPopover
          title="Nova macro"
          initial={{ label: quickCreateDraft.label }}
          lockedAction={quickCreateDraft.action}
          lockedActionSummary={quickCreateDraft.label}
          onCancel={() => setQuickCreateDraft(null)}
          onSubmit={(value: MacroFormValue) => {
            setQuickCreateDraft(null);
            void useMacros.getState().create(value);
          }}
        />
      )}

      {editingMacro && (
        <MacroFormPopover
          title="Editar macro"
          initial={{ label: editingMacro.label, icon: editingMacro.icon, color: editingMacro.color, action: editingMacro.action }}
          lockedAction={editingMacro.action.type === "characterAction" || editingMacro.action.type === "useItem" ? editingMacro.action : undefined}
          lockedActionSummary={
            editingMacro.action.type === "characterAction" || editingMacro.action.type === "useItem"
              ? describeCharacterAction(editingMacro.action, characters)
              : summarizeMacroAction(editingMacro.action)
          }
          onCancel={() => setEditingId(null)}
          onSubmit={(value: MacroFormValue) => {
            setEditingId(null);
            void useMacros.getState().update(editingMacro.id, value);
          }}
        />
      )}
    </>
  );
};

interface MacroButtonProps {
  macro: Macro;
  shortcutKey?: string;
  beingDragged: boolean;
  isDropTarget: boolean;
  broken: boolean;
  onRun: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

const MacroButton: React.FC<MacroButtonProps> = ({ macro, shortcutKey, beingDragged, isDropTarget, broken, onRun, onEdit, onRemove, onDragStart, onDragOver, onDrop, onDragEnd }) => {
  const icon = DEFAULT_PIN_ICONS.find((i) => i.key === macro.icon);

  return (
    <div
      className={`relative group w-9 h-9 shrink-0 transition-opacity ${beingDragged ? "opacity-30" : "opacity-100"} ${isDropTarget ? "ring-2 ring-[#d4af37] rounded" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
    >
      <button
        onClick={onRun}
        disabled={broken}
        title={broken ? `${macro.label} — referência não encontrada (ficha/item apagado)` : `${macro.label}${shortcutKey ? ` (tecla ${shortcutKey})` : ""}`}
        className={`w-9 h-9 flex items-center justify-center rounded border cursor-pointer transition-all active:scale-95 disabled:cursor-not-allowed ${
          broken ? "opacity-40 grayscale border-[#3d3d3d] bg-[#1a1a1a]" : "border-[#3d3d3d] bg-[#1f1d19] hover:border-current"
        }`}
        style={broken ? undefined : { color: macro.color }}
      >
        {broken ? (
          <AlertTriangle className="w-4 h-4 text-red-400" />
        ) : icon ? (
          <span className="[&>svg]:w-4 [&>svg]:h-4" dangerouslySetInnerHTML={{ __html: icon.icon }} />
        ) : (
          <span className="text-[10px] font-serif font-bold">{macro.label.charAt(0).toUpperCase()}</span>
        )}
      </button>
      {shortcutKey && <span className="absolute -top-1 -left-1 text-[8px] font-mono text-zinc-500 bg-[#0c0c0c] border border-[#2d2417] rounded px-0.5 pointer-events-none">{shortcutKey}</span>}

      <div className="absolute -top-1.5 -right-1.5 hidden group-hover:flex items-center gap-0.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          title="Editar"
          className="w-4 h-4 flex items-center justify-center rounded-full bg-[#252525] border border-[#3d3d3d] text-zinc-400 hover:text-[#d4af37] cursor-pointer"
        >
          <Pencil className="w-2.5 h-2.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          title="Apagar"
          className="w-4 h-4 flex items-center justify-center rounded-full bg-[#252525] border border-[#3d3d3d] text-zinc-400 hover:text-red-400 cursor-pointer"
        >
          <Trash2 className="w-2.5 h-2.5" />
        </button>
      </div>
    </div>
  );
};
