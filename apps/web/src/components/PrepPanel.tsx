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
import { TOKEN_COLORS } from "./TokenInspector";
import { useLibrary } from "../store/library";
import { useHandouts } from "../store/handouts";
import { useEncounters } from "../store/encounters";
import { useCompendium } from "../store/compendium";
import { useMacros } from "../store/macros";
import { usePins } from "../store/pins";
import { useCharacters } from "../store/characters";
import { useTokens } from "../store/tokens";
import { useRoom } from "../store/room";
import { usePrep } from "../store/prep";
import { useAudio } from "../store/audio";
import { toast } from "../store/ui";
import { LightMarkdownView } from "./LightMarkdownView";
import { PrepAddItemDialog } from "./PrepAddItemDialog";
import { PrepRunDialog, type PrepRunItem } from "./PrepRunDialog";

/** Cópia denormalizada do cartão a partir de um pino de handout (mesmo formato de RoomPage#pinToCard). */
function pinToCard(pin: Pin & { kind: "image" | "text" }): HandoutCard {
  return pin.kind === "image"
    ? { handoutId: pin.handoutId, name: pin.name, kind: "image", imageUrl: pin.imageUrl, width: pin.width, height: pin.height }
    : { handoutId: pin.handoutId, name: pin.name, kind: "text", text: pin.text };
}

function pinLabel(pin: Pin): string {
  return pin.kind === "note" ? pin.title : pin.name;
}

/** Referência estável pro fallback "nenhum passo carregado ainda" (ver `steps` abaixo): um `?? []`
 *  dentro do próprio seletor do Zustand cria um array NOVO a cada chamada — como o hook usa
 *  `useSyncExternalStore` por baixo, uma referência diferente a cada render convence o React de
 *  que a store "mudou" de novo, disparando outro render, que cria outro array novo, ad infinitum
 *  ("Maximum update depth exceeded"). Reaproveitando esta constante o `Object.is` do React vê a
 *  MESMA referência quando não há passos, e o loop não acontece. */
const EMPTY_STEPS: PrepStep[] = [];

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

/** `item.ref.kind === "asset" ? assets.find(...) : undefined` perde a narrowing de `ref` dentro do
 *  closure de `.find` (limitação do TS: closure aninhado não herda a narrowing de um property
 *  access do escopo externo) — por isso vira uma função à parte, com `ref` já extraído. */
function assetOfItem(item: PrepItem, assets: Asset[]): Asset | undefined {
  const ref = item.ref;
  return ref.kind === "asset" ? assets.find((a) => a.id === ref.assetId) : undefined;
}

function iconForItem(item: PrepItem, asset: Asset | undefined): React.ComponentType<{ className?: string }> {
  if (item.ref.kind === "asset") return asset?.kind === "audio" ? Music : asset?.kind === "token" ? UserRound : MapIcon;
  return KIND_ICON[item.ref.kind];
}

