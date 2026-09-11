import { create } from "zustand";
import type { EncounterPatch, SavedEncounter, SavedEncounterEntry } from "@tormenta-vtt/shared";
import { dropTargetAt, type DropPoint } from "../lib/dropTargets";
import { emitAck } from "./connection";
import { useCombat } from "./combat";
import { useTokens } from "./tokens";
import { toast } from "./ui";

/** Item do carrinho (§9.14): uma criatura + quantidade, antes de virar SavedEncounterEntry ao salvar. */
export interface EncounterCartItem {
  entryId: string;
  count: number;
}

/** Opções de "soltar" (checkboxes do EncounterPreview): reaproveitam combat:add/start/roll — nada de novo no servidor. */
export interface EncounterSpawnOptions {
  startCombat: boolean;
  rollNpcInitiative: boolean;
}

interface EncountersState {
  items: SavedEncounter[];
  status: "idle" | "loading" | "ready" | "error";

  /** Carrinho de "salvar encontro a partir da paleta": só em memória, reseta ao trocar de sala. */
  cart: EncounterCartItem[];

  /** Checkboxes do EncounterPreview: vivem aqui (não como estado local do componente) porque o
   *  drop no mapa (VttCanvas) também precisa deles ao soltar arrastando — mesmo motivo de
   *  spawnCount/spawnInvisible em store/compendium.ts. */
  spawnStartCombat: boolean;
  spawnRollNpcInitiative: boolean;

  /** Arrasto de um encontro pro mapa (mesmo mecanismo de store/compendium.ts, cartão próprio porque
   *  o que se arrasta aqui é um SavedEncounter, não uma CompendiumEntry). */
  drag: { encounterId: string; point: DropPoint; targetId: string | null } | null;

  load: () => Promise<void>;
  create: (payload: { name: string; tags: string[]; notes: string; entries: SavedEncounterEntry[] }) => Promise<SavedEncounter | null>;
  createFromCart: (name: string, tags: string[], notes: string) => Promise<SavedEncounter | null>;
  createFromTokens: (tokenIds: string[], name: string, tags: string[], notes: string) => Promise<boolean>;
  duplicate: (encounter: SavedEncounter) => Promise<SavedEncounter | null>;
  update: (id: string, patch: EncounterPatch) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  /** Solta o encontro inteiro na cena; encadeia combat:add/start + combat:roll se pedido (§9.14). */
  spawn: (id: string, sceneId: string, point: { x: number; y: number }, opts: EncounterSpawnOptions) => Promise<boolean>;

  addToCart: (entryId: string, count?: number) => void;
  setCartCount: (entryId: string, count: number) => void;
  removeFromCart: (entryId: string) => void;
  clearCart: () => void;
  setSpawnStartCombat: (v: boolean) => void;
  setSpawnRollNpcInitiative: (v: boolean) => void;

  // Broadcasts (bindSocket) — idempotentes, mesma função cobre o eco otimista das ações acima.
  upsert: (encounter: SavedEncounter) => void;
  removeLocal: (id: string) => void;

  startDrag: (encounterId: string, point: DropPoint) => void;
  moveDrag: (point: DropPoint) => void;
  endDrag: () => boolean;
  cancelDrag: () => void;

  reset: () => void;
}

