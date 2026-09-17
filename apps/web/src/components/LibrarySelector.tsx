import React from "react";
import { Library } from "lucide-react";
import { LibraryDialog, type LibraryDialogProps } from "./LibraryDialog";
import { MOTION } from "./MapBar";

interface LibrarySelectorProps {
  /** Repassadas direto pro `LibraryDialog`, exceto `isOpen`/`onClose` (este componente decide). */
  dialog: Omit<LibraryDialogProps, "isOpen" | "onClose">;
  /** Diálogo aberto: controlado pela RoomPage, dona do atalho B (`useGmPanelShortcuts`). */
  open: boolean;
  /** Abrir (true) ou fechar (false). Quem abre também dispara `asset:list`/`library:favorites`. */
  onOpenChange: (open: boolean) => void;
}

/**
 * Botão do Acervo na TopBar (só GM, docs/plano-preparo.md §1.5): tecla solta **B** (fora de campo
 * de texto — `Ctrl+B` já é "recolher painel lateral", mas B pura está livre; listener da página,
 * `useGmPanelShortcuts`) ou clique abrem/fecham
 * o diálogo. Esc e clique fora fecham (o `Dialog` de dentro já cuida disso).
 */
export const LibrarySelector: React.FC<LibrarySelectorProps> = ({ dialog, open, onOpenChange }) => {
  const setOpen = onOpenChange;

  /** "Editar" de criatura/macro navega pra outra tela — fecha o diálogo primeiro (mesma conta de
   *  `HandoutSelector#handleShow`), senão ficaria por cima da paleta/editor que abre. */
  const handleOpenCreature = () => {
    setOpen(false);
    dialog.onOpenCreature();
  };
  const handleOpenMacro = (macroId: string) => {
    setOpen(false);
    dialog.onOpenMacro(macroId);
  };

  return (
    <>
      <button
        id="btn-library-selector"
        onClick={() => setOpen(!open)}
        title="Acervo da sala (B)"
        className={`focus-ring flex items-center gap-1.5 h-7 px-2 rounded-ui text-13 text-text hover:bg-surface-2 cursor-pointer ${MOTION}`}
      >
        <Library className="w-3.5 h-3.5 shrink-0 text-text-muted" />
        <span>Acervo</span>
      </button>

      <LibraryDialog isOpen={open} onClose={() => setOpen(false)} {...dialog} onOpenCreature={handleOpenCreature} onOpenMacro={handleOpenMacro} />
    </>
  );
};
