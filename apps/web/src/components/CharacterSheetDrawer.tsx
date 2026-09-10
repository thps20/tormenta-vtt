import React, { useEffect, useMemo, useState } from "react";
import { AlertTriangle, UserPlus } from "lucide-react";
import { computeCharacter, type Character, type CharacterPatch, type CharacterRollRequest, type CompendiumEntry, type EnhancementUse, type Participant, type SystemDefinition } from "@tormenta-vtt/shared";
import { CharacterHeader } from "./character/CharacterHeader";
import { AttributesGrid } from "./character/AttributesGrid";
import { ResourcesBlock } from "./character/ResourcesBlock";
import { DerivedStatsBar } from "./character/DerivedStatsBar";
import { SkillsSection } from "./character/SkillsSection";
import { ItemsSection } from "./character/ItemsSection";
import { ModifiersSection } from "./character/ModifiersSection";
import { DetailsSection } from "./character/DetailsSection";
import { CompendiumPalette, PALETTE_WIDTH_PX } from "./compendium/CompendiumPalette";
import { DragGhost } from "./compendium/DragGhost";
import { useCompendium } from "../store/compendium";
import { isOpenPaletteShortcut } from "../lib/compendium";
import { DROP_TARGET_ATTR, registerDropTarget } from "../lib/dropTargets";
import { isTyping } from "../lib/isTyping";
import { useMediaQuery } from "../lib/useMediaQuery";

/** Id do alvo de soltura da ficha (lib/dropTargets). */
const SHEET_DROP_TARGET = "character-sheet";

/** Largura máxima do painel da ficha (Tailwind max-w-3xl = 48rem). */
const SHEET_MAX_WIDTH_PX = 768;
/**
 * A paleta só encaixa ao lado da ficha se a janela couber as duas sem encolher a
 * ficha (768 + 384 + folga). Abaixo disso ela flutua por cima, alinhada à esquerda.
 */
const PALETTE_DOCK_QUERY = `(min-width: ${SHEET_MAX_WIDTH_PX + PALETTE_WIDTH_PX + 28}px)`;

export interface CharacterSheetDrawerProps {
  def: SystemDefinition;
  /** null = estado vazio ("você ainda não tem personagem"). */
  character: Character | null;
  participants: Participant[];
  me: Participant;
  canEdit: boolean;
  onPatch: (patch: CharacterPatch) => void;
  onRoll: (request: CharacterRollRequest) => void;
  /** Usa um item ativo (poder, magia): o servidor desconta o custo e publica o card. */
  onUseItem: (itemId: string, enhancements: EnhancementUse[]) => void;
  /** Copia uma entrada do compêndio para a ficha; devolve o id do item novo ou null. */
  onInsertFromCompendium: (entryId: string, opts?: { replace?: boolean }) => Promise<string | null>;
  /** Estado vazio: cria a ficha do próprio jogador. */
  onCreateMine: () => void;
  onClose: () => void;
}

/**
 * Ficha de personagem em gaveta lateral. Tudo que aparece vem do JSON do
 * sistema; os valores finais vêm de computeCharacter (uma vez por render).
 * Modo visualização = rolagens rápidas; modo edição = inputs.
 */
