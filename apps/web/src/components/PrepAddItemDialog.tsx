import React, { useState } from "react";
import { X } from "lucide-react";
import type { Character, CompendiumEntry, LibraryItem, Pin, PrepRef } from "@tormenta-vtt/shared";

type Tab = "library" | "creature" | "pin" | "npc" | "note";

const TABS: { id: Tab; label: string }[] = [
  { id: "library", label: "Acervo" },
  { id: "creature", label: "Criaturas" },
  { id: "pin", label: "Pinos" },
  { id: "npc", label: "NPCs" },
  { id: "note", label: "Lembrete" },
];

/** Nome de exibição de um pino (§2.7 "+ Item"): pino de nota usa o título, pino de handout usa o
 *  nome denormalizado (mesmo campo que o cartão do chat já usa). */
function pinLabel(pin: Pin): string {
  return pin.kind === "note" ? pin.title : pin.name;
}

/**
 * "+ Item" (docs/plano-preparo.md §2.7): busca sobre o acervo inteiro (menos criatura — a aba
 * "Criaturas" já cobre TODAS, sistema e homebrew, sem duplicar) + pinos do mapa atual + NPCs +
 * "Lembrete" (texto solto, sem referência). Cada resultado vira um `PrepRef` ao clicar.
 */
export const PrepAddItemDialog: React.FC<{
  libraryItems: LibraryItem[];
  allCreatures: CompendiumEntry[];
  pins: Pin[];
  npcs: Character[];
  onAdd: (ref: PrepRef) => void;
  onClose: () => void;
}> = ({ libraryItems, allCreatures, pins, npcs, onAdd, onClose }) => {
  const [tab, setTab] = useState<Tab>("library");
  const [query, setQuery] = useState("");
  const [noteText, setNoteText] = useState("");
  const q = query.trim().toLowerCase();

  const libraryResults = libraryItems.filter((i) => i.kind !== "creature" && (q === "" || i.name.toLowerCase().includes(q)));
  const creatureResults = allCreatures.filter((e) => q === "" || e.name.toLowerCase().includes(q));
  const pinResults = pins.filter((p) => q === "" || pinLabel(p).toLowerCase().includes(q));
  const npcResults = npcs.filter((c) => q === "" || c.name.toLowerCase().includes(q));

  const refOfLibraryItem = (item: LibraryItem): PrepRef | null => {
    switch (item.kind) {
      case "asset":
        return { kind: "asset", assetId: item.asset.id };
      case "handout":
        return { kind: "handout", handoutId: item.handout.id };
      case "encounter":
        return { kind: "encounter", encounterId: item.encounter.id };
      case "macro":
        return { kind: "macro", macroId: item.macro.id };
      default:
        return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="font-ui w-[420px] max-h-[70vh] bg-surface-1 border border-border rounded-ui shadow-float flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
          <h3 className="font-title font-bold text-sm text-text">Adicionar item</h3>
          <button onClick={onClose} className="focus-ring p-1 rounded-ui text-text-muted hover:text-text hover:bg-surface-2 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex border-b border-border shrink-0 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`focus-ring px-3 py-1.5 text-xs font-title font-bold uppercase tracking-wide whitespace-nowrap cursor-pointer ${
                tab === t.id ? "border-b-2 border-accent text-accent" : "text-text-muted hover:text-text"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "note" ? (
          <div className="p-3 flex flex-col gap-2">
            <textarea
              autoFocus
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Lembrete solto, sem referência..."
              className="focus-ring w-full h-24 resize-none rounded-ui border border-border bg-surface-2 px-2 py-1.5 text-sm text-text"
            />
            <button
              disabled={noteText.trim() === ""}
              onClick={() => {
                if (noteText.trim() === "") return;
                onAdd({ kind: "note", text: noteText.trim() });
                onClose();
              }}
              className="focus-ring self-end px-3 py-1.5 rounded-ui bg-accent text-bg text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              Adicionar
            </button>
          </div>
        ) : (
          <>
            <div className="p-2 border-b border-border shrink-0">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nome..."
                className="focus-ring w-full rounded-ui border border-border bg-surface-2 px-2 py-1.5 text-sm text-text"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-1">
              {tab === "library" &&
                (libraryResults.length === 0 ? (
                  <p className="p-2 text-xs text-text-muted">Nada encontrado.</p>
                ) : (
                  libraryResults.map((item) => (
                    <button
                      key={`${item.kind}-${item.id}`}
                      onClick={() => {
                        const ref = refOfLibraryItem(item);
                        if (ref) {
                          onAdd(ref);
                          onClose();
                        }
                      }}
                      className="focus-ring w-full text-left px-2 py-1.5 rounded-ui text-sm text-text hover:bg-surface-2 cursor-pointer flex items-center justify-between"
                    >
                      <span className="truncate">{item.name}</span>
                      <span className="text-[10px] text-text-muted uppercase">{item.kind}</span>
                    </button>
                  ))
                ))}
              {tab === "creature" &&
                (creatureResults.length === 0 ? (
                  <p className="p-2 text-xs text-text-muted">Nada encontrado.</p>
                ) : (
                  creatureResults.map((entry) => (
                    <button
                      key={entry.id}
                      onClick={() => {
                        onAdd({ kind: "creature", entryId: entry.id });
                        onClose();
                      }}
                      className="focus-ring w-full text-left px-2 py-1.5 rounded-ui text-sm text-text hover:bg-surface-2 cursor-pointer"
                    >
                      {entry.name}
                    </button>
                  ))
                ))}
              {tab === "pin" &&
                (pinResults.length === 0 ? (
                  <p className="p-2 text-xs text-text-muted">Nenhum pino neste mapa.</p>
                ) : (
                  pinResults.map((pin) => (
                    <button
                      key={pin.id}
                      onClick={() => {
                        onAdd({ kind: "pin", pinId: pin.id });
                        onClose();
                      }}
                      className="focus-ring w-full text-left px-2 py-1.5 rounded-ui text-sm text-text hover:bg-surface-2 cursor-pointer"
                    >
                      {pinLabel(pin)}
                    </button>
                  ))
                ))}
              {tab === "npc" &&
                (npcResults.length === 0 ? (
                  <p className="p-2 text-xs text-text-muted">Nenhum NPC na sala.</p>
                ) : (
                  npcResults.map((npc) => (
                    <button
                      key={npc.id}
                      onClick={() => {
                        onAdd({ kind: "npc", characterId: npc.id });
                        onClose();
                      }}
                      className="focus-ring w-full text-left px-2 py-1.5 rounded-ui text-sm text-text hover:bg-surface-2 cursor-pointer"
                    >
                      {npc.name}
                    </button>
                  ))
                ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
