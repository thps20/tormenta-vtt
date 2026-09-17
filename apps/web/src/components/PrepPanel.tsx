import React, { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  GripVertical,
  Link2Off,
  Map as MapIcon,
  MoreVertical,
  Music,
  Notebook,
  PawPrint,
  Pin as PinIcon,
  Play,
  Plus,
  RotateCcw,
  StickyNote,
  Swords,
  Trash2,
  User,
  UserRound,
  Zap,
} from "lucide-react";
import type { Asset, Handout, HandoutCard, Pin, PrepItem, PrepItemOptions, PrepRef, PrepStep } from "@tormenta-vtt/shared";
import { buildLibraryItems, resolvePrepRef, type PrepRefPools } from "@tormenta-vtt/shared";
import { registerDropTarget } from "../lib/dropTargets";
import { assetOfItem, describeItem, usePrepRunner, type PrepRunItem } from "../lib/usePrepRunner";
import { useLibrary } from "../store/library";
import { useHandouts } from "../store/handouts";
import { useEncounters } from "../store/encounters";
import { useCompendium } from "../store/compendium";
import { useMacros } from "../store/macros";
import { usePins } from "../store/pins";
import { useCharacters } from "../store/characters";
import { usePrep } from "../store/prep";
import { toast } from "../store/ui";
import { LightMarkdownView } from "./LightMarkdownView";
import { PrepAddItemDialog } from "./PrepAddItemDialog";
import { PrepRunDialog } from "./PrepRunDialog";

const KIND_ICON: Record<PrepRef["kind"], React.ComponentType<{ className?: string }>> = {
  asset: MapIcon,
  handout: FileText,
  encounter: Swords,
  creature: PawPrint,
  macro: Zap,
  pin: PinIcon,
  npc: User,
  note: StickyNote,
};

function iconForItem(item: PrepItem, asset: Asset | undefined): React.ComponentType<{ className?: string }> {
  if (item.ref.kind === "asset") return asset?.kind === "audio" ? Music : asset?.kind === "token" ? UserRound : MapIcon;
  return KIND_ICON[item.ref.kind];
}

export interface PrepPanelProps {
  sceneId: string;
  sceneName: string;
  scenes: { id: string; name: string }[];
  getViewportCenter: () => { x: number; y: number };
  onOpenMapNotes: () => void;
  onOpenNotePin: (pin: Pin & { kind: "note" }) => void;
}

/**
 * Aba "Preparo" (docs/plano-preparo.md §2), só GM. Mostra os passos do mapa VISTO agora
 * (`sceneId`) — troca de mapa recarrega. Nunca reimplementa uma ação: cada item chama a MESMA
 * store que o botão manual já chamaria (mesmo espírito das macros, §9.20).
 */
