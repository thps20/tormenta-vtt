import React, { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, Plus, Search, X } from "lucide-react";
import { type Character, type CompendiumCreatureEntry, type CompendiumItemEntry, type SystemDefinition } from "@tormenta-vtt/shared";
import { checkInsert, matchesQuery, CREATURE_FILTER, ROOM_FILTER, type InsertCheck } from "../../lib/compendium";
import { useCompendium } from "../../store/compendium";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { creatureIcon, kindIcon } from "../character/kindIcons";
import { EntryPreview } from "./EntryPreview";
import { CreaturePreview } from "./CreaturePreview";
import { useCompendiumDrag } from "./DragGhost";

/**
 * "docked": painel lateral encaixado à esquerda da ficha (irmão dela no drawer).
 * "floating": overlay por cima da ficha, alinhado à esquerda (telas estreitas).
 * "map": flutuante à esquerda da ÁREA DO MAPA, sem escurecer o resto — o mapa continua visível e
 * utilizável (é o alvo da soltura de criaturas, ver docs/plano-criaturas.md §2.2).
 */
export type PaletteMode = "docked" | "floating" | "map";

/** Largura da paleta (Tailwind w-96). O drawer usa este valor para decidir o modo. */
export const PALETTE_WIDTH_PX = 384;

export interface CompendiumPaletteProps {
  def: SystemDefinition;
  /** null no contexto "map" sem ficha aberta: itens ficam só de consulta (sem inserir). */
  character: Character | null;
  mode: PaletteMode;
  /** Única porta de inserção pra ficha (Enter, "+" e soltar). Ausente/ignorado fora do contexto "sheet". */
  onInsert?: (entryId: string, opts?: { replace?: boolean }) => Promise<string | null>;
  /** Solta N cópias de uma criatura no mapa (Enter/botão no preview). Ausente/ignorado fora do contexto "map". */
  onSpawnCreature?: (entryId: string, opts: { count: number; visible: boolean }) => Promise<boolean>;
  onClose: () => void;
}

/** Uma linha de item, com o resultado de checkInsert (null = sem ficha aberta: só consulta). */
export interface ItemPaletteRow {
  kind: "item";
  entry: CompendiumItemEntry;
  check: InsertCheck;
}
/** Uma linha de criatura: sem checkInsert (não se insere na ficha; solta no mapa, passo 9). */
interface CreaturePaletteRow {
  kind: "creature";
  entry: CompendiumCreatureEntry;
}
export type PaletteRow = ItemPaletteRow | CreaturePaletteRow;

const NO_SHEET_CHECK: InsertCheck = { ok: false, reason: null, replaces: null };

/**
 * Paleta de comandos do compêndio, sempre em coluna: busca com foco automático,
 * chips por tipo (itemKinds[] do sistema, mais "Criaturas" e "Sala" quando fizer sentido),
 * resultados agrupados, preview abaixo da lista (ou em aba "Detalhes" quando a janela é baixa) e
 * teclado: setas, Enter, Ctrl+Enter, Esc. O invólucro muda com `mode`.
 *
 * O CONTEÚDO muda com `context` (da store, definido em quem chamou `open`): "sheet" só lista/insere
 * itens (comportamento de sempre); "map" lista itens (só consulta, sem `character`) e, se houver,
 * criaturas — que o GM solta no mapa (fantasma e evento chegam nos passos 8/9).
 */