export const useEncounters = create<EncountersState>((set, get) => ({
  items: [],
  status: "idle",
  cart: [],
  spawnStartCombat: false,
  spawnRollNpcInitiative: false,
  drag: null,

  load: async () => {
    if (get().status === "loading" || get().status === "ready") return;
    set({ status: "loading" });
    const res = await emitAck("encounter:list", {});
    if (!res.ok) {
      set({ status: "error" });
      toast(res.error);
      return;
    }
    set({ items: res.data, status: "ready" });
  },

  create: async (payload) => {
    const res = await emitAck("encounter:create", payload);
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsert(res.data);
    return res.data;
  },

  createFromCart: async (name, tags, notes) => {
    const entries: SavedEncounterEntry[] = get().cart.map((c) => ({ entryId: c.entryId, count: c.count, visibleOnSpawn: true, nameOverride: null }));
    if (entries.length === 0) return null;
    const encounter = await get().create({ name, tags, notes, entries });
    if (encounter) get().clearCart();
    return encounter;
  },

  createFromTokens: async (tokenIds, name, tags, notes) => {
    const res = await emitAck("encounter:create-from-tokens", { tokenIds, name, tags, notes });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    get().upsert(res.data.encounter);
    if (res.data.ignoredTokens > 0) {
      toast(`${res.data.ignoredTokens} token(s) selecionado(s) não vieram do compêndio e não entraram no encontro`);
    }
    return true;
  },

  duplicate: (encounter) => get().create({ name: `${encounter.name} (cópia)`, tags: encounter.tags, notes: encounter.notes, entries: encounter.entries }),

  update: async (id, patch) => {
    const res = await emitAck("encounter:update", { id, patch });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    get().upsert(res.data);
    return true;
  },

  remove: async (id) => {
    const res = await emitAck("encounter:delete", { id });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    get().removeLocal(id);
    return true;
  },

  spawn: async (id, sceneId, point, opts) => {
    const res = await emitAck("encounter:spawn", { id, sceneId, x: point.x, y: point.y });
    if (!res.ok) {
      toast(res.error);
      return false;
    }
    const { tokens, skippedEntryIds } = res.data;
    // Os broadcasts character:created/token:created também chegam; o upsert é idempotente.
    for (const token of tokens) useTokens.getState().upsert(token);
    if (skippedEntryIds.length > 0) {
      toast(`${skippedEntryIds.length} criatura(s) do encontro não existem mais no compêndio e não foram soltas`);
    }
    if (tokens.length === 0) return true;

    // "Iniciar combate"/"rolar iniciativa dos NPCs" reaproveitam combat:add|start + combat:roll —
    // passo à parte, fora da transação/undo do spawn (mesma regra de sempre: spawn nunca entra
    // sozinho no combate, §9.5/§9.14). Falha aqui não desfaz o spawn: o GM usa os botões normais do
    // painel de combate pra terminar à mão, igual a qualquer soltura avulsa.
    if (opts.startCombat) {
      const tokenIds = tokens.map((t) => t.id);
      const hasCombat = useCombat.getState().byScene[sceneId] != null;
      const ok = hasCombat ? await useCombat.getState().addCombatants({ sceneId, tokenIds }) : await useCombat.getState().start({ sceneId, tokenIds });
      if (ok && opts.rollNpcInitiative) await useCombat.getState().roll({ sceneId, scope: "npcs" });
    }
    return true;
  },

  addToCart: (entryId, count = 1) =>
    set((s) => {
      const existing = s.cart.find((c) => c.entryId === entryId);
      if (!existing) return { cart: [...s.cart, { entryId, count: Math.min(20, Math.max(1, count)) }] };
      return { cart: s.cart.map((c) => (c.entryId === entryId ? { ...c, count: Math.min(20, c.count + count) } : c)) };
    }),
  setCartCount: (entryId, count) => set((s) => ({ cart: s.cart.map((c) => (c.entryId === entryId ? { ...c, count: Math.min(20, Math.max(1, count)) } : c)) })),
  removeFromCart: (entryId) => set((s) => ({ cart: s.cart.filter((c) => c.entryId !== entryId) })),
  clearCart: () => set({ cart: [] }),
  setSpawnStartCombat: (v) => set({ spawnStartCombat: v, spawnRollNpcInitiative: v ? get().spawnRollNpcInitiative : false }),
  setSpawnRollNpcInitiative: (v) => set({ spawnRollNpcInitiative: v }),

  upsert: (encounter) => set((s) => ({ items: s.items.some((e) => e.id === encounter.id) ? s.items.map((e) => (e.id === encounter.id ? encounter : e)) : [...s.items, encounter] })),
  removeLocal: (id) => set((s) => ({ items: s.items.filter((e) => e.id !== id) })),

  startDrag: (encounterId, point) => set({ drag: { encounterId, point, targetId: null } }),
  moveDrag: (point) => {
    const { drag, items } = get();
    const encounter = drag ? items.find((e) => e.id === drag.encounterId) : undefined;
    if (!drag || !encounter) return;
    set({ drag: { ...drag, point, targetId: dropTargetAt(point, encounter)?.id ?? null } });
  },
  endDrag: () => {
    const { drag, items } = get();
    const encounter = drag ? items.find((e) => e.id === drag.encounterId) : undefined;
    const target = drag && encounter ? dropTargetAt(drag.point, encounter) : null;
    set({ drag: null });
    if (!drag || !encounter || !target) return false;
    target.onDrop(encounter, drag.point);
    return true;
  },
  cancelDrag: () => set({ drag: null }),

  reset: () => set({ items: [], status: "idle", cart: [], spawnStartCombat: false, spawnRollNpcInitiative: false, drag: null }),
}));
