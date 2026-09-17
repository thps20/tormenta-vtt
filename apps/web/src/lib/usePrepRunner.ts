import { useEffect, useMemo } from "react";
import type { Asset, HandoutCard, Pin, PrepItem, PrepStep } from "@tormenta-vtt/shared";
import { resolvePrepRef, type PrepRefPools } from "@tormenta-vtt/shared";
import { TOKEN_COLORS } from "../components/TokenInspector";
import { useAudio } from "../store/audio";
import { useCharacters } from "../store/characters";
import { useCompendium } from "../store/compendium";
import { useEncounters } from "../store/encounters";
import { useHandouts } from "../store/handouts";
import { useLibrary } from "../store/library";
import { useMacros } from "../store/macros";
import { usePins } from "../store/pins";
import { usePrep } from "../store/prep";
import { useRoom } from "../store/room";
import { useTokens } from "../store/tokens";

/**
 * Resolução e execução do preparo de um mapa (docs/plano-preparo.md §2.2/§2.6), fora da UI: era
 * tudo interno ao `PrepPanel`, e agora dois lugares precisam do mesmo comportamento — o painel de
 * edição (gaveta) e o card "Próximo passo" do painel lateral (docs/SPEC.md §9.28). Nenhuma ação é
 * reimplementada aqui: cada item chama a MESMA store que o botão manual chamaria.
 */

export type PrepRunResult = { ok: boolean; error?: string };

/** Item do passo já descrito em texto, pro diálogo de execução (`PrepRunDialog`). */
export interface PrepRunItem {
  id: string;
  description: string;
}

/** Cópia denormalizada do cartão a partir de um pino de handout (mesmo formato de RoomPage#pinToCard). */
export function pinToCard(pin: Pin & { kind: "image" | "text" }): HandoutCard {
  return pin.kind === "image"
    ? { handoutId: pin.handoutId, name: pin.name, kind: "image", imageUrl: pin.imageUrl, width: pin.width, height: pin.height }
    : { handoutId: pin.handoutId, name: pin.name, kind: "text", text: pin.text };
}

export function pinLabel(pin: Pin): string {
  return pin.kind === "note" ? pin.title : pin.name;
}

/** `item.ref.kind === "asset" ? assets.find(...) : undefined` perde a narrowing de `ref` dentro do
 *  closure de `.find` (limitação do TS: closure aninhado não herda a narrowing de um property
 *  access do escopo externo) — por isso é uma função à parte, com `ref` já extraído. */
export function assetOfItem(item: PrepItem, assets: Asset[]): Asset | undefined {
  const ref = item.ref;
  return ref.kind === "asset" ? assets.find((a) => a.id === ref.assetId) : undefined;
}

