import React from "react";
import { Copy, Pencil, Trash2 } from "lucide-react";

/**
 * Ações de homebrew da sala (docs/plano-compendio-sala.md, §9.18) no preview de uma entrada:
 * entrada do SISTEMA ganha "Duplicar para a sala" (o caminho principal — parte de um goblin, muda o
 * que quiser, salva como "Goblin veterano"); entrada já da SALA ganha "Editar"/"Apagar" no lugar.
 * Compartilhado entre EntryPreview (item) e CreaturePreview (criatura) — só GM, e só quando a
 * paleta está num contexto onde faz sentido editar (ver CompendiumPalette).
 */
export interface RoomEntryActions {
  isRoomEntry: boolean;
  onDuplicate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const btn = "flex items-center gap-1 px-2 py-1 rounded border text-[10px] font-serif cursor-pointer transition-colors";
const neutral = `${btn} bg-[#141414] border-zinc-700 text-zinc-300 hover:border-[#d4af37] hover:text-[#d4af37]`;
const danger = `${btn} bg-[#141414] border-zinc-700 text-zinc-300 hover:border-red-700 hover:text-red-300`;

export const RoomEntryActionsRow: React.FC<{ actions: RoomEntryActions }> = ({ actions }) =>
  actions.isRoomEntry ? (
    <div className="flex items-center gap-1.5">
      <button id="room-entry-edit" onClick={actions.onEdit} className={neutral}>
        <Pencil className="w-3 h-3" /> Editar
      </button>
      <button id="room-entry-delete" onClick={actions.onDelete} className={danger}>
        <Trash2 className="w-3 h-3" /> Apagar
      </button>
    </div>
  ) : (
    <div className="flex items-center gap-1.5">
      <button id="room-entry-duplicate" onClick={actions.onDuplicate} className={neutral}>
        <Copy className="w-3 h-3" /> Duplicar para a sala
      </button>
    </div>
  );
