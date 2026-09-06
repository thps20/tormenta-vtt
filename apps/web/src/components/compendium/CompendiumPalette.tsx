import React, { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, Plus, Search, X } from "lucide-react";
import { type Character, type CompendiumEntry, type SystemDefinition } from "@tormenta-vtt/shared";
import { checkInsert, matchesQuery, type InsertCheck } from "../../lib/compendium";
import { useCompendium } from "../../store/compendium";
import { kindIcon } from "../character/kindIcons";
import { EntryPreview } from "./EntryPreview";

export interface CompendiumPaletteProps {
  def: SystemDefinition;
  character: Character;
  /** Única porta de inserção (Enter, "+" e soltar). Devolve o id do item novo ou null. */
  onInsert: (entryId: string, opts?: { replace?: boolean }) => Promise<string | null>;
  onClose: () => void;
}

/** Entrada + resultado de checkInsert, calculado uma vez por render da lista. */
export interface PaletteRow {
  entry: CompendiumEntry;
  check: InsertCheck;
}

/**
 * Paleta de comandos do compêndio: flutua por cima da ficha (não é outra tela).
 * Busca com foco automático, chips por tipo (itemKinds[] do sistema), resultados
 * agrupados por tipo, preview à direita e teclado: setas, Enter (insere e fecha),
 * Ctrl+Enter (insere e mantém), Esc (fecha).
 */
