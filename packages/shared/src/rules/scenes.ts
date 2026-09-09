/**
 * Múltiplos mapas por sala (docs/plano-mapas.md): ordem, nomeação de cópias, quem pode carregar
 * tokens ao ativar e quando um mapa pode ser apagado. Funções puras, sem I/O — mesmo padrão de
 * rules/combat.ts e rules/placement.ts; quem persiste é o servidor (socket/scene.ts).
 */
import type { Character } from "../schemas/character.js";
import type { Scene } from "../schemas/scene.js";
import type { Token } from "../schemas/token.js";

const MAX_SCENE_NAME = 80;

// --- Ordem -------------------------------------------------------------------------------------

/** Ordena por `order` crescente, desempatando por `createdAt` (dados legados/backfill com `order` repetido). */
export function orderScenes<T extends Pick<Scene, "order" | "createdAt">>(scenes: T[]): T[] {
  return [...scenes].sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

/** Próximo `order` livre pra um mapa novo: sempre maior que todos os já existentes (lista vazia = 0). */
export function nextSceneOrder(scenes: Pick<Scene, "order">[]): number {
  return scenes.length === 0 ? 0 : Math.max(...scenes.map((s) => s.order)) + 1;
}

export type ReorderScenesResult =
  | { ok: true; order: { sceneId: string; order: number }[] }
  | { ok: false; error: string };

/**
 * Renumera 0..n-1 seguindo `requestedIds`. Rejeita (sem devolver nada pra escrever) se o conjunto
 * não bater EXATAMENTE com os mapas atuais (`current`, já sem os apagados): id faltando, id
 * repetido, ou id de fora — mesmo espírito de `combat:reorder` (rules/combat.ts não tem essa
 * checagem porque ela vive direto no handler; aqui vira função pura porque `scene:reorder` some da
 * pilha de undo, então a validação é a única rede de segurança).
 */
export function reorderScenes(current: Pick<Scene, "id">[], requestedIds: string[]): ReorderScenesResult {
  const unique = new Set(requestedIds);
  if (unique.size !== requestedIds.length) return { ok: false, error: "A lista não pode repetir mapas" };
  const known = new Set(current.map((s) => s.id));
  if (unique.size !== known.size || !requestedIds.every((id) => known.has(id))) {
    return { ok: false, error: "A nova ordem precisa conter todos os mapas da sala, sem repetir" };
  }
  return { ok: true, order: requestedIds.map((sceneId, order) => ({ sceneId, order })) };
}

// --- Duplicar ------------------------------------------------------------------------------------

/**
 * Cópia de um mapa: `mapUrl/mapWidth/mapHeight`, `grid`, `fog` (todas as shapes) e `arrival` vêm
 * junto; tokens e combate NÃO (nem existem no tipo `Scene` — só há o que copiar aqui). `id`,
 * `name`, `order` e `createdAt` são de fora (o servidor decide o id/timestamp de verdade).
 */
export function duplicateScene(scene: Scene, opts: { id: string; name: string; order: number; createdAt: string }): Scene {
  return {
    ...scene,
    id: opts.id,
    name: opts.name,
    order: opts.order,
    createdAt: opts.createdAt,
  };
}

/** "Taverna" -> "Cópia de Taverna"; de novo -> "Cópia de Taverna (2)", respeitando o limite de 80 chars do schema. */
export function duplicateSceneName(existing: string[], original: string): string {
  const base = truncateSceneName(`Cópia de ${original}`);
  if (!existing.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = truncateSceneName(`${base} (${n})`);
    if (!existing.includes(candidate)) return candidate;
  }
}

function truncateSceneName(name: string): string {
  return name.length <= MAX_SCENE_NAME ? name : name.slice(0, MAX_SCENE_NAME);
}

// --- Ativar: "Levar para o mapa" ------------------------------------------------------------------

export interface CarryCandidate {
  tokenId: string;
  /** "player" = ficha/dono de jogador (pré-marcado, não dá pra desmarcar por engano sem querer);
   *  "selected" = só estava selecionado no mapa quando o GM clicou em Ativar. */
  reason: "player" | "selected";
}

/**
 * Pré-marcação do diálogo "Levar para o mapa": token de jogador (tem `ownerId`, ou ficha vinculada
 * `kind: "pc"` mesmo sem dono no token) e token selecionado no mapa na hora do clique. Um token que
 * vale pelos dois motivos aparece uma vez só, com `reason: "player"` (é o motivo que não devia ser
 * desmarcado à toa).
 */
export function pickTokensToCarry(opts: {
  tokens: Pick<Token, "id" | "ownerId" | "characterId">[];
  selectedIds: string[];
  characters: Pick<Character, "id" | "kind">[];
}): CarryCandidate[] {
  const pcCharacterIds = new Set(opts.characters.filter((c) => c.kind === "pc").map((c) => c.id));
  const selected = new Set(opts.selectedIds);
  const out: CarryCandidate[] = [];
  for (const token of opts.tokens) {
    const isPlayerToken = token.ownerId !== null || (token.characterId !== null && pcCharacterIds.has(token.characterId));
    if (isPlayerToken) out.push({ tokenId: token.id, reason: "player" });
    else if (selected.has(token.id)) out.push({ tokenId: token.id, reason: "selected" });
  }
  return out;
}

// --- Apagar mapa -----------------------------------------------------------------------------

export type CanDeleteScene =
  | { ok: true }
  | { ok: false; blocked: "active" | "last" }
  | { ok: false; needsConfirm: true; playerTokenIds: string[] };

/**
 * Pode apagar este mapa? Checado NESTA ordem: (1) é o único mapa da sala — bloqueado mesmo que,
 * por invariante, isso implique que ele também é o ativo (mensagem melhor: "a sala precisa de pelo
 * menos um mapa" em vez de "ative outro antes"); (2) é o mapa ativo (com outros mapas disponíveis) —
 * bloqueado, o GM ativa outro antes; (3) tem token de jogador — pede confirmação (o chamador decide
 * mover pra onde, ver docs/plano-mapas.md §8); senão, pode apagar.
 */
export function canDeleteScene(opts: {
  sceneId: string;
  activeSceneId: string | null;
  /** Quantos mapas não apagados a sala tem (inclusive este). */
  sceneCount: number;
  tokens: Pick<Token, "id" | "ownerId" | "characterId">[];
  characters: Pick<Character, "id" | "kind">[];
}): CanDeleteScene {
  if (opts.sceneCount <= 1) return { ok: false, blocked: "last" };
  if (opts.sceneId === opts.activeSceneId) return { ok: false, blocked: "active" };
  const playerTokenIds = pickTokensToCarry({ tokens: opts.tokens, selectedIds: [], characters: opts.characters })
    .filter((c) => c.reason === "player")
    .map((c) => c.tokenId);
  if (playerTokenIds.length > 0) return { ok: false, needsConfirm: true, playerTokenIds };
  return { ok: true };
}