/** Descrição curta pra "Iniciar este passo" e pra ação principal do item — mesma redação do §2.3. */
function describeItem(item: PrepItem, resolvedName: string, assetKind?: Asset["kind"]): string {
  switch (item.ref.kind) {
    case "asset":
      if (assetKind === "audio") return `▶ Tocar *${resolvedName}* (${item.options.audioMode === "once" ? "uma vez" : "loop"})`;
      if (assetKind === "map") return `🗺 Usar *${resolvedName}* como fundo`;
      return `👤 Soltar token *${resolvedName}*`;
    case "handout":
      return `👁 Mostrar *${resolvedName}*`;
    case "encounter":
      return `⚔ Soltar *${resolvedName}*${item.options.hidden ? " invisível" : ""}`;
    case "creature":
      return `⚔ Soltar ${item.options.count ?? 1}x *${resolvedName}*${item.options.hidden ? " invisível" : ""}`;
    case "macro":
      return `🎲 Rolar *${resolvedName}*`;
    case "pin":
      return `📍 Abrir *${resolvedName}*`;
    case "npc":
      return `📖 Abrir ficha de *${resolvedName}*`;
    case "note":
      return `📝 ${resolvedName}`;
  }
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
  const steps = usePrep((s) => s.stepsByScene[sceneId] ?? EMPTY_STEPS);
  const status = usePrep((s) => s.statusByScene[sceneId] ?? "idle");
  const loadSteps = usePrep((s) => s.loadSteps);

  useEffect(() => {
    void loadSteps(sceneId);
  }, [sceneId, loadSteps]);

  // Resolver referência (§2.6) depende de 4 bibliotecas carregadas SOB DEMANDA em outro lugar
  // (Acervo/Handouts/Encontros salvos/Compêndio — cada uma só carrega quando o próprio diálogo
  // abre, mesmo padrão de sempre no projeto). A aba Preparo é uma consumidora NOVA dessas listas
  // que não passa por nenhum desses diálogos, então precisa garantir o carregamento sozinha —
  // senão um GM que abre "Preparo" antes de "Acervo" (ex: entrou de novo na sala, ou só usa o
  // preparo) veria toda referência de asset/handout/encontro/criatura homebrew como "quebrada" por
  // engano (a lista local está vazia, não porque a coisa foi apagada). Roda uma vez só; cada
  // store já se protege sozinha contra recarregar em cima de "loading"/dado igual.
  useEffect(() => {
    if (useLibrary.getState().assetsStatus === "idle") void useLibrary.getState().loadAssets();
    if (useHandouts.getState().libraryStatus === "idle") void useHandouts.getState().loadLibrary();
    if (useEncounters.getState().status === "idle") void useEncounters.getState().load();
    if (useCompendium.getState().status === "idle") void useCompendium.getState().load();
  }, []);

  // --- Dados de resolução (§2.6): pools de ids existentes + as listas em si pra nome/ação --------
  const assets = useLibrary((s) => s.assets);
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

  const pools: PrepRefPools = useMemo(
    () => ({
      assetIds: assets.map((a) => a.id),
      handoutIds: handouts.map((h) => h.id),
      encounterIds: encounters.map((e) => e.id),
      creatureIds: creatures.map((e) => e.id),
      macroIds: macros.map((m) => m.id),
      pinIds: Object.keys(pins),
      npcIds: npcs.map((n) => n.id),
    }),
    [assets, handouts, encounters, creatures, macros, pins, npcs],
  );

  const resolvedNameOf = (item: PrepItem): string | null => {
    const ref = item.ref;
    switch (ref.kind) {
      case "asset":
        return assets.find((a) => a.id === ref.assetId)?.name ?? null;
      case "handout":
        return handouts.find((h) => h.id === ref.handoutId)?.name ?? null;
      case "encounter":
        return encounters.find((e) => e.id === ref.encounterId)?.name ?? null;
      case "creature":
        return creatures.find((e) => e.id === ref.entryId)?.name ?? null;
      case "macro":
        return macros.find((m) => m.id === ref.macroId)?.label ?? null;
      case "pin": {
        const pin = pins[ref.pinId];
        return pin ? pinLabel(pin) : null;
      }
      case "npc":
        return charactersById[ref.characterId]?.name ?? null;
      case "note":
        return ref.text;
    }
  };

  // --- Executa a ação principal de UM item (§2.2) — usada tanto pelo botão do item quanto por
  //     "Iniciar este passo". Marca `used:true` no sucesso (chamador decide se quer aguardar). -----
  const runItemAction = async (item: PrepItem): Promise<{ ok: boolean; error?: string }> => {
    if (!resolvePrepRef(item.ref, pools)) return { ok: false, error: "Apagado do acervo" };
    const ref = item.ref;
    try {
      switch (ref.kind) {
        case "asset": {
          const asset = assets.find((a) => a.id === ref.assetId);
          if (!asset) return { ok: false, error: "Apagado do acervo" };
          if (asset.kind === "map") {
            if (!window.confirm(`Usar "${asset.name}" como fundo deste mapa?`)) return { ok: false, error: "Cancelado" };
            const ok = await useRoom.getState().setMap({ mapUrl: asset.url, mapWidth: asset.width, mapHeight: asset.height });
            return ok ? { ok: true } : { ok: false, error: "Falha ao trocar o mapa" };
          }
          if (asset.kind === "token") {
            const point = getViewportCenter();
            const n = Object.keys(useTokens.getState().byId).length + 1;
            const created = await useTokens.getState().create({
              sceneId,
              name: asset.name,
              imageUrl: asset.url,
              x: point.x,
              y: point.y,
              cells: 1,
              rotation: 0,
              zIndex: n,
              visible: true,
              ownerId: null,
              hp: null,
              conditions: [],
              color: TOKEN_COLORS[(n - 1) % TOKEN_COLORS.length] ?? "#e11d48",
            });
            if (created) useTokens.getState().select(created.id);
            return created ? { ok: true } : { ok: false, error: "Falha ao criar o token" };
          }
          // Áudio (etapa 6, store/audio.ts): toca via useAudio, mesmo contrato {ok, error?}.
          const ok = await useAudio.getState().play(asset.id, item.options.audioMode !== "once");
          return ok ? { ok: true } : { ok: false, error: "Falha ao tocar o áudio" };
        }
        case "handout": {
          const ok = await useHandouts.getState().show(ref.handoutId, "all");
          return ok ? { ok: true } : { ok: false, error: "Falha ao mostrar" };
        }
        case "encounter": {
          const point = getViewportCenter();
          const ok = await useEncounters.getState().spawn(ref.encounterId, sceneId, point, { startCombat: false, rollNpcInitiative: false, forceHidden: item.options.hidden });
          return ok ? { ok: true } : { ok: false, error: "Falha ao soltar" };
        }
        case "creature": {
          const point = getViewportCenter();
          const result = await useTokens.getState().spawnFromCompendium({
            sceneId,
            entryId: ref.entryId,
            count: item.options.count ?? 1,
            visible: !item.options.hidden,
            x: point.x,
            y: point.y,
          });
          return result ? { ok: true } : { ok: false, error: "Falha ao soltar" };
        }
        case "macro": {
          const macro = macros.find((m) => m.id === ref.macroId);
          if (!macro) return { ok: false, error: "Apagado do acervo" };
          await useMacros.getState().run(macro);
          return { ok: true };
        }
        case "pin": {
          const pin = pins[ref.pinId];
          if (!pin) return { ok: false, error: "Apagado do acervo" };
          usePins.getState().select(pin.id);
          if (pin.kind === "note") onOpenNotePin(pin as Pin & { kind: "note" });
          else useHandouts.getState().openLocal(null, pinToCard(pin as Pin & { kind: "image" | "text" }));
          return { ok: true };
        }
        case "npc": {
          if (!charactersById[ref.characterId]) return { ok: false, error: "Apagado do acervo" };
          useCharacters.getState().open(ref.characterId);
          return { ok: true };
        }
        case "note":
          return { ok: true };
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Falha inesperada" };
    }
  };

  const runAndMark = async (stepId: string, item: PrepItem): Promise<{ ok: boolean; error?: string }> => {
    const result = await runItemAction(item);
    if (result.ok) void usePrep.getState().updateItem(stepId, item.id, { used: true });
    return result;
  };

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
  assets: Asset[];
  onAddItem: () => void;
}> = ({ step, steps, sceneId, scenes, pools, resolvedNameOf, iconForItem, describeItem, runAndMark, assets, onAddItem }) => {
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

  const runItems: PrepRunItem[] = step.items
    .filter((i) => i.auto)
    .map((i) => {
      const name = resolvedNameOf(i);
      const broken = !resolvePrepRef(i.ref, pools);
      const assetKind = assetOfItem(i, assets)?.kind;
      return { id: i.id, description: broken ? `${describeItem(i, i.label, assetKind)} — Apagado do acervo` : describeItem(i, name ?? i.label, assetKind) };
    });

  const runOne = async (itemId: string) => {
    const item = step.items.find((i) => i.id === itemId);
    if (!item) return { ok: false, error: "Item não encontrado" };
    if (!resolvePrepRef(item.ref, pools)) return { ok: false, error: "Apagado do acervo" };
    return runAndMark(step.id, item);
  };

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