export const CompendiumPalette: React.FC<CompendiumPaletteProps> = ({ def, character, onInsert, onClose }) => {
  const entries = useCompendium((s) => s.entries);
  const status = useCompendium((s) => s.status);
  const initialKind = useCompendium((s) => s.initialKind);

  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<Set<string>>(() => new Set(initialKind ? [initialKind] : []));
  const [focused, setFocused] = useState(0);
  const [justInserted, setJustInserted] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  // Linhas visíveis, agrupadas na ordem de itemKinds[] (uma lista plana para o teclado).
  const groups = useMemo(() => {
    const visible = entries.filter((e) => (kinds.size === 0 || kinds.has(e.kind)) && matchesQuery(e, query));
    return def.itemKinds
      .map((kind, index) => ({
        kind,
        Icon: kindIcon(index),
        rows: visible
          .filter((e) => e.kind === kind.key)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((entry): PaletteRow => ({ entry, check: checkInsert(def, character, entry) })),
      }))
      .filter((g) => g.rows.length > 0);
  }, [def, character, entries, kinds, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const current = flat[Math.min(focused, Math.max(0, flat.length - 1))] ?? null;

  // Mudou a busca/filtro: volta o foco para o primeiro resultado.
  useEffect(() => setFocused(0), [query, kinds]);
  // Mantém a linha focada à vista ao navegar com as setas.
  useEffect(() => {
    if (!current) return;
    listRef.current?.querySelector<HTMLElement>(`[data-entry-id="${current.entry.id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const insert = async (row: PaletteRow, keepOpen: boolean, replace = false) => {
    if (!row.check.ok && !(replace && row.check.replaces)) return;
    const itemId = await onInsert(row.entry.id, { replace });
    if (!itemId) return;
    if (!keepOpen) {
      onClose();
      return;
    }
    setJustInserted(row.entry.id);
    inputRef.current?.focus();
  };
  useEffect(() => {
    if (!justInserted) return;
    const t = setTimeout(() => setJustInserted(null), 1500);
    return () => clearTimeout(t);
  }, [justInserted]);

  const toggleKind = (key: string) =>
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocused((i) => Math.min(i + 1, Math.max(0, flat.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocused((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && current) {
      e.preventDefault();
      void insert(current, e.ctrlKey || e.metaKey);
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex items-start justify-center pt-10 px-4 bg-black/60 backdrop-blur-[1px]" onPointerDown={onClose} id="compendium-palette">
      <div
        role="dialog"
        aria-label="Compêndio"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="w-full max-w-2xl max-h-[80%] bg-[#0f0e0c] border border-[#3a3022] rounded-lg shadow-[0_0_40px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden"
      >
        {/* Busca + chips */}
        <div className="p-3 border-b border-[#2d2417] space-y-2">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-[#d4af37] shrink-0" />
            <input
              ref={inputRef}
              id="compendium-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar no compêndio…"
              className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            />
            <kbd className="text-[10px] text-zinc-500 border border-zinc-700 rounded px-1 font-mono">Esc</kbd>
            <button onClick={onClose} className="p-1 rounded text-zinc-500 hover:text-zinc-200 cursor-pointer" title="Fechar">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {def.itemKinds.map((kind, index) => {
              const Icon = kindIcon(index);
              const active = kinds.has(kind.key);
              const count = entries.filter((e) => e.kind === kind.key).length;
              return (
                <button
                  key={kind.key}
                  id={`compendium-chip-${kind.key}`}
                  onClick={() => toggleKind(kind.key)}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-serif transition-colors cursor-pointer ${
                    active ? "bg-[#2d2417] border-[#d4af37] text-[#d4af37] font-bold" : "bg-[#141414] border-zinc-700 text-zinc-400 hover:border-zinc-500"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {kind.label}
                  <span className="font-mono text-[9px] opacity-70">{count}</span>
                </button>
              );
            })}
            {kinds.size > 0 && (
              <button onClick={() => setKinds(new Set())} className="text-[10px] text-zinc-500 hover:text-zinc-300 underline cursor-pointer ml-1">
                todos
              </button>
            )}
          </div>
        </div>

        {/* Resultados + preview */}
        <div className="flex-1 min-h-0 flex">
          <div ref={listRef} className="flex-1 min-w-0 overflow-y-auto py-1" onPointerDown={() => inputRef.current?.focus()}>
            {status === "loading" && <div className="p-4 text-xs text-zinc-500 font-serif">Carregando compêndio…</div>}
            {status === "error" && <div className="p-4 text-xs text-red-300 font-serif">Não foi possível carregar o compêndio.</div>}
            {status === "ready" && flat.length === 0 && <div className="p-4 text-xs text-zinc-500 font-serif">Nada encontrado.</div>}
            {groups.map(({ kind, Icon, rows }) => (
              <div key={kind.key} className="mb-1">
                <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-widest text-zinc-500 font-serif">
                  <Icon className="w-3 h-3" /> {kind.label}
                </div>
                {rows.map((row) => (
                  <PaletteRowView
                    key={row.entry.id}
                    row={row}
                    focused={current?.entry.id === row.entry.id}
                    inserted={justInserted === row.entry.id}
                    onFocus={() => setFocused(flat.indexOf(row))}
                    onInsert={() => void insert(row, true)}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="w-64 shrink-0 border-l border-[#2d2417] overflow-y-auto bg-[#0b0a09]">
            {current ? (
              <EntryPreview def={def} row={current} onReplace={() => void insert(current, false, true)} />
            ) : (
              <div className="p-4 text-xs text-zinc-600 font-serif flex flex-col items-center gap-2 text-center">
                <BookOpen className="w-6 h-6" />
                Selecione uma entrada para ver o resumo.
              </div>
            )}
          </div>
        </div>

        <div className="px-3 py-1.5 border-t border-[#2d2417] text-[10px] text-zinc-500 font-serif flex items-center gap-3 flex-wrap">
          <span><kbd className="font-mono">↑↓</kbd> navegar</span>
          <span><kbd className="font-mono">Enter</kbd> inserir</span>
          <span><kbd className="font-mono">Ctrl+Enter</kbd> inserir e continuar</span>
          <span><kbd className="font-mono">Esc</kbd> fechar</span>
        </div>
      </div>
    </div>
  );
};

interface PaletteRowViewProps {
  row: PaletteRow;
  focused: boolean;
  inserted: boolean;
  onFocus: () => void;
  onInsert: () => void;
}

const PaletteRowView: React.FC<PaletteRowViewProps> = ({ row, focused, inserted, onFocus, onInsert }) => {
  const { entry, check } = row;
  return (
    <div
      data-entry-id={entry.id}
      onPointerEnter={onFocus}
      onClick={onFocus}
      onDoubleClick={() => check.ok && onInsert()}
      className={`group flex items-center gap-2 mx-1 px-2 py-1.5 rounded cursor-pointer transition-colors ${
        focused ? "bg-[#1e1a14] ring-1 ring-[#d4af37]/60" : "hover:bg-[#161412]"
      } ${check.ok ? "" : "opacity-50"}`}
    >
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-serif truncate ${check.ok ? "text-zinc-100" : "text-zinc-400"}`}>{entry.name}</div>
        {entry.tags.length > 0 && <div className="text-[10px] text-zinc-500 truncate">{entry.tags.join(" · ")}</div>}
      </div>
      {inserted ? (
        <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-serif"><Check className="w-3.5 h-3.5" /> inserido</span>
      ) : (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onInsert();
          }}
          disabled={!check.ok}
          title={check.ok ? "Inserir na ficha (mantém a paleta aberta)" : (check.reason ?? "")}
          className={`p-1 rounded border border-[#d4af37]/50 text-[#d4af37] hover:bg-[#2d2417] transition-opacity cursor-pointer disabled:cursor-not-allowed ${
            focused ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