export const CompendiumPalette: React.FC<CompendiumPaletteProps> = ({ def, character, mode, onInsert, onSpawnCreature, onClose }) => {
  const entries = useCompendium((s) => s.entries);
  const roomIds = useCompendium((s) => s.roomIds);
  const status = useCompendium((s) => s.status);
  const context = useCompendium((s) => s.context);
  const initialKind = useCompendium((s) => s.initialKind);

  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<Set<string>>(() => new Set(initialKind ? [initialKind] : []));
  const [focused, setFocused] = useState(0);
  const [justInserted, setJustInserted] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragging = useCompendium((s) => s.drag !== null);
  const { onRowPointerDown } = useCompendiumDrag();
  // Janela baixa: lista e preview viram abas para a lista não ficar com meia dúzia de linhas.
  const short = useMediaQuery("(max-height: 640px)");
  const [pane, setPane] = useState<"list" | "preview">("list");

  useEffect(() => inputRef.current?.focus(), []);

  const items = useMemo(() => entries.filter((e): e is CompendiumItemEntry => e.type === "item"), [entries]);
  // Só aparecem no contexto "map" (o servidor já nem manda pra jogador — ver compendium:list).
  const creatureEntries = useMemo(
    () => (context === "map" ? entries.filter((e): e is CompendiumCreatureEntry => e.type === "creature") : []),
    [context, entries],
  );

  // Linhas visíveis, agrupadas: Criaturas primeiro (quando há alguma), depois itemKinds[] na ordem
  // do sistema. Os chips "Criaturas"/"Sala" filtram por tipo/origem, não por itemKinds[].key.
  const groups = useMemo(() => {
    const matchesChips = (id: string, roomOnly: boolean) => kinds.size === 0 || (kinds.has(ROOM_FILTER) && roomIds.includes(id)) || roomOnly;
    const out: { key: string; label: string; Icon: typeof creatureIcon; rows: PaletteRow[] }[] = [];

    if (creatureEntries.length > 0) {
      const rows: PaletteRow[] = creatureEntries
        .filter((e) => matchesChips(e.id, kinds.has(CREATURE_FILTER)) && matchesQuery(e, query))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => ({ kind: "creature", entry }));
      if (rows.length > 0) out.push({ key: CREATURE_FILTER, label: "Criaturas", Icon: creatureIcon, rows });
    }
    def.itemKinds.forEach((kind, index) => {
      const rows: PaletteRow[] = items
        .filter((e) => e.kind === kind.key && matchesChips(e.id, kinds.has(kind.key)) && matchesQuery(e, query))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => ({ kind: "item", entry, check: character ? checkInsert(def, character, entry) : NO_SHEET_CHECK }));
      if (rows.length > 0) out.push({ key: kind.key, label: kind.label, Icon: kindIcon(index), rows });
    });
    return out;
  }, [def, character, items, creatureEntries, kinds, roomIds, query]);
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
    if (row.kind !== "item" || !onInsert) return;
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

  // Quantidade (reseta a cada criatura focada) e toggle "invisível ao soltar" (lembrado na sessão,
  // não por criatura — ver store: o fantasma de células do VttCanvas também lê a quantidade daqui
  // durante o arrasto). Enter no preview (ou o botão "Soltar") solta no centro da área visível do mapa.
  const spawnCount = useCompendium((s) => s.spawnCount);
  const setSpawnCount = useCompendium((s) => s.setSpawnCount);
  const spawnInvisible = useCompendium((s) => s.spawnInvisible);
  const setSpawnInvisible = useCompendium((s) => s.setSpawnInvisible);
  const currentCreatureId = current?.kind === "creature" ? current.entry.id : null;
  useEffect(() => setSpawnCount(1), [currentCreatureId, setSpawnCount]);

  const spawn = async (row: CreaturePaletteRow, keepOpen: boolean) => {
    if (!onSpawnCreature) return;
    const ok = await onSpawnCreature(row.entry.id, { count: spawnCount, visible: !spawnInvisible });
    if (!ok || keepOpen) return;
    onClose();
  };

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
      if (current.kind === "creature") void spawn(current, e.ctrlKey || e.metaKey);
      else void insert(current, e.ctrlKey || e.metaKey);
    }
  };

  const preview = current ? (
    current.kind === "item" ? (
      <EntryPreview def={def} row={current} onReplace={() => void insert(current, false, true)} />
    ) : (
      <CreaturePreview
        def={def}
        entry={current.entry}
        spawn={
          onSpawnCreature
            ? {
                count: spawnCount,
                onCountChange: setSpawnCount,
                invisible: spawnInvisible,
                onInvisibleChange: setSpawnInvisible,
                onSpawn: () => void spawn(current, false),
              }
            : undefined
        }
      />
    )
  ) : (
    <div className="p-4 text-xs text-zinc-600 font-serif flex flex-col items-center gap-2 text-center">
      <BookOpen className="w-6 h-6" />
      Selecione uma entrada para ver o resumo.
    </div>
  );

  const list = (
    <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto py-1" onPointerDown={() => inputRef.current?.focus()}>
      {status === "loading" && <div className="p-4 text-xs text-zinc-500 font-serif">Carregando compêndio…</div>}
      {status === "error" && <div className="p-4 text-xs text-red-300 font-serif">Não foi possível carregar o compêndio.</div>}
      {status === "ready" && flat.length === 0 && <div className="p-4 text-xs text-zinc-500 font-serif">Nada encontrado.</div>}
      {groups.map(({ key, label, Icon, rows }) => (
        <div key={key} className="mb-1">
          <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-widest text-zinc-500 font-serif">
            <Icon className="w-3 h-3" /> {label}
          </div>
          {rows.map((row) =>
            row.kind === "item" ? (
              <PaletteRowView
                key={row.entry.id}
                row={row}
                focused={current?.entry.id === row.entry.id}
                inserted={justInserted === row.entry.id}
                onFocus={() => setFocused(flat.indexOf(row))}
                onInsert={() => void insert(row, true)}
                onPointerDown={(e) => row.check.ok && onRowPointerDown(e, row.entry.id)}
              />
            ) : (
              <CreatureRowView
                key={row.entry.id}
                entry={row.entry}
                focused={current?.entry.id === row.entry.id}
                onFocus={() => setFocused(flat.indexOf(row))}
                onPointerDown={(e) => !!onSpawnCreature && onRowPointerDown(e, row.entry.id)}
              />
            ),
          )}
        </div>
      ))}
    </div>
  );

  const panel = (
    <div
      role="dialog"
      aria-label="Compêndio"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
      className={`h-full bg-[#0f0e0c] border-[#3a3022] flex flex-col overflow-hidden ${
        mode === "docked"
          ? "w-full border-l shadow-[-10px_0_30px_rgba(0,0,0,0.6)]"
          : "w-96 max-w-full border rounded-lg shadow-[0_0_40px_rgba(0,0,0,0.8)]"
      }`}
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
            className="flex-1 min-w-0 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
          <kbd className="text-[10px] text-zinc-500 border border-zinc-700 rounded px-1 font-mono">Esc</kbd>
          <button onClick={onClose} className="p-1 rounded text-zinc-500 hover:text-zinc-200 cursor-pointer" title="Fechar">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {creatureEntries.length > 0 && (
            <ChipButton
              id={`compendium-chip-${CREATURE_FILTER}`}
              Icon={creatureIcon}
              label="Criaturas"
              count={creatureEntries.length}
              active={kinds.has(CREATURE_FILTER)}
              onClick={() => toggleKind(CREATURE_FILTER)}
            />
          )}
          {def.itemKinds.map((kind, index) => (
            <ChipButton
              key={kind.key}
              id={`compendium-chip-${kind.key}`}
              Icon={kindIcon(index)}
              label={kind.label}
              count={items.filter((e) => e.kind === kind.key).length}
              active={kinds.has(kind.key)}
              onClick={() => toggleKind(kind.key)}
            />
          ))}
          {roomIds.length > 0 && (
            <ChipButton id={`compendium-chip-${ROOM_FILTER}`} Icon={BookOpen} label="Sala" count={roomIds.length} active={kinds.has(ROOM_FILTER)} onClick={() => toggleKind(ROOM_FILTER)} />
          )}
          {kinds.size > 0 && (
            <button onClick={() => setKinds(new Set())} className="text-[10px] text-zinc-500 hover:text-zinc-300 underline cursor-pointer ml-1">
              todos
            </button>
          )}
        </div>
      </div>

      {/* Resultados + preview: empilhados (janela alta) ou em abas (janela baixa) */}
      {short ? (
        <>
          <div className="flex border-b border-[#2d2417] text-[11px] font-serif">
            {(["list", "preview"] as const).map((p) => (
              <button
                key={p}
                id={`compendium-pane-${p}`}
                onClick={() => setPane(p)}
                className={`flex-1 py-1 cursor-pointer transition-colors ${pane === p ? "text-[#d4af37] border-b-2 border-[#d4af37]" : "text-zinc-500 hover:text-zinc-300"}`}
              >
                {p === "list" ? `Resultados (${flat.length})` : "Detalhes"}
              </button>
            ))}
          </div>
          {pane === "list" ? list : <div className="flex-1 min-h-0 overflow-y-auto bg-[#0b0a09]">{preview}</div>}
        </>
      ) : (
        <>
          {list}
          <div id="compendium-preview-pane" className="shrink-0 max-h-[45%] min-h-24 border-t border-[#2d2417] overflow-y-auto bg-[#0b0a09]">{preview}</div>
        </>
      )}

      <div className="px-3 py-1.5 border-t border-[#2d2417] text-[10px] text-zinc-500 font-serif flex items-center gap-x-3 gap-y-0.5 flex-wrap">
        <span><kbd className="font-mono">↑↓</kbd> navegar</span>
        <span><kbd className="font-mono">Esc</kbd> fechar</span>
        {context === "sheet" ? (
          <>
            <span><kbd className="font-mono">Enter</kbd> inserir</span>
            <span><kbd className="font-mono">Ctrl+Enter</kbd> inserir e continuar</span>
            <span>arraste uma entrada para a ficha</span>
          </>
        ) : (
          onSpawnCreature && (
            <>
              <span><kbd className="font-mono">Enter</kbd> soltar no mapa</span>
              <span><kbd className="font-mono">Ctrl+Enter</kbd> soltar e continuar</span>
            </>
          )
        )}
      </div>
    </div>
  );

  if (mode === "docked") {
    // Irmã da ficha no drawer: ocupa a altura toda e nunca fica por cima dela.
    return (
      <div id="compendium-palette" data-mode="docked" className="relative z-10 h-full shrink-0 palette-dock-in" style={{ width: PALETTE_WIDTH_PX }}>
        {panel}
      </div>
    );
  }
  if (mode === "map") {
    // Flutua à esquerda do mapa, sem escurecer o resto: o mapa continua visível e utilizável (é o
    // alvo da soltura de criaturas). O wrapper é pointer-events-none pra não bloquear cliques no
    // mapa fora do painel; só o painel em si captura eventos.
    return (
      <div id="compendium-palette" data-mode="map" className="absolute inset-0 z-30 flex items-stretch justify-start p-4 pointer-events-none">
        <div className={`h-full transition-opacity ${dragging ? "opacity-25 pointer-events-none" : "pointer-events-auto"}`}>{panel}</div>
      </div>
    );
  }
  return (
    <div
      id="compendium-palette"
      data-mode="floating"
      onPointerDown={onClose}
      // Arrastando: a paleta fica translúcida e deixa o cursor "passar" (elementFromPoint acha a ficha).
      className={`absolute inset-0 z-30 flex items-stretch justify-start p-4 bg-black/60 backdrop-blur-[1px] transition-opacity ${dragging ? "opacity-25 pointer-events-none" : ""}`}
    >
      {panel}
    </div>
  );
};

