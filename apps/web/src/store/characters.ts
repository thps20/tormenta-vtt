import { create } from "zustand";
import type { Character, CharacterCreatePayload, CharacterPatch, CharacterRollRequest, EnhancementUse, SystemDefinition } from "@tormenta-vtt/shared";
import { buildInsertPatch, checkInsert } from "../lib/compendium";
import { newId } from "../lib/ids";
import { emitAck } from "./connection";
import { notifyBlindRoll, useChat } from "./chat";
import { useCompendium } from "./compendium";
import { toast } from "./ui";

interface CharactersState {
  byId: Record<string, Character>;
  /** Ficha aberta na gaveta (estado de UI, não vem do servidor). */
  openId: string | null;
  /** Gaveta aberta no estado vazio ("crie seu personagem"), sem ficha. */
  emptyOpen: boolean;

  setAll: (characters: Character[]) => void;
  upsert: (character: Character) => void;
  remove: (characterId: string) => void;
  open: (characterId: string | null) => void;
  openEmpty: () => void;

  create: (payload: CharacterCreatePayload) => Promise<Character | null>;
  /** Otimista com ack e reversão. Patch raso: cada campo enviado substitui o campo inteiro. */
  update: (id: string, patch: CharacterPatch) => Promise<boolean>;
  delete: (characterId: string) => Promise<boolean>;
  /** Sem otimismo: a rolagem só existe depois do servidor (chega por chat:message). Usa o modo de rolagem do chat. */
  roll: (characterId: string, roll: CharacterRollRequest) => Promise<boolean>;
  /**
   * Usa um item ativo (poder, magia). Sem otimismo: o servidor desconta o custo
   * (character:updated) e publica o card (chat:message). Erro (ex.: PM insuficiente) vira toast.
   */
  /** Usa um item ativo; `enhancements` = aprimoramentos escolhidos no popover de conjuração. */
  useItem: (characterId: string, itemId: string, enhancements?: EnhancementUse[]) => Promise<boolean>;
  /**
   * Copia uma entrada do compêndio para a ficha (Enter, "+" e soltar chamam esta
   * mesma função). `def` vem do componente para a store não depender da sala.
   * `replace` confirma a troca de um item de tipo com limite (ex.: outra raça).
   * Devolve o id do item novo, ou null se não inseriu (motivo vira toast).
   */
  insertFromCompendium: (def: SystemDefinition, characterId: string, entryId: string, opts?: { replace?: boolean }) => Promise<string | null>;
}

export const useCharacters = create<CharactersState>((set, get) => ({
  byId: {},
  openId: null,
  emptyOpen: false,

  setAll: (characters) => set({ byId: Object.fromEntries(characters.map((c) => [c.id, c])) }),
  upsert: (character) => set((s) => ({ byId: { ...s.byId, [character.id]: character } })),
  remove: (characterId) =>
    set((s) => {
      const { [characterId]: _removed, ...rest } = s.byId;
      return { byId: rest, openId: s.openId === characterId ? null : s.openId };
    }),
  open: (characterId) => set({ openId: characterId, emptyOpen: false }),
  openEmpty: () => set({ openId: null, emptyOpen: true }),

  create: async (payload) => {
    const res = await emitAck("character:create", payload);
    if (!res.ok) {
      toast(res.error);
      return null;
    }
    get().upsert(res.data);
    return res.data;
  },

  update: async (id, patch) => {
    const previous = get().byId[id];
    if (!previous) return false;
    // 1. otimista (ignora chaves undefined para não apagar campos)
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    set((s) => ({ byId: { ...s.byId, [id]: { ...previous, ...clean } as Character } }));
    // 2. ack
    const res = await emitAck("character:update", { id, patch });
    if (!res.ok) {
      // 3. reverte
      set((s) => ({ byId: { ...s.byId, [id]: previous } }));
      toast(res.error);
      return false;
    }
    get().upsert(res.data);
    return true;
  },

  delete: async (characterId) => {
    const previous = get().byId[characterId];
    if (!previous) return false;
    get().remove(characterId);
    const res = await emitAck("character:delete", { characterId });
    if (!res.ok) {
      get().upsert(previous);
      toast(res.error);
      return false;
    }
    return true;
  },

  roll: async (characterId, roll) => {
    const res = await emitAck("character:roll", { characterId, roll, visibility: useChat.getState().rollMode });
    if (!res.ok) toast(res.error);
    else notifyBlindRoll(res.data);
    return res.ok;
  },

  useItem: async (characterId, itemId, enhancements = []) => {
    const res = await emitAck("character:use-item", { characterId, itemId, enhancements });
    if (!res.ok) toast(res.error);
    return res.ok;
  },

  insertFromCompendium: async (def, characterId, entryId, opts = {}) => {
    const character = get().byId[characterId];
    const entry = useCompendium.getState().entries.find((e) => e.id === entryId);
    if (!character || !entry) return null;
    // Criatura não se insere na ficha (vai para o mapa por compendium:spawn-creature).
    if (entry.type !== "item") return null;
    const check = checkInsert(def, character, entry);
    const replace = opts.replace ? check.replaces : null;
    if (!check.ok && !replace) {
      toast(check.reason ?? "Não é possível inserir este item");
      return null;
    }
    const { item, patch } = buildInsertPatch(def, character, entry, newId, { replace });
    const ok = await get().update(characterId, patch);
    if (!ok) return null;
    useCompendium.getState().markInserted(item.id, item.kind);
    return item.id;
  },
}));

/** Lista ordenada por nome. Função pura para useMemo (não use como seletor). */
export function sortedCharacters(byId: Record<string, Character>): Character[] {
  return Object.values(byId).sort((a, b) => a.name.localeCompare(b.name));
}

/** GM edita tudo; jogador só a ficha que possui (mesma regra do servidor). */
export function canEditCharacter(me: { id: string; role: "gm" | "player" }, c: Pick<Character, "ownerId">): boolean {
  return me.role === "gm" || (c.ownerId !== null && c.ownerId === me.id);
}
