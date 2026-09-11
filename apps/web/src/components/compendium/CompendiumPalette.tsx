import React, { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, Eye, EyeOff, ListPlus, Plus, Save, Search, Trash2, Users, X } from "lucide-react";
import { sumChallengeRating, type Character, type CompendiumCreatureEntry, type CompendiumEntry, type CompendiumItemEntry, type SavedEncounter, type SystemDefinition } from "@tormenta-vtt/shared";
import { checkInsert, matchesQuery, CREATURE_FILTER, ENCOUNTER_FILTER, ROOM_FILTER, type InsertCheck } from "../../lib/compendium";
import { useCompendium } from "../../store/compendium";
import { useEncounters, type EncounterCartItem } from "../../store/encounters";
import { useMediaQuery } from "../../lib/useMediaQuery";
import { creatureIcon, kindIcon } from "../character/kindIcons";
import { EntryPreview } from "./EntryPreview";
import { CreaturePreview } from "./CreaturePreview";
import { CreatureFullSheet } from "./CreatureFullSheet";
import { EncounterPreview, encounterIcon, formatChallenge } from "./EncounterPreview";
import { useCompendiumDrag, useEncounterDrag } from "./DragGhost";

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
  /** Solta um encontro salvo inteiro no mapa (§9.14). Ausente/ignorado fora do contexto "map". */
  onSpawnEncounter?: (encounterId: string, opts: { startCombat: boolean; rollNpcInitiative: boolean }) => Promise<boolean>;
  /** Tokens selecionados no mapa agora (GM): habilita "Dos selecionados" no modo "Montar encontro". */
  selectedTokenIds?: string[];
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
/** Uma linha de encontro salvo (§9.14): solta o grupo inteiro no mapa, não se insere na ficha. */
interface EncounterPaletteRow {
  kind: "encounter";
  encounter: SavedEncounter;
}
export type PaletteRow = ItemPaletteRow | CreaturePaletteRow | EncounterPaletteRow;

/** Id de uma linha, qualquer que seja o kind — item/criatura usam `.entry.id`, encontro usa `.encounter.id`. */
function rowId(row: PaletteRow): string {
  return row.kind === "encounter" ? row.encounter.id : row.entry.id;
}

const NO_SHEET_CHECK: InsertCheck = { ok: false, reason: null, replaces: null };

/**
 * Paleta de comandos do compêndio, sempre em coluna: busca com foco automático,
 * chips por tipo (no contexto "map" só Criaturas/Encontros ficam à mostra; os demais tipos entram
 * atrás do chip "todos ▾" — no contexto "sheet" continuam todos à mostra), resultados agrupados,
 * preview compacto abaixo da lista (ou em aba "Detalhes" quando a janela é baixa) e teclado: setas,
 * Enter, Ctrl+Enter, Esc. O invólucro muda com `mode`.
 *
 * O CONTEÚDO muda com `context` (da store, definido em quem chamou `open`): "sheet" só lista/insere
 * itens (comportamento de sempre); "map" lista itens (só consulta, sem `character`), criaturas — que
 * o GM solta no mapa — e encontros salvos (§9.14). O modo "Montar encontro" (botão no cabeçalho)
 * troca o rodapé pelo carrinho e acrescenta um "+" em cada linha de criatura.
 */