export const PrepPanel: React.FC<PrepPanelProps> = ({ sceneId, sceneName, scenes, getViewportCenter, onOpenMapNotes, onOpenNotePin }) => {
  // Toda a resolução de referência e a execução de item/passo vivem no hook (compartilhado com o
  // card "Próximo passo" do painel lateral, docs/SPEC.md §9.28).
  const { steps, status, pools, assets, resolvedNameOf, runAndMark, runItemsOf, runOneOf } = usePrepRunner({
    sceneId,
    getViewportCenter,
    onOpenNotePin,
    loadLibraries: true,
  });
  const handouts = useHandouts((s) => s.library);
  const encounters = useEncounters((s) => s.items);
  const entries = useCompendium((s) => s.entries);
  const macros = useMacros((s) => s.macros);
  const pinsByScene = usePins((s) => s.pinsByScene);
  const charactersById = useCharacters((s) => s.byId);
  const pins = pinsByScene[sceneId] ?? {};
  const npcs = useMemo(() => Object.values(charactersById).filter((c) => c.kind === "npc"), [charactersById]);
  const creatures = useMemo(() => entries.filter((e) => e.type === "creature"), [entries]);
  const homebrewIds = useCompendium((s) => s.roomIds);

  const [addItemStepId, setAddItemStepId] = useState<string | null>(null);
  const [creatingStep, setCreatingStep] = useState(false);
  const [newStepTitle, setNewStepTitle] = useState("");

  const usedCount = steps.filter((s) => s.used).length;

  return (
    <div className="font-ui h-full flex flex-col overflow-hidden">
      <div className="p-2 border-b border-border shrink-0 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-title font-bold text-sm text-text truncate">{sceneName}</h3>
          <button onClick={onOpenMapNotes} title="Notas do mapa" className="focus-ring p-1 rounded-ui text-text-muted hover:text-text hover:bg-surface-2 cursor-pointer">
            <Notebook className="w-4 h-4" />
          </button>
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span className="font-data tabular-nums">
            {usedCount}/{steps.length} passos usados
          </span>
          <button
            onClick={() => {
              if (window.confirm("Reiniciar o preparo deste mapa? Todos os passos e itens voltam a pendente.")) void usePrep.getState().resetPrep(sceneId);
            }}
            className="focus-ring flex items-center gap-1 px-1.5 py-1 rounded-ui hover:bg-surface-2 hover:text-text cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" /> Reiniciar
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-2">
        {status === "loading" && steps.length === 0 && <p className="text-xs text-text-muted p-2">Carregando...</p>}
        {steps.map((step) => (
          <PrepStepCard
            key={step.id}
            step={step}
            steps={steps}
            sceneId={sceneId}
            scenes={scenes}
            pools={pools}
            resolvedNameOf={resolvedNameOf}
            iconForItem={iconForItem}
            describeItem={describeItem}
            runAndMark={runAndMark}
            runItems={runItemsOf(step)}
            runOne={(itemId) => runOneOf(step, itemId)}
            assets={assets}
            onAddItem={() => setAddItemStepId(step.id)}
          />
        ))}

        {creatingStep ? (
          <form
            className="flex items-center gap-1.5 p-2 rounded-ui border border-border bg-surface-1"
            onSubmit={(e) => {
              e.preventDefault();
              const title = newStepTitle.trim();
              if (title === "") return;
              void usePrep.getState().createStep(sceneId, title);
              setNewStepTitle("");
              setCreatingStep(false);
            }}
          >
            <input
              autoFocus
              value={newStepTitle}
              onChange={(e) => setNewStepTitle(e.target.value)}
              onBlur={() => {
                if (newStepTitle.trim() === "") setCreatingStep(false);
              }}
              placeholder="Título do passo..."
              className="focus-ring flex-1 min-w-0 rounded-ui border border-border bg-surface-2 px-2 py-1 text-sm text-text"
            />
            <button type="submit" className="focus-ring px-2 py-1 rounded-ui bg-accent text-bg text-xs font-bold cursor-pointer">
              Criar
            </button>
          </form>
        ) : (
          <button
            onClick={() => setCreatingStep(true)}
            className="focus-ring flex items-center justify-center gap-1.5 p-2 rounded-ui border border-dashed border-border text-text-muted hover:text-text hover:border-accent cursor-pointer text-sm"
          >
            <Plus className="w-4 h-4" /> Passo
          </button>
        )}
      </div>

      {addItemStepId && (
        <PrepAddItemDialog
          libraryItems={buildLibraryItemsFor({ assets, handouts, encounters, entries, macros, homebrewIds })}
          allCreatures={creatures}
          pins={Object.values(pins)}
          npcs={npcs}
          onAdd={(ref) => void usePrep.getState().addItem(addItemStepId, ref)}
          onClose={() => setAddItemStepId(null)}
        />
      )}
    </div>
  );
};

/** Combina as fontes do acervo pro seletor "+ Item" (só pra este diálogo — a grade do `LibraryDialog`
 *  usa `buildLibraryItems` do shared direto em RoomPage; aqui evitamos importar mais um shape de props). */
