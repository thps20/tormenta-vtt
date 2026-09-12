import React, { useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  CompendiumItemBodySchema,
  characterItemToCompendiumBody,
  computeCharacter,
  createDefaultCharacterData,
  creatureSheetFromCharacterData,
  entryToCharacter,
  entryToItem,
  validateCompendiumEntry,
  type Character,
  type CharacterPatch,
  type CompendiumEntry,
  type RoomCompendiumEntryInput,
  type SystemDefinition,
} from "@tormenta-vtt/shared";
import { newId } from "../../lib/ids";
import { useCompendium } from "../../store/compendium";
import { toast } from "../../store/ui";
import { Dialog } from "../Dialog";
import { AttributesGrid } from "../character/AttributesGrid";
import { ResourcesBlock } from "../character/ResourcesBlock";
import { DerivedStatsBar } from "../character/DerivedStatsBar";
import { SkillsSection } from "../character/SkillsSection";
import { ItemsSection } from "../character/ItemsSection";
import { ModifiersSection } from "../character/ModifiersSection";

/** Nunca é enviado nem lido de volta: só existe pra satisfazer o tipo `Character` das seções da ficha. */
const DRAFT_ID = "compendium-room-editor-draft";
const noop = () => {};

/** Ficha de personagem de mentira, nunca persistida: só a moldura pra reaproveitar as seções. */
function blankDraft(kind: "pc" | "npc"): Omit<Character, keyof ReturnType<typeof createDefaultCharacterData>> {
  return { id: DRAFT_ID, roomId: "", ownerId: null, name: "", kind, createdAt: "", updatedAt: "" };
}

export interface RoomEntryEditorProps {
  def: SystemDefinition;
  /** "creature", ou a chave de um itemKinds[] do sistema — decide que seções aparecem. */
  kind: "creature" | string;
  /** Ponto de partida do rascunho: "Duplicar"/"Editar" começam de uma entrada (do sistema ou da
   *  própria sala); "Novo" começa vazio (null). */
  sourceEntry: CompendiumEntry | null;
  /** Preenchido = ESTÁ editando esta entrada da sala (Salvar manda room-update, id não muda); null =
   *  criando uma nova a partir daqui — "Novo" ou "Duplicar" (Salvar manda room-create). */
  editingEntryId: string | null;
  onClose: () => void;
}

/**
 * Editor de uma entrada homebrew da sala (docs/plano-compendio-sala.md): reaproveita as MESMAS
 * seções da ficha de personagem (ItemsSection e, pra criatura, a ficha inteira) contra uma "ficha de
 * mentira" só em memória — nada de formulário novo. `onPatch` não emite socket algum: só atualiza o
 * rascunho local; a conversão pro formato do compêndio (characterItemToCompendiumBody/
 * creatureSheetFromCharacterData, o inverso de entryToItem/entryToCharacter) acontece só ao salvar.
 */