export const CharacterSheetDrawer: React.FC<CharacterSheetDrawerProps> = ({ def, character, participants, me, canEdit, onPatch, onRoll, onUseItem, onInsertFromCompendium, onCreateMine, onClose }) => {
  const [isEditMode, setIsEditMode] = useState(false);
  /** Aba de itens ativa: vive aqui para o atalho da paleta abrir já filtrado por ela. */
  const [activeItemTab, setActiveItemTab] = useState<string>(def.itemKinds[0]?.key ?? "");
  const compendiumOpen = useCompendium((s) => s.isOpen);
  const compendiumContext = useCompendium((s) => s.context);
  const openCompendium = useCompendium((s) => s.open);
  const closeCompendium = useCompendium((s) => s.close);
  const paletteDocked = useMediaQuery(PALETTE_DOCK_QUERY);
  // A paleta só faz sentido editando; se a ficha sair do modo edição (ou fechar), ela fecha junto.
  useEffect(() => {
    if (!(isEditMode && canEdit)) closeCompendium();
  }, [isEditMode, canEdit, closeCompendium]);
  useEffect(() => () => closeCompendium(), [closeCompendium]);

  // Atalho da paleta (Ctrl+Espaço, Ctrl+Shift+Espaço ou "/"): listener da janela, em fase de
  // captura, montado pelo drawer só em modo edição. Assim vale com o foco em qualquer ponto da
  // ficha (não só num input) e roda antes de outros handlers da página. preventDefault evita
  // o "busca rápida" do navegador no "/" e a rolagem/pan da página no espaço.
  const hasCharacter = character !== null;
  useEffect(() => {
    if (!(isEditMode && canEdit && hasCharacter)) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || !isOpenPaletteShortcut(e, isTyping(e.target))) return;
      e.preventDefault();
      if (!useCompendium.getState().isOpen) openCompendium("sheet", activeItemTab);
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [isEditMode, canEdit, hasCharacter, activeItemTab, openCompendium]);

  // A ficha inteira é zona de soltura para entradas do compêndio (soltar = inserir e fechar a paleta).
  const dragOverSheet = useCompendium((s) => s.drag?.targetId === SHEET_DROP_TARGET);
  const characterId = character?.id ?? null;
  useEffect(() => {
    if (!characterId || !(isEditMode && canEdit)) return;
    return registerDropTarget<CompendiumEntry>({
      id: SHEET_DROP_TARGET,
      accepts: () => true,
      onDrop: (entry) => void onInsertFromCompendium(entry.id).then((itemId) => itemId && closeCompendium()),
    });
  }, [characterId, isEditMode, canEdit, onInsertFromCompendium, closeCompendium]);
  const computed = useMemo(() => (character ? computeCharacter(def, character) : null), [def, character]);
  // Quem não pode editar nunca fica em modo edição (ex.: jogador vendo a ficha de outro).
  const editing = isEditMode && canEdit;
  const paletteOpen = compendiumOpen && compendiumContext === "sheet" && editing && character !== null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-[2px]" onClick={onClose} />

      {/* Paleta encaixada: irmã da ficha, à esquerda, ocupando espaço do backdrop (a ficha não se move). */}
      {paletteOpen && paletteDocked && character && (
        <CompendiumPalette def={def} character={character} mode="docked" onInsert={onInsertFromCompendium} onClose={closeCompendium} />
      )}
      {paletteOpen && <DragGhost def={def} />}

      <div
        id="character-sheet-drawer"
        className="relative z-10 w-full max-w-3xl h-full bg-[#0c0c0c] border-l border-[#3a3022] shadow-[0_0_40px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden text-zinc-100 select-text drawer-slide-in"
      >
        {character && computed ? (
          <>
            <div
              className={`flex-1 overflow-y-auto transition-shadow ${dragOverSheet ? "shadow-[inset_0_0_0_3px_rgba(212,175,55,0.9),inset_0_0_40px_rgba(212,175,55,0.25)]" : ""}`}
              {...{ [DROP_TARGET_ATTR]: SHEET_DROP_TARGET }}
            >
              <CharacterHeader
                def={def}
                character={character}
                computed={computed}
                participants={participants}
                me={me}
                canEdit={canEdit}
                isEditMode={editing}
                onToggleEditMode={() => setIsEditMode((v) => !v)}
                onPatch={onPatch}
                onClose={onClose}
              />

              {computed.warnings.length > 0 && (
                <div className="px-4 py-1.5 bg-red-950/30 border-b border-red-900/40 text-[11px] text-red-300 flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>{computed.warnings.join(" • ")}</span>
                </div>
              )}

              <AttributesGrid def={def} character={character} computed={computed} canEdit={canEdit} isEditMode={editing} onPatch={onPatch} onRoll={onRoll} />
              <ResourcesBlock def={def} character={character} computed={computed} canEdit={canEdit} isEditMode={editing} onPatch={onPatch} />
              <DerivedStatsBar def={def} character={character} computed={computed} canEdit={canEdit} isEditMode={editing} onPatch={onPatch} onRoll={onRoll} />
              <SkillsSection def={def} character={character} computed={computed} canEdit={canEdit} isEditMode={editing} onPatch={onPatch} onRoll={onRoll} />
              <ItemsSection
                def={def}
                character={character}
                computed={computed}
                canEdit={canEdit}
                isEditMode={editing}
                onPatch={onPatch}
                onRoll={onRoll}
                onUseItem={onUseItem}
                activeTab={activeItemTab}
                onActiveTabChange={setActiveItemTab}
              />
              <ModifiersSection def={def} character={character} computed={computed} canEdit={canEdit} onPatch={onPatch} />
              <DetailsSection def={def} character={character} isEditMode={editing} onPatch={onPatch} />
            </div>

            <div className="bg-[#090909] border-t border-[#231d16] px-4 py-2 flex items-center justify-between text-[11px] text-zinc-500 font-serif">
              <span>
                Sistema: {def.name} v{def.version}
              </span>
              <span>{editing ? "Modo edição" : canEdit ? "Modo visualização (clique para rolar)" : "Somente leitura"}</span>
            </div>

            {/* Janela estreita: a paleta flutua por cima da ficha, alinhada à esquerda. */}
            {paletteOpen && !paletteDocked && (
              <CompendiumPalette def={def} character={character} mode="floating" onInsert={onInsertFromCompendium} onClose={closeCompendium} />
            )}
          </>
        ) : (
          <EmptyState onCreate={onCreateMine} onClose={onClose} />
        )}
      </div>
    </div>
  );
};

/** Jogador sem ficha: convite para criar a sua. */
const EmptyState: React.FC<{ onCreate: () => void; onClose: () => void }> = ({ onCreate, onClose }) => (
  <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center" id="character-sheet-empty">
    <div className="w-20 h-20 rounded-full bg-[#1e1912] border-2 border-[#d4af37]/40 flex items-center justify-center">
      <UserPlus className="w-9 h-9 text-[#d4af37]" />
    </div>
    <div>
      <h2 className="text-lg font-serif font-bold text-[#d4af37]">Você ainda não tem um personagem</h2>
      <p className="text-xs text-zinc-400 font-serif mt-1 max-w-xs">Crie a sua ficha para rolar atributos, perícias e ataques direto da mesa. Você poderá editar tudo depois.</p>
    </div>
    <button
      id="btn-create-my-character"
      onClick={onCreate}
      className="flex items-center gap-2 px-4 py-2 rounded bg-[#d4af37] text-zinc-950 font-serif font-bold text-sm hover:bg-amber-300 transition-colors cursor-pointer shadow-[0_0_14px_rgba(212,175,55,0.3)]"
    >
      <UserPlus className="w-4 h-4" />
      Criar personagem
    </button>
    <button onClick={onClose} className="text-xs text-zinc-500 hover:text-zinc-300 underline cursor-pointer">
      Agora não
    </button>
  </div>
);