function buildLibraryItemsFor(input: {
  assets: Asset[];
  handouts: Handout[];
  encounters: ReturnType<typeof useEncounters.getState>["items"];
  entries: ReturnType<typeof useCompendium.getState>["entries"];
  macros: ReturnType<typeof useMacros.getState>["macros"];
  homebrewIds: string[];
}) {
  return buildLibraryItems({
    assets: input.assets,
    handouts: input.handouts,
    encounters: input.encounters,
    creatures: input.entries.filter((e) => e.type === "creature" && input.homebrewIds.includes(e.id)),
    macros: input.macros,
    favorites: [],
  });
}

// --- Card de passo ------------------------------------------------------------------------------

const PrepStepCard: React.FC<{
  step: PrepStep;
  steps: PrepStep[];
  sceneId: string;
  scenes: { id: string; name: string }[];
  pools: PrepRefPools;
  resolvedNameOf: (item: PrepItem) => string | null;
  iconForItem: (item: PrepItem, asset: Asset | undefined) => React.ComponentType<{ className?: string }>;
  describeItem: (item: PrepItem, resolvedName: string, assetKind?: Asset["kind"]) => string;
  runAndMark: (stepId: string, item: PrepItem) => Promise<{ ok: boolean; error?: string }>;
  /** Itens automáticos já descritos e o executor de um deles — montados pelo hook (`usePrepRunner`). */
  runItems: PrepRunItem[];
  runOne: (itemId: string) => Promise<{ ok: boolean; error?: string }>;
  assets: Asset[];
  onAddItem: () => void;
}> = ({ step, steps, sceneId, scenes, pools, resolvedNameOf, iconForItem, describeItem, runAndMark, runItems, runOne, assets, onAddItem }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [title, setTitle] = useState(step.title);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(step.notes);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copySubmenu, setCopySubmenu] = useState(false);
  const [runOpen, setRunOpen] = useState(false);

  useEffect(() => setTitle(step.title), [step.title]);
  useEffect(() => setNotes(step.notes), [step.notes]);

  // Alvo de soltura "arrastar do acervo pra um passo" (§2.7) — registra/desregistra com o card.
  useEffect(() => {
    return registerDropTarget<unknown>({
      id: `prep-step:${step.id}`,
      accepts: () => true,
      onDrop: (entry) => {
        const ref = refFromDroppedLibraryEntry(entry);
        if (ref) void usePrep.getState().addItem(step.id, ref);
      },
    });
  }, [step.id]);

  return (
    <div className="rounded-ui border border-border bg-surface-1 overflow-hidden" draggable onDragStart={(e) => e.dataTransfer.setData("text/prep-step", step.id)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
      const draggedStepId = e.dataTransfer.getData("text/prep-step");
      if (draggedStepId && draggedStepId !== step.id) {
        const ids = steps.map((s) => s.id);
        const from = ids.indexOf(draggedStepId);
        const to = ids.indexOf(step.id);
        if (from !== -1 && to !== -1) {
          const next = [...ids];
          next.splice(from, 1);
          next.splice(to, 0, draggedStepId);
          void usePrep.getState().reorderSteps(sceneId, next);
        }
        return;
      }
      // Fallback de "mover item pra este passo" quando o drop não caiu exatamente sobre outra
      // linha de item (ex.: passo vazio) — a linha de item já trata o caso "sobre outra linha" e
      // para a propagação antes de chegar aqui.
      const rawItem = e.dataTransfer.getData("text/prep-item");
      if (!rawItem) return;
      try {
        const { itemId, fromStepId } = JSON.parse(rawItem) as { itemId: string; fromStepId: string };
        void usePrep.getState().moveItem(fromStepId, itemId, step.id, step.items.length);
      } catch {
        /* payload de outro tipo de arrasto, ignora */
      }
    }}>
      <div className="flex items-center gap-1 px-2 py-1.5 bg-surface-2">
        <GripVertical className="w-3.5 h-3.5 text-text-muted shrink-0 cursor-grab" />
        <button onClick={() => setCollapsed((c) => !c)} className="focus-ring shrink-0 text-text-muted hover:text-text cursor-pointer">
          {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {editingTitle ? (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              setEditingTitle(false);
              if (title.trim() !== "" && title !== step.title) void usePrep.getState().updateStep(step.id, { title: title.trim() });
              else setTitle(step.title);
            }}
            className="focus-ring flex-1 min-w-0 rounded-ui border border-border bg-surface-1 px-1.5 py-0.5 text-sm text-text"
          />
        ) : (
          <button onClick={() => setEditingTitle(true)} className="flex-1 min-w-0 text-left text-sm font-bold text-text truncate cursor-text">
            {step.title}
          </button>
        )}
        {step.used && <Check className="w-3.5 h-3.5 text-success shrink-0" />}
        <div className="relative shrink-0">
          <button onClick={() => setMenuOpen((v) => !v)} className="focus-ring p-1 rounded-ui text-text-muted hover:text-text hover:bg-surface-1 cursor-pointer">
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-20 w-48 rounded-ui border border-border bg-surface-1 shadow-float py-1 text-sm" onMouseLeave={() => setCopySubmenu(false)}>
              <button
                onClick={() => {
                  void usePrep.getState().copyStep(step.id, sceneId).then((res) => {
                    if (res?.brokenPinRefs) toast("Pino(s) do passo não foram copiados (são deste mapa)");
                  });
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-2 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" /> Duplicar
              </button>
              <div className="relative">
                <button onClick={() => setCopySubmenu((v) => !v)} className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-left hover:bg-surface-2 cursor-pointer">
                  <span className="flex items-center gap-2">
                    <Copy className="w-3.5 h-3.5" /> Copiar para outro mapa
                  </span>
                  <ChevronRight className="w-3 h-3" />
                </button>
                {copySubmenu && (
                  <div className="absolute left-full top-0 ml-1 w-40 rounded-ui border border-border bg-surface-1 shadow-float py-1 max-h-56 overflow-y-auto">
                    {scenes.filter((sc) => sc.id !== sceneId).map((sc) => (
                      <button
                        key={sc.id}
                        onClick={() => {
                          void usePrep.getState().copyStep(step.id, sc.id).then((res) => {
                            if (res?.brokenPinRefs) toast(`Pino(s) não copiados pra "${sc.name}" (são deste mapa)`);
                          });
                          setMenuOpen(false);
                          setCopySubmenu(false);
                        }}
                        className="w-full text-left px-2.5 py-1.5 truncate hover:bg-surface-2 cursor-pointer"
                      >
                        {sc.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  void usePrep.getState().updateStep(step.id, { used: !step.used });
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-surface-2 cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" /> Marcar {step.used ? "pendente" : "usado"}
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`Apagar o passo "${step.title}"?`)) void usePrep.getState().deleteStep(sceneId, step.id);
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-danger hover:bg-surface-2 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" /> Apagar
              </button>
            </div>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="p-2 flex flex-col gap-2">
          {editingNotes ? (
            <textarea
              autoFocus
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                setEditingNotes(false);
                if (notes !== step.notes) void usePrep.getState().updateStep(step.id, { notes });
              }}
              placeholder="Nota (markdown leve: **negrito**, *itálico*, # título, - lista, > citação)"
              className="focus-ring w-full h-20 resize-none rounded-ui border border-border bg-surface-2 px-2 py-1 text-xs text-text"
            />
          ) : step.notes.trim() === "" ? (
            <button onClick={() => setEditingNotes(true)} className="text-left text-xs text-text-muted italic hover:text-text cursor-text">
              Adicionar nota...
            </button>
          ) : (
            <button onClick={() => setEditingNotes(true)} className="text-left cursor-text">
              <LightMarkdownView source={step.notes} className="text-xs text-text flex flex-col gap-1" />
            </button>
          )}

          <div className="flex flex-col gap-1" data-drop-target={`prep-step:${step.id}`}>
            {step.items.map((item) => {
              const asset = assetOfItem(item, assets);
              return (
                <PrepItemRow
                  key={item.id}
                  stepId={step.id}
                  item={item}
                  broken={!resolvePrepRef(item.ref, pools)}
                  resolvedName={resolvedNameOf(item)}
                  Icon={iconForItem(item, asset)}
                  assetKind={asset?.kind}
                  description={describeItem(item, resolvedNameOf(item) ?? item.label, asset?.kind)}
                  onRun={() => void runAndMark(step.id, item)}
                />
              );
            })}
            {step.items.length === 0 && <p className="text-xs text-text-muted italic px-1">Nenhum item — arraste do acervo ou use "+ Item".</p>}
          </div>

          <div className="flex items-center gap-2">
            <button onClick={onAddItem} className="focus-ring flex items-center gap-1 px-2 py-1 rounded-ui border border-border text-xs text-text-muted hover:text-text hover:border-accent cursor-pointer">
              <Plus className="w-3 h-3" /> Item
            </button>
            <button
              onClick={() => setRunOpen(true)}
              className="focus-ring flex items-center gap-1 px-2 py-1 rounded-ui bg-accent text-bg text-xs font-bold cursor-pointer"
            >
              <Play className="w-3 h-3" /> Iniciar este passo
            </button>
          </div>
        </div>
      )}

      {runOpen && (
        <PrepRunDialog
          items={runItems}
          runOne={runOne}
          onFinished={(ranAtLeastOnce) => {
            setRunOpen(false);
            if (ranAtLeastOnce) void usePrep.getState().updateStep(step.id, { used: true });
          }}
        />
      )}
    </div>
  );
};