export const RoomEntryEditor: React.FC<RoomEntryEditorProps> = ({ def, kind, sourceEntry, editingEntryId, onClose }) => {
  const isCreature = kind === "creature";

  const kindLabel = def.itemKinds.find((k) => k.key === kind)?.label ?? kind;

  // Rascunho inicial: entryToItem/entryToCharacter (as MESMAS funções que soltar/inserir usam) já
  // preenchem os defaults do sistema pra campos ausentes — "Novo" e "Duplicar" ganham o tratamento
  // de graça, só variando o que se passa como sourceEntry (null vira uma entrada em branco).
  const [draft, setDraft] = useState<Character>(() => {
    if (isCreature) {
      if (sourceEntry?.type === "creature") {
        const { name, data } = entryToCharacter(def, sourceEntry, newId);
        return { ...blankDraft("npc"), name, ...data };
      }
      return { ...blankDraft("npc"), name: "Nova criatura", ...createDefaultCharacterData(def) };
    }
    if (sourceEntry?.type === "item") {
      const item = entryToItem(def, sourceEntry, newId);
      return { ...blankDraft("npc"), name: item.name, ...createDefaultCharacterData(def), items: [item] };
    }
    const item = entryToItem(def, CompendiumItemBodySchema.parse({ kind, name: `Novo ${kindLabel.toLowerCase()}` }), newId);
    return { ...blankDraft("npc"), name: item.name, ...createDefaultCharacterData(def), items: [item] };
  });
  const [tags, setTags] = useState((sourceEntry?.tags ?? []).join(", "));
  // Só a criatura precisa: description/page do item já vivem dentro do item (ItemCard cuida deles).
  const [description, setDescription] = useState(sourceEntry?.type === "creature" ? sourceEntry.description : "");
  const [page, setPage] = useState<string>(sourceEntry?.type === "creature" && sourceEntry.page !== null ? String(sourceEntry.page) : "");
  const [activeTab, setActiveTab] = useState<string>(isCreature ? (def.itemKinds[0]?.key ?? "") : kind);
  const [busy, setBusy] = useState(false);

  const sectionDef = useMemo<SystemDefinition>(() => (isCreature ? def : { ...def, itemKinds: def.itemKinds.filter((k) => k.key === kind) }), [def, isCreature, kind]);
  const computed = useMemo(() => computeCharacter(sectionDef, draft), [sectionDef, draft]);

  const onPatch = (patch: CharacterPatch) => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      // Uma entrada de item é UM item só: se a ficha (ItemsSection) deixar adicionar um segundo,
      // fica só o mais recente — evita salvar um item "fantasma" que ninguém vê no editor.
      if (!isCreature && patch.items && patch.items.length > 1) next.items = patch.items.slice(-1);
      return next;
    });
  };

  const buildEntryInput = (): RoomCompendiumEntryInput | null => {
    if (isCreature) {
      return { type: "creature", name: draft.name, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), description, page: page.trim() ? Number(page) : null, sheet: creatureSheetFromCharacterData(draft) };
    }
    const item = draft.items[0];
    if (!item) return null;
    return { type: "item", tags: tags.split(",").map((t) => t.trim()).filter(Boolean), ...characterItemToCompendiumBody(item) };
  };

  const save = async () => {
    const entry = buildEntryInput();
    if (!entry) {
      toast("A entrada precisa ter o item preenchido");
      return;
    }
    // Mesma checagem que o servidor vai fazer (validateCompendiumEntry): mostra o erro sem gastar
    // uma emissão de socket. O id aqui é só um placeholder pra validação — o de verdade nasce (ou
    // já existe) no servidor.
    const err = validateCompendiumEntry(def, { ...entry, id: editingEntryId ?? "rascunho" } as CompendiumEntry);
    if (err) {
      toast(err);
      return;
    }
    setBusy(true);
    const saved = await useCompendium.getState().saveRoomEntry(editingEntryId, entry);
    setBusy(false);
    if (saved) onClose();
  };

  const title = editingEntryId ? `Editar "${draft.name || "sem nome"}"` : sourceEntry ? `Duplicar "${sourceEntry.name}" para a sala` : isCreature ? "Nova criatura da sala" : `Novo ${kindLabel.toLowerCase()} da sala`;

  return (
    <Dialog onClose={onClose} ariaLabel={title} maxWidthClassName="max-w-xl">
      <div className="contents">
        <div className="shrink-0 flex items-start justify-between gap-2 p-3 border-b border-[#2d2417]">
          <div className="text-sm font-serif font-bold text-amber-200">{title}</div>
          <button id="room-entry-close" onClick={onClose} className="p-1 rounded text-zinc-500 hover:text-zinc-200 cursor-pointer shrink-0" title="Cancelar (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Metadados de compêndio, sem seção equivalente na ficha (nome de criatura, tags, e — só
              criatura — descrição/página; item já tem os dois dentro do próprio ItemCard). */}
          <div className="p-3 space-y-1.5 border-b border-[#2d2417]">
            {isCreature && (
              <input
                id="room-entry-name"
                autoFocus
                value={draft.name}
                onChange={(e) => onPatch({ name: e.target.value })}
                placeholder="Nome da criatura"
                className="w-full bg-[#141210] border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#d4af37]"
              />
            )}
            <input
              id="room-entry-tags"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Tags (separadas por vírgula)"
              className="w-full bg-[#141210] border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#d4af37]"
            />
            {isCreature && (
              <>
                <textarea
                  id="room-entry-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Descrição (opcional)"
                  rows={2}
                  className="w-full bg-[#141210] border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-[#d4af37]"
                />
                <input
                  id="room-entry-page"
                  value={page}
                  onChange={(e) => setPage(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="Página do livro (opcional)"
                  className="w-32 bg-[#141210] border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#d4af37]"
                />
              </>
            )}
          </div>

          {isCreature && (
            <>
              <AttributesGrid def={sectionDef} character={draft} computed={computed} canEdit isEditMode onPatch={onPatch} onRoll={noop} />
              <ResourcesBlock def={sectionDef} character={draft} computed={computed} canEdit isEditMode onPatch={onPatch} />
              <DerivedStatsBar def={sectionDef} character={draft} computed={computed} canEdit isEditMode onPatch={onPatch} onRoll={noop} />
              <SkillsSection def={sectionDef} character={draft} computed={computed} canEdit isEditMode onPatch={onPatch} onRoll={noop} />
            </>
          )}
          <ItemsSection
            def={sectionDef}
            character={draft}
            computed={computed}
            canEdit
            isEditMode
            onPatch={onPatch}
            onRoll={noop}
            onUseItem={noop}
            activeTab={activeTab}
            onActiveTabChange={setActiveTab}
            hideCompendiumButton
          />
          {isCreature && <ModifiersSection def={sectionDef} character={draft} computed={computed} canEdit onPatch={onPatch} />}
        </div>

        <div className="shrink-0 flex items-center justify-end gap-2 p-3 border-t border-[#2d2417] bg-[#0b0a09]">
          <button id="room-entry-cancel" onClick={onClose} className="px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer">
            Cancelar
          </button>
          <button
            id="room-entry-save"
            onClick={() => void save()}
            disabled={busy}
            className="px-3 py-1.5 rounded bg-[#d4af37] text-zinc-950 font-serif font-bold text-xs hover:bg-amber-300 transition-colors cursor-pointer disabled:opacity-50"
          >
            Salvar
          </button>
        </div>
      </div>
    </Dialog>
  );
};