/** Descrição curta pra "Iniciar este passo" e pra ação principal do item — redação do §2.3. */
export function describeItem(item: PrepItem, resolvedName: string, assetKind?: Asset["kind"]): string {
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

/** Referência estável pro fallback "nenhum passo carregado ainda": um `?? []` dentro do seletor do
 *  Zustand cria um array NOVO a cada chamada e, com `useSyncExternalStore` por baixo, isso convence
 *  o React de que a store mudou de novo a cada render ("Maximum update depth exceeded"). */
const EMPTY_STEPS: PrepStep[] = [];

/**
 * Carrega as quatro bibliotecas de que a resolução de referência depende (acervo, handouts,
 * encontros salvos, compêndio). Elas são carregadas sob demanda pelos próprios diálogos; quem lê
 * preparo não passa por nenhum deles, e sem isso toda referência pareceria "apagada do acervo".
 * `await` de verdade: o card "Próximo passo" chama isto antes de abrir o diálogo de execução.
 */
export async function ensurePrepLibraries(): Promise<void> {
  const pending: Promise<unknown>[] = [];
  if (useLibrary.getState().assetsStatus === "idle") pending.push(useLibrary.getState().loadAssets());
  if (useHandouts.getState().libraryStatus === "idle") pending.push(useHandouts.getState().loadLibrary());
  if (useEncounters.getState().status === "idle") pending.push(useEncounters.getState().load());
  if (useCompendium.getState().status === "idle") pending.push(useCompendium.getState().load());
  await Promise.all(pending);
}

export interface UsePrepRunnerOptions {
  sceneId: string;
  /** Onde cai o que é solto no mapa ("centro da tela", igual ao spawn manual). */
  getViewportCenter: () => { x: number; y: number };
  /** Item `pin` de nota: quem monta decide como abrir o cartão. */
  onOpenNotePin: (pin: Pin & { kind: "note" }) => void;
  /** `true` (painel de edição) carrega as bibliotecas ao montar; `false` (card compacto) só carrega
   *  os passos, e deixa o `ensurePrepLibraries` do clique resolver o resto. */
  loadLibraries: boolean;
}

export interface PrepRunner {
  steps: PrepStep[];
  status: "idle" | "loading" | "ready" | "error";
  pools: PrepRefPools;
  assets: Asset[];
  resolvedNameOf: (item: PrepItem) => string | null;
  /** Executa a ação principal do item e marca `used` no sucesso. */
  runAndMark: (stepId: string, item: PrepItem) => Promise<PrepRunResult>;
  /** Itens automáticos (⚡) de um passo, já descritos — o que "Iniciar este passo" vai executar. */
  runItemsOf: (step: PrepStep) => PrepRunItem[];
  /** Executa UM item de um passo (o `runOne` do `PrepRunDialog`). */
  runOneOf: (step: PrepStep, itemId: string) => Promise<PrepRunResult>;
}

export function usePrepRunner({ sceneId, getViewportCenter, onOpenNotePin, loadLibraries }: UsePrepRunnerOptions): PrepRunner {
  const steps = usePrep((s) => s.stepsByScene[sceneId] ?? EMPTY_STEPS);
  const status = usePrep((s) => s.statusByScene[sceneId] ?? "idle");
  const loadSteps = usePrep((s) => s.loadSteps);

  useEffect(() => {
    void loadSteps(sceneId);
  }, [sceneId, loadSteps]);

  useEffect(() => {
    if (loadLibraries) void ensurePrepLibraries();
  }, [loadLibraries]);

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

  // --- Executa a ação principal de UM item (§2.2) — mesma store que o botão manual chamaria. -----
  const runItemAction = async (item: PrepItem): Promise<PrepRunResult> => {
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
          // Áudio (store/audio.ts): toca via useAudio, mesmo contrato {ok, error?}.
          const ok = await useAudio.getState().play(asset.id, item.options.audioMode !== "once");
          return ok ? { ok: true } : { ok: false, error: "Falha ao tocar o áudio" };
        }
        case "handout": {
          const ok = await useHandouts.getState().show(ref.handoutId, "all");
          return ok ? { ok: true } : { ok: false, error: "Falha ao mostrar" };
        }
        case "encounter": {
          const point = getViewportCenter();
          const ok = await useEncounters
            .getState()
            .spawn(ref.encounterId, sceneId, point, { startCombat: false, rollNpcInitiative: false, forceHidden: item.options.hidden });
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

  const runAndMark = async (stepId: string, item: PrepItem): Promise<PrepRunResult> => {
    const result = await runItemAction(item);
    if (result.ok) void usePrep.getState().updateItem(stepId, item.id, { used: true });
    return result;
  };

  const runItemsOf = (step: PrepStep): PrepRunItem[] =>
    step.items
      .filter((i) => i.auto)
      .map((i) => {
        const name = resolvedNameOf(i);
        const broken = !resolvePrepRef(i.ref, pools);
        const assetKind = assetOfItem(i, assets)?.kind;
        return { id: i.id, description: broken ? `${describeItem(i, i.label, assetKind)} — Apagado do acervo` : describeItem(i, name ?? i.label, assetKind) };
      });

  const runOneOf = async (step: PrepStep, itemId: string): Promise<PrepRunResult> => {
    const item = step.items.find((i) => i.id === itemId);
    if (!item) return { ok: false, error: "Item não encontrado" };
    if (!resolvePrepRef(item.ref, pools)) return { ok: false, error: "Apagado do acervo" };
    return runAndMark(step.id, item);
  };

  return { steps, status, pools, assets, resolvedNameOf, runAndMark, runItemsOf, runOneOf };
}