export const CompendiumPalette: React.FC<CompendiumPaletteProps> = ({ def, character, mode, onInsert, onSpawnCreature, onSpawnEncounter, selectedTokenIds = [], onClose }) => {
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
  // Contexto "map": os tipos de item além de Criaturas/Encontros ficam atrás deste chip (item 2).
  const [showAllKinds, setShowAllKinds] = useState(false);

  useEffect(() => inputRef.current?.focus(), []);

  const items = useMemo(() => entries.filter((e): e is CompendiumItemEntry => e.type === "item"), [entries]);
  // Só aparecem no contexto "map" (o servidor já nem manda pra jogador — ver compendium:list).
  const creatureEntries = useMemo(
    () => (context === "map" ? entries.filter((e): e is CompendiumCreatureEntry => e.type === "creature") : []),
    [context, entries],
  );

  // Encontros salvos (§9.14): mesma regra de "só no contexto map" das criaturas; carrega sob
  // demanda na primeira vez que a paleta abre sobre o mapa (mesmo padrão de useCompendium.load()).
  const allEncounters = useEncounters((s) => s.items);
  useEffect(() => {
    if (context === "map" && onSpawnEncounter) void useEncounters.getState().load();
  }, [context, onSpawnEncounter]);
  const encounterEntries = useMemo(() => (context === "map" && onSpawnEncounter ? allEncounters : []), [context, onSpawnEncounter, allEncounters]);
  const cart = useEncounters((s) => s.cart);
  const { onRowPointerDown: onEncounterRowPointerDown } = useEncounterDrag();

  // Linhas visíveis, agrupadas: Criaturas primeiro (quando há alguma), depois Encontros, depois
  // itemKinds[] na ordem do sistema. Os chips "Criaturas"/"Encontros"/"Sala" filtram por
  // tipo/origem, não por itemKinds[].key.
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
    if (encounterEntries.length > 0) {
      const rows: PaletteRow[] = encounterEntries
        .filter((e) => matchesChips(e.id, kinds.has(ENCOUNTER_FILTER)) && matchesQuery(e, query))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((encounter) => ({ kind: "encounter", encounter }));
      if (rows.length > 0) out.push({ key: ENCOUNTER_FILTER, label: "Encontros", Icon: encounterIcon, rows });
    }
    def.itemKinds.forEach((kind, index) => {
      const rows: PaletteRow[] = items
        .filter((e) => e.kind === kind.key && matchesChips(e.id, kinds.has(kind.key)) && matchesQuery(e, query))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => ({ kind: "item", entry, check: character ? checkInsert(def, character, entry) : NO_SHEET_CHECK }));
      if (rows.length > 0) out.push({ key: kind.key, label: kind.label, Icon: kindIcon(index), rows });
    });
    return out;
  }, [def, character, items, creatureEntries, encounterEntries, kinds, roomIds, query]);
  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const current = flat[Math.min(focused, Math.max(0, flat.length - 1))] ?? null;

  // Mudou a busca/filtro: volta o foco para o primeiro resultado.
  useEffect(() => setFocused(0), [query, kinds]);
  // Mantém a linha focada à vista ao navegar com as setas.
  useEffect(() => {
    if (!current) return;
    listRef.current?.querySelector<HTMLElement>(`[data-entry-id="${rowId(current)}"]`)?.scrollIntoView({ block: "nearest" });
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
  // durante o arrasto, e o "+" do modo "Montar encontro" usa os dois pro item novo do carrinho).
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

  // Checkboxes "iniciar combate"/"rolar iniciativa" (EncounterPreview): vivem na store porque o
  // drop no mapa (VttCanvas) também precisa deles — mesmo motivo de spawnCount/spawnInvisible acima.
  const spawnStartCombat = useEncounters((s) => s.spawnStartCombat);
  const setSpawnStartCombat = useEncounters((s) => s.setSpawnStartCombat);
  const spawnRollNpcInitiative = useEncounters((s) => s.spawnRollNpcInitiative);
  const setSpawnRollNpcInitiative = useEncounters((s) => s.setSpawnRollNpcInitiative);

  const spawnEncounterRow = async (row: EncounterPaletteRow, keepOpen: boolean) => {
    if (!onSpawnEncounter) return;
    const ok = await onSpawnEncounter(row.encounter.id, { startCombat: spawnStartCombat, rollNpcInitiative: spawnRollNpcInitiative });
    if (!ok || keepOpen) return;
    onClose();
  };

  // "Ver bloco completo" (§9.5): ficha inteira em modo leitura, botão ou duplo clique na lista.
  const [openFullSheetEntry, setOpenFullSheetEntry] = useState<CompendiumCreatureEntry | null>(null);

  // Modo "Montar encontro" (§9.14, item 3): botão no cabeçalho; ligado, cada linha de criatura
  // ganha um "+" (soma ao carrinho) e o rodapé vira o carrinho no lugar do preview. Desligar não
  // esvazia o carrinho (só "Cancelar", lá embaixo, faz isso) — só fecha um formulário pendente.
  const [encounterMode, setEncounterMode] = useState(false);
  const [cartFormOpen, setCartFormOpen] = useState(false);
  const [selectionFormOpen, setSelectionFormOpen] = useState(false);
  useEffect(() => {
    if (!encounterMode) {
      setCartFormOpen(false);
      setSelectionFormOpen(false);
    }
  }, [encounterMode]);

  // "Editar" (EncounterPreview): mesmo formulariozinho, mas fora do modo "Montar encontro" — edita
  // um encontro JÁ SALVO (chip "Encontros"), não o carrinho em construção.
  const [editingEncounter, setEditingEncounter] = useState<SavedEncounter | null>(null);
  // Trocou de linha focada (ou saiu do grupo Encontros): fecha o formulário de edição pendente.
  const currentEncounterId = current?.kind === "encounter" ? current.encounter.id : null;
  useEffect(() => setEditingEncounter(null), [currentEncounterId]);

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
      else if (current.kind === "encounter") void spawnEncounterRow(current, e.ctrlKey || e.metaKey);
      else void insert(current, e.ctrlKey || e.metaKey);
    }
  };

  const preview = current ? (
    current.kind === "item" ? (
      <EntryPreview def={def} row={current} onReplace={() => void insert(current, false, true)} />
    ) : current.kind === "creature" ? (
      <CreaturePreview
        def={def}
        entry={current.entry}
        spawn={onSpawnCreature ? { count: spawnCount, onCountChange: setSpawnCount, invisible: spawnInvisible, onInvisibleChange: setSpawnInvisible } : undefined}
        onOpenFullSheet={() => setOpenFullSheetEntry(current.entry)}
      />
    ) : (
      <EncounterPreview
        def={def}
        encounter={current.encounter}
        compendiumEntries={entries}
        spawn={
          onSpawnEncounter
            ? {
                startCombat: spawnStartCombat,
                onStartCombatChange: setSpawnStartCombat,
                rollNpcInitiative: spawnRollNpcInitiative,
                onRollNpcInitiativeChange: setSpawnRollNpcInitiative,
                onSpawn: () => void spawnEncounterRow(current, false),
              }
            : undefined
        }
        onEdit={() => setEditingEncounter(current.encounter)}
        onDuplicate={() => void useEncounters.getState().duplicate(current.encounter)}
        onDelete={() => void useEncounters.getState().remove(current.encounter.id)}
      />
    )
  ) : (
    <div className="p-4 text-xs text-zinc-600 font-serif flex flex-col items-center gap-2 text-center">
      <BookOpen className="w-6 h-6" />
      Selecione uma entrada para ver o resumo.
    </div>
  );
  // "Editar" (EncounterPreview) troca o preview pelo formulário; o modo "Montar encontro" troca o
  // rodapé inteiro pelo carrinho — os dois nunca disputam o mesmo espaço (editar um encontro salvo
  // fecha sozinho ao focar outra linha, useEffect acima).
  const bottomPane = encounterMode ? (
    <EncounterCartPanel
      def={def}
      compendiumEntries={entries}
      cart={cart}
      selectedTokenIds={selectedTokenIds}
      cartFormOpen={cartFormOpen}
      onOpenCartForm={() => setCartFormOpen(true)}
      onCancelCartForm={() => setCartFormOpen(false)}
      onSaveCart={async (name, tags, notes) => {
        const created = await useEncounters.getState().createFromCart(name, tags, notes);
        if (created) setEncounterMode(false);
      }}
      selectionFormOpen={selectionFormOpen}
      onOpenSelectionForm={() => setSelectionFormOpen(true)}
      onCancelSelectionForm={() => setSelectionFormOpen(false)}
      onSaveSelection={async (name, tags, notes) => {
        const ok = await useEncounters.getState().createFromTokens(selectedTokenIds, name, tags, notes);
        if (ok) setEncounterMode(false);
      }}
      onSetCount={(id, n) => useEncounters.getState().setCartCount(id, n)}
      onSetVisible={(id, v) => useEncounters.getState().setCartVisible(id, v)}
      onRemove={(id) => useEncounters.getState().removeFromCart(id)}
      onCancelAll={() => {
        useEncounters.getState().clearCart();
        setEncounterMode(false);
      }}
    />
  ) : editingEncounter ? (
    <div className="p-2">
      <EncounterMetaForm
        initial={{ name: editingEncounter.name, tags: editingEncounter.tags, notes: editingEncounter.notes }}
        submitLabel="Salvar alterações"
        onSubmit={async (name, tags, notes) => {
          const ok = await useEncounters.getState().update(editingEncounter.id, { name, tags, notes });
          if (ok) setEditingEncounter(null);
        }}
        onCancel={() => setEditingEncounter(null)}
      />
    </div>
  ) : (
    preview
  );

  const list = (
    <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto py-1" onPointerDown={() => inputRef.current?.focus()}>
      {status === "loading" && <div className="p-4 text-xs text-zinc-500 font-serif">Carregando compêndio…</div>}
      {status === "error" && <div className="p-4 text-xs text-red-300 font-serif">Não foi possível carregar o compêndio.</div>}
      {status === "ready" && flat.length === 0 && <div className="p-4 text-xs text-zinc-500 font-serif">Nada encontrado.</div>}
      {groups.map(({ key, label, Icon, rows }) => (
        <div key={key} className="mb-1">
          <div className="flex items-center gap-1.5 px-3 py-0.5 text-[10px] uppercase tracking-widest text-zinc-500 font-serif">
            <Icon className="w-3 h-3" /> {label}
          </div>
          {rows.map((row) =>
            row.kind === "item" ? (
              <PaletteRowView
                key={row.entry.id}
                row={row}
                focused={current !== null && rowId(current) === rowId(row)}
                inserted={justInserted === row.entry.id}
                onFocus={() => setFocused(flat.indexOf(row))}
                onInsert={() => void insert(row, true)}
                onPointerDown={(e) => row.check.ok && onRowPointerDown(e, row.entry.id)}
              />
            ) : row.kind === "creature" ? (
              <CreatureRowView
                key={row.entry.id}
                entry={row.entry}
                focused={current !== null && rowId(current) === rowId(row)}
                onFocus={() => setFocused(flat.indexOf(row))}
                onPointerDown={(e) => !!onSpawnCreature && onRowPointerDown(e, row.entry.id)}
                onDoubleClick={() => setOpenFullSheetEntry(row.entry)}
                onAddToCart={encounterMode ? () => useEncounters.getState().addToCart(row.entry.id, spawnCount, !spawnInvisible) : undefined}
              />
            ) : (
              <EncounterRowView
                key={row.encounter.id}
                encounter={row.encounter}
                focused={current !== null && rowId(current) === rowId(row)}
                onFocus={() => setFocused(flat.indexOf(row))}
                onPointerDown={(e) => !!onSpawnEncounter && onEncounterRowPointerDown(e, row.encounter.id)}
              />
            ),
          )}
        </div>
      ))}
    </div>
  );

  // Contexto "map": só chips de Criaturas/Encontros ficam sempre à mostra (item 2) — os itemKinds[]
  // do sistema (e "Sala") entram atrás do chip "todos ▾". Contexto "sheet": como sempre foi.
  const otherKindsCount = items.length + (roomIds.length > 0 ? 1 : 0);
  const hiddenKindActive = [...kinds].some((k) => k !== CREATURE_FILTER && k !== ENCOUNTER_FILTER);
  const otherKindChips = (
    <>
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
    </>
  );

  const panel = (
    <div
      role="dialog"
      aria-label="Compêndio"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
      className={`h-full bg-[#0f0e0c] flex flex-col overflow-hidden transition-colors ${
        mode === "docked" ? "w-full border-l shadow-[-10px_0_30px_rgba(0,0,0,0.6)]" : "w-96 max-w-full border rounded-lg shadow-[0_0_40px_rgba(0,0,0,0.8)]"
      } ${encounterMode ? "border-[#d4af37] shadow-[0_0_24px_rgba(212,175,55,0.25)]" : "border-[#3a3022]"}`}
    >
      {/* Busca */}
      <div className="p-2 border-b border-[#2d2417] space-y-1.5">
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

        {/* Chips + "Montar encontro" (item 2/3): uma linha só, chips à esquerda, modo à direita. */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            {context === "map" ? (
              <>
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
                {encounterEntries.length > 0 && (
                  <ChipButton
                    id={`compendium-chip-${ENCOUNTER_FILTER}`}
                    Icon={encounterIcon}
                    label="Encontros"
                    count={encounterEntries.length}
                    active={kinds.has(ENCOUNTER_FILTER)}
                    onClick={() => toggleKind(ENCOUNTER_FILTER)}
                  />
                )}
                {otherKindsCount > 0 && (
                  <ChipButton
                    id="compendium-chip-all"
                    Icon={BookOpen}
                    label={showAllKinds ? "todos ▴" : "todos ▾"}
                    count={otherKindsCount}
                    active={showAllKinds || hiddenKindActive}
                    onClick={() => setShowAllKinds((v) => !v)}
                  />
                )}
                {showAllKinds && otherKindChips}
              </>
            ) : (
              otherKindChips
            )}
            {kinds.size > 0 && (
              <button onClick={() => setKinds(new Set())} className="text-[10px] text-zinc-500 hover:text-zinc-300 underline cursor-pointer ml-1">
                todos
              </button>
            )}
          </div>
          {context === "map" && onSpawnEncounter && (
            <button
              id="encounter-mode-toggle"
              onClick={() => setEncounterMode((v) => !v)}
              title="Montar um encontro: adicionar criaturas da lista a um carrinho e salvar"
              className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-serif transition-colors cursor-pointer ${
                encounterMode ? "bg-[#2d2417] border-[#d4af37] text-[#d4af37] font-bold" : "bg-[#141414] border-zinc-700 text-zinc-400 hover:border-zinc-500"
              }`}
            >
              <ListPlus className="w-3 h-3" />
              Montar encontro
              {cart.length > 0 && <span className="font-mono text-[9px] opacity-70">{cart.length}</span>}
            </button>
          )}
        </div>
      </div>

      {/* Resultados + rodapé (preview/edição/carrinho): empilhados (janela alta) ou em abas (janela baixa) */}
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
          {pane === "list" ? list : <div className="flex-1 min-h-0 overflow-y-auto bg-[#0b0a09]">{bottomPane}</div>}
        </>
      ) : (
        <>
          {list}
          <div id="compendium-preview-pane" className="shrink-0 max-h-[50%] min-h-20 border-t border-[#2d2417] overflow-y-auto bg-[#0b0a09]">
            {bottomPane}
          </div>
        </>
      )}

      <div className="px-2 py-1 border-t border-[#2d2417] text-[10px] text-zinc-500 font-serif flex items-center gap-x-3 gap-y-0.5 flex-wrap">
        <span>
          <kbd className="font-mono">↑↓</kbd> navegar
        </span>
        <span>
          <kbd className="font-mono">Esc</kbd> fechar
        </span>
        {context === "sheet" ? (
          <>
            <span>
              <kbd className="font-mono">Enter</kbd> inserir
            </span>
            <span>
              <kbd className="font-mono">Ctrl+Enter</kbd> inserir e continuar
            </span>
            <span>arraste uma entrada para a ficha</span>
          </>
        ) : (
          (onSpawnCreature || onSpawnEncounter) && (
            <>
              <span>
                <kbd className="font-mono">Enter</kbd> soltar
              </span>
              <span>
                <kbd className="font-mono">Ctrl+Enter</kbd> soltar e continuar
              </span>
              <span>duplo clique bloco completo</span>
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
        {openFullSheetEntry && <CreatureFullSheet def={def} entry={openFullSheetEntry} onClose={() => setOpenFullSheetEntry(null)} />}
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
      className={`group flex items-center gap-2 mx-1 px-2 py-1 rounded transition-colors ${check.ok ? "cursor-grab active:cursor-grabbing" : "cursor-not-allowed"} ${
        focused ? "bg-[#1e1a14] ring-1 ring-[#d4af37]/60" : "hover:bg-[#161412]"
      } ${check.ok ? "" : "opacity-50"}`}
    >
      <div className="min-w-0 flex-1">
        <div className={`text-xs font-serif truncate ${check.ok ? "text-zinc-100" : "text-zinc-400"}`}>{entry.name}</div>
        {entry.tags.length > 0 && <div className="text-[10px] text-zinc-500 truncate">{entry.tags.join(" · ")}</div>}
      </div>
      {inserted ? (
        <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-serif">
          <Check className="w-3.5 h-3.5" /> inserido
        </span>
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
  /** Duplo clique na linha: abre o bloco completo em modo leitura (§9.5), não solta no mapa. */
  onDoubleClick: () => void;
  /** "+" (modo "Montar encontro", §9.14): soma ao carrinho. Ausente = modo desligado. */
  onAddToCart?: () => void;
}

const CreatureRowView: React.FC<CreatureRowViewProps> = ({ entry, focused, onFocus, onPointerDown, onDoubleClick, onAddToCart }) => (
  <div
    data-entry-id={entry.id}
    onPointerEnter={onFocus}
    onPointerDown={onPointerDown}
    onClick={onFocus}
    onDoubleClick={onDoubleClick}
    title="Arraste para o mapa, Enter solta, duplo clique abre o bloco completo"
    className={`group flex items-center gap-2 mx-1 px-2 py-1 rounded transition-colors cursor-grab active:cursor-grabbing ${focused ? "bg-[#1e1a14] ring-1 ring-[#d4af37]/60" : "hover:bg-[#161412]"}`}
  >
    <div className="min-w-0 flex-1">
      <div className="text-xs font-serif truncate text-zinc-100">{entry.name}</div>
      {entry.tags.length > 0 && <div className="text-[10px] text-zinc-500 truncate">{entry.tags.join(" · ")}</div>}
    </div>
    {onAddToCart && (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onAddToCart();
        }}
        title="Adicionar ao carrinho do encontro"
        className={`p-1 rounded border border-[#d4af37]/50 text-[#d4af37] hover:bg-[#2d2417] transition-opacity cursor-pointer ${focused ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    )}
  </div>
);

interface EncounterRowViewProps {
  encounter: SavedEncounter;
  focused: boolean;
  onFocus: () => void;
  /** Início de um possível arrasto pro mapa (§9.14, mesmo mecanismo de CreatureRowView). */
  onPointerDown: (e: React.PointerEvent) => void;
}

const EncounterRowView: React.FC<EncounterRowViewProps> = ({ encounter, focused, onFocus, onPointerDown }) => {
  const total = encounter.entries.reduce((sum, e) => sum + e.count, 0);
  return (
    <div
      data-entry-id={encounter.id}
      onPointerEnter={onFocus}
      onPointerDown={onPointerDown}
      onClick={onFocus}
      title="Arraste para o mapa ou pressione Enter"
      className={`flex items-center gap-2 mx-1 px-2 py-1 rounded transition-colors cursor-grab active:cursor-grabbing ${focused ? "bg-[#1e1a14] ring-1 ring-[#d4af37]/60" : "hover:bg-[#161412]"}`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-xs font-serif truncate text-zinc-100">{encounter.name}</div>
        <div className="text-[10px] text-zinc-500 truncate">
          {total} criatura{total === 1 ? "" : "s"}
          {encounter.tags.length > 0 ? ` · ${encounter.tags.join(" · ")}` : ""}
        </div>
      </div>
    </div>
  );
};

interface EncounterMetaFormProps {
  initial: { name: string; tags: string[]; notes: string };
  submitLabel: string;
  onSubmit: (name: string, tags: string[], notes: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * Formulário pequeno (nome/tags/notas) reaproveitado por "salvar carrinho", "dos selecionados" e
 * "editar" (§9.14) — só o que `onSubmit` chama muda entre os três.
 */
const EncounterMetaForm: React.FC<EncounterMetaFormProps> = ({ initial, submitLabel, onSubmit, onCancel }) => {
  const [name, setName] = useState(initial.name);
  const [tags, setTags] = useState(initial.tags.join(", "));
  const [notes, setNotes] = useState(initial.notes);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    await onSubmit(
      name.trim(),
      tags.split(",").map((t) => t.trim()).filter(Boolean),
      notes,
    );
    setBusy(false);
  };

  return (
    <div className="space-y-1.5" onKeyDown={(e) => e.stopPropagation()}>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome do encontro"
        className="w-full bg-[#0f0e0c] border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#d4af37]"
      />
      <input
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="Tags (separadas por vírgula)"
        className="w-full bg-[#0f0e0c] border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-[#d4af37]"
      />
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notas (opcional)"
        rows={2}
        className="w-full bg-[#0f0e0c] border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-100 placeholder:text-zinc-600 resize-none focus:outline-none focus:border-[#d4af37]"
      />
      <div className="flex items-center gap-1.5 justify-end">
        <button onClick={onCancel} className="px-2 py-1 rounded text-[10px] text-zinc-400 hover:text-zinc-200 cursor-pointer">
          Cancelar
        </button>
        <button
          onClick={() => void submit()}
          disabled={!name.trim() || busy}
          className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#d4af37] text-zinc-950 font-serif font-bold text-[11px] hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          <Save className="w-3 h-3" />
          {submitLabel}
        </button>
      </div>
    </div>
  );
};

interface EncounterCartPanelProps {
  def: SystemDefinition;
  compendiumEntries: CompendiumEntry[];
  cart: EncounterCartItem[];
  selectedTokenIds: string[];
  cartFormOpen: boolean;
  onOpenCartForm: () => void;
  onCancelCartForm: () => void;
  onSaveCart: (name: string, tags: string[], notes: string) => Promise<void>;
  selectionFormOpen: boolean;
  onOpenSelectionForm: () => void;
  onCancelSelectionForm: () => void;
  onSaveSelection: (name: string, tags: string[], notes: string) => Promise<void>;
  onSetCount: (entryId: string, count: number) => void;
  onSetVisible: (entryId: string, visible: boolean) => void;
  onRemove: (entryId: string) => void;
  onCancelAll: () => void;
}

/**
 * Rodapé do modo "Montar encontro" (§9.14, item 3): linhas do carrinho (×N, invisível por linha,
 * remover), ND total (mesmo `sumChallengeRating` do preview de encontro salvo) e os três botões —
 * "Salvar encontro" (o carrinho), "Dos selecionados" (tokens do mapa, ignora o carrinho) e
 * "Cancelar" (esvazia o carrinho e sai do modo). Cada botão de salvar abre o mesmo
 * `EncounterMetaForm` no lugar da lista, em vez de um modal separado.
 */
const EncounterCartPanel: React.FC<EncounterCartPanelProps> = ({
  def,
  compendiumEntries,
  cart,
  selectedTokenIds,
  cartFormOpen,
  onOpenCartForm,
  onCancelCartForm,
  onSaveCart,
  selectionFormOpen,
  onOpenSelectionForm,
  onCancelSelectionForm,
  onSaveSelection,
  onSetCount,
  onSetVisible,
  onRemove,
  onCancelAll,
}) => {
  const fakeEntries = useMemo(() => cart.map((c) => ({ entryId: c.entryId, count: c.count, visibleOnSpawn: c.visible, nameOverride: null })), [cart]);
  const { total: ndTotal } = sumChallengeRating(def, fakeEntries, compendiumEntries);

  if (cartFormOpen) {
    return (
      <div className="p-2">
        <EncounterMetaForm initial={{ name: "", tags: [], notes: "" }} submitLabel="Salvar" onSubmit={onSaveCart} onCancel={onCancelCartForm} />
      </div>
    );
  }
  if (selectionFormOpen) {
    return (
      <div className="p-2">
        <EncounterMetaForm initial={{ name: "", tags: [], notes: "" }} submitLabel="Salvar" onSubmit={onSaveSelection} onCancel={onCancelSelectionForm} />
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1.5 text-xs" id="encounter-cart">
      {cart.length === 0 ? (
        <p className="text-zinc-600 italic text-[11px] text-center py-2">Clique no "+" de uma criatura na lista pra adicionar aqui.</p>
      ) : (
        <>
          <div className="space-y-1">
            {cart.map((item) => {
              const creature = compendiumEntries.find((e) => e.id === item.entryId && e.type === "creature");
              return (
                <div key={item.entryId} className="flex items-center gap-1.5">
                  <span className="flex-1 min-w-0 truncate text-zinc-200 font-serif">{creature?.name ?? item.entryId}</span>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={item.count}
                    onChange={(e) => onSetCount(item.entryId, Math.min(20, Math.max(1, Math.round(Number(e.target.value) || 1))))}
                    className="w-9 bg-[#0f0e0c] border border-zinc-700 rounded px-1 py-0.5 text-zinc-100 text-[11px]"
                  />
                  <button
                    onClick={() => onSetVisible(item.entryId, !item.visible)}
                    title="Invisível ao soltar"
                    className={`p-0.5 rounded cursor-pointer ${item.visible ? "text-zinc-500 hover:text-zinc-300" : "text-[#d4af37]"}`}
                  >
                    {item.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => onRemove(item.entryId)} title="Remover" className="p-0.5 rounded text-zinc-500 hover:text-red-400 cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
          {ndTotal !== null && <div className="text-[10px] text-zinc-500 font-serif">ND total {formatChallenge(ndTotal)}</div>}
        </>
      )}
      <div className="flex items-center gap-1.5 pt-1.5 border-t border-[#2d2417]">
        <button
          id="encounter-cart-save"
          onClick={onOpenCartForm}
          disabled={cart.length === 0}
          className="flex items-center gap-1 px-2 py-1 rounded bg-[#d4af37] text-zinc-950 font-serif font-bold text-[10px] hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Save className="w-3 h-3" />
          Salvar encontro
        </button>
        <button
          id="encounter-cart-from-selection"
          onClick={onOpenSelectionForm}
          disabled={selectedTokenIds.length === 0}
          title={selectedTokenIds.length === 0 ? "Selecione tokens no mapa primeiro" : `${selectedTokenIds.length} token(s) selecionado(s)`}
          className="flex items-center gap-1 px-2 py-1 rounded border border-zinc-700 text-zinc-300 font-serif text-[10px] hover:border-[#d4af37] hover:text-[#d4af37] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Users className="w-3 h-3" />
          Dos selecionados
        </button>
        <button onClick={onCancelAll} className="ml-auto px-2 py-1 rounded text-[10px] text-zinc-500 hover:text-zinc-300 font-serif cursor-pointer">
          Cancelar
        </button>
      </div>
    </div>
  );
};