// --- Item de passo -------------------------------------------------------------------------------

const PrepItemRow: React.FC<{
  stepId: string;
  item: PrepItem;
  broken: boolean;
  resolvedName: string | null;
  Icon: React.ComponentType<{ className?: string }>;
  assetKind?: Asset["kind"];
  description: string;
  onRun: () => void;
}> = ({ stepId, item, broken, resolvedName, Icon, assetKind, description, onRun }) => {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={`flex items-center gap-1.5 px-1.5 py-1 rounded-ui ${broken ? "border border-danger/50 bg-danger/5" : "hover:bg-surface-2"}`}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/prep-item", JSON.stringify({ itemId: item.id, fromStepId: stepId }))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const raw = e.dataTransfer.getData("text/prep-item");
        if (!raw) return;
        e.stopPropagation();
        try {
          const { itemId, fromStepId } = JSON.parse(raw) as { itemId: string; fromStepId: string };
          if (itemId === item.id) return;
          void usePrep.getState().moveItem(fromStepId, itemId, stepId, 0);
        } catch {
          /* payload de outro tipo de arrasto, ignora */
        }
      }}
    >
      {broken ? <Link2Off className="w-3.5 h-3.5 text-danger shrink-0" /> : <Icon className="w-3.5 h-3.5 text-text-muted shrink-0" />}
      <button
        onClick={() => void usePrep.getState().updateItem(stepId, item.id, { used: !item.used })}
        title={item.used ? "Marcar pendente" : "Marcar usado"}
        className={`focus-ring w-3.5 h-3.5 shrink-0 rounded-full border cursor-pointer ${item.used ? "bg-success border-success" : "border-border"}`}
      />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-xs ${broken ? "text-danger" : "text-text"}`}>{resolvedName ?? item.label}</p>
        {broken && <p className="text-[10px] text-danger">Apagado do acervo</p>}
      </div>
      <button
        onClick={() => void usePrep.getState().updateItem(stepId, item.id, { auto: !item.auto })}
        title={item.auto ? "Entra em \"Iniciar este passo\"" : "Não entra em \"Iniciar este passo\""}
        className={`focus-ring shrink-0 text-xs cursor-pointer ${item.auto ? "text-accent" : "text-text-muted/40"}`}
      >
        <Zap className="w-3.5 h-3.5" />
      </button>
      {item.ref.kind !== "note" && (
        <button
          disabled={broken}
          onClick={onRun}
          title={description.replace(/\*\*?/g, "")}
          className="focus-ring shrink-0 p-1 rounded-ui text-text-muted hover:text-accent hover:bg-surface-1 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
        >
          <Play className="w-3.5 h-3.5" />
        </button>
      )}
      <div className="relative shrink-0">
        <button onClick={() => setMenuOpen((v) => !v)} className="focus-ring p-1 rounded-ui text-text-muted hover:text-text hover:bg-surface-1 cursor-pointer">
          <MoreVertical className="w-3.5 h-3.5" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full mt-1 z-20 w-44 rounded-ui border border-border bg-surface-1 shadow-float py-1 text-xs">
            <ItemOptionsControls stepId={stepId} item={item} assetKind={assetKind} />
            <button
              onClick={() => {
                void usePrep.getState().removeItem(stepId, item.id);
                setMenuOpen(false);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-danger hover:bg-surface-2 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" /> Remover do passo
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

/** Só os campos que fazem sentido pro `ref.kind` (§2.1) — o resto do menu nem aparece. */
const ItemOptionsControls: React.FC<{ stepId: string; item: PrepItem; assetKind?: Asset["kind"] }> = ({ stepId, item, assetKind }) => {
  const patch = (next: Partial<PrepItemOptions>) => void usePrep.getState().updateItem(stepId, item.id, { options: { ...item.options, ...next } });
  if (item.ref.kind === "encounter" || item.ref.kind === "creature") {
    return (
      <>
        <label className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-surface-2">
          <input type="checkbox" checked={item.options.hidden ?? false} onChange={(e) => patch({ hidden: e.target.checked })} />
          Soltar invisível
        </label>
        {item.ref.kind === "creature" && (
          <label className="flex items-center gap-2 px-2.5 py-1.5">
            Cópias
            <input
              type="number"
              min={1}
              max={20}
              value={item.options.count ?? 1}
              onChange={(e) => patch({ count: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
              className="w-14 rounded-ui border border-border bg-surface-2 px-1"
            />
          </label>
        )}
      </>
    );
  }
  if (item.ref.kind === "asset" && assetKind === "audio") {
    return (
      <label className="flex items-center gap-2 px-2.5 py-1.5">
        Modo
        <select value={item.options.audioMode ?? "loop"} onChange={(e) => patch({ audioMode: e.target.value as "loop" | "once" })} className="rounded-ui border border-border bg-surface-2 px-1 py-0.5">
          <option value="loop">Loop</option>
          <option value="once">Uma vez</option>
        </select>
      </label>
    );
  }
  return null;
};

/** Reconhece o registro original arrastado do acervo (mesma técnica de VttCanvas#accepts) e monta
 *  o `PrepRef` correspondente. */
function refFromDroppedLibraryEntry(entry: unknown): PrepRef | null {
  if (typeof entry !== "object" || entry === null) return null;
  const e = entry as Record<string, unknown>;
  if ("kind" in e && typeof e.kind === "string" && ["map", "token", "audio"].includes(e.kind) && "url" in e) {
    return { kind: "asset", assetId: e.id as string };
  }
  if ("kind" in e && (e.kind === "image" || e.kind === "text") && "tags" in e) {
    return { kind: "handout", handoutId: e.id as string };
  }
  if ("entries" in e) {
    return { kind: "encounter", encounterId: e.id as string };
  }
  if ("type" in e && e.type === "creature") {
    return { kind: "creature", entryId: e.id as string };
  }
  return null;
}