const ChipButton: React.FC<{ id: string; Icon: typeof creatureIcon; label: string; count: number; active: boolean; onClick: () => void }> = ({
  id,
  Icon,
  label,
  count,
  active,
  onClick,
}) => (
  <button
    id={id}
    onClick={onClick}
    className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-serif transition-colors cursor-pointer ${
      active ? "bg-[#2d2417] border-[#d4af37] text-[#d4af37] font-bold" : "bg-[#141414] border-zinc-700 text-zinc-400 hover:border-zinc-500"
    }`}
  >
    <Icon className="w-3 h-3" />
    {label}
    <span className="font-mono text-[9px] opacity-70">{count}</span>
  </button>
);

interface PaletteRowViewProps {
  row: ItemPaletteRow;
  focused: boolean;
  inserted: boolean;
  onFocus: () => void;
  onInsert: () => void;
  /** Início de um possível arrasto (só entradas inseríveis). */
  onPointerDown: (e: React.PointerEvent) => void;
}

const PaletteRowView: React.FC<PaletteRowViewProps> = ({ row, focused, inserted, onFocus, onInsert, onPointerDown }) => {
  const { entry, check } = row;
  return (
    <div
      data-entry-id={entry.id}
      onPointerEnter={onFocus}
      onPointerDown={onPointerDown}
      onClick={onFocus}
      onDoubleClick={() => check.ok && onInsert()}
      title={check.ok ? "Arraste para a ficha ou pressione Enter" : undefined}
      className={`group flex items-center gap-2 mx-1 px-2 py-1.5 rounded transition-colors ${check.ok ? "cursor-grab active:cursor-grabbing" : "cursor-not-allowed"} ${
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
        // Sem ficha aberta (contexto "map"), check é só o sentinel NO_SHEET_CHECK (ok=false,
        // reason=null): não há onde inserir, então o botão nem aparece (nada a explicar num hover).
        (check.ok || check.reason !== null) && (
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
        )
      )}
    </div>
  );
};

interface CreatureRowViewProps {
  entry: CompendiumCreatureEntry;
  focused: boolean;
  onFocus: () => void;
  /** Início de um possível arrasto pro mapa (docs/plano-criaturas.md §2.4). */
  onPointerDown: (e: React.PointerEvent) => void;
}

const CreatureRowView: React.FC<CreatureRowViewProps> = ({ entry, focused, onFocus, onPointerDown }) => (
  <div
    data-entry-id={entry.id}
    onPointerEnter={onFocus}
    onPointerDown={onPointerDown}
    onClick={onFocus}
    title="Arraste para o mapa ou pressione Enter"
    className={`flex items-center gap-2 mx-1 px-2 py-1.5 rounded transition-colors cursor-grab active:cursor-grabbing ${focused ? "bg-[#1e1a14] ring-1 ring-[#d4af37]/60" : "hover:bg-[#161412]"}`}
  >
    <div className="min-w-0 flex-1">
      <div className="text-sm font-serif truncate text-zinc-100">{entry.name}</div>
      {entry.tags.length > 0 && <div className="text-[10px] text-zinc-500 truncate">{entry.tags.join(" · ")}</div>}
    </div>
  </div>
);
