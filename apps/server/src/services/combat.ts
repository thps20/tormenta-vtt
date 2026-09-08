/**
 * Modo de combate (docs/plano-combate.md): carregar, ordenar+filtrar por visibilidade,
 * emitir e as poucas regras de permissão que dependem do banco (as regras de ordem/turno
 * em si são puras, em packages/shared/src/rules/combat.ts).
 */
import type { Character as DbCharacter, Combat as DbCombat, Combatant as DbCombatant, Token as DbToken } from "@prisma/client";
import {
  buildCharacterRoll,
  characterTiebreakBonus,
  getSystemDefinition,
  isPointRevealed,
  noSheetInitiativeFormula,
  normalizeOrder,
  sortCombatants,
  stateAfterRemoval,
  tokenCenter,
  type Combat,
  type Combatant,
  type CombatStatus,
  type FogConfig,
  type SystemDefinition,
  type Token,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { HandlerError } from "../socket/ack.js";
import { rooms, type TypedServer } from "../socket/types.js";
import { toCharacter } from "./characters.js";
import { toScene, toToken } from "./serialize.js";
import { tokenVisibleTo } from "./visibility.js";

export interface Viewer {
  role: "gm" | "player";
  participantId: string;
}

export type CombatantRow = DbCombatant & { token: DbToken };
export type CombatRow = DbCombat & { combatants: CombatantRow[] };

/** Carrega o combate da cena (com combatentes + o token de cada um). null = nenhum combate ali. */
export async function loadCombatRow(sceneId: string): Promise<CombatRow | null> {
  return prisma.combat.findUnique({ where: { sceneId }, include: { combatants: { include: { token: true } } } });
}

/** Carrega e confirma que o combate é desta sala. */
export async function requireCombat(sceneId: string, roomId: string): Promise<CombatRow> {
  const row = await loadCombatRow(sceneId);
  if (!row || row.roomId !== roomId) throw new HandlerError("Não há combate nesta cena");
  return row;
}

/** Confirma que a cena é a cena ATIVA da sala (combate só existe na cena ativa; ver docs/plano-combate.md §2). */
export async function requireActiveScene(roomId: string, sceneId: string): Promise<void> {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room || room.activeSceneId !== sceneId) throw new HandlerError("Só é possível ter combate na cena ativa da sala");
}

/** Carrega o combate da cena ATIVA da sala (todo evento de combate, exceto combat:start, opera nela). */
export async function requireActiveCombat(roomId: string): Promise<CombatRow> {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room?.activeSceneId) throw new HandlerError("Nenhuma cena ativa");
  return requireCombat(room.activeSceneId, roomId);
}

/**
 * Ficha vinculada ao combatente (a partir do TOKEN atual, não do `characterId` congelado no
 * combatente): se o vínculo mudou depois que o combatente entrou no combate, é o vínculo atual
 * que manda em "quem controla" e em qual fórmula de iniciativa usar.
 */
export async function linkedCharacter(token: DbToken): Promise<DbCharacter | null> {
  if (!token.characterId) return null;
  return prisma.character.findUnique({ where: { id: token.characterId } });
}

/** GM pode tudo; jogador só controla combatente cujo token é dele, ou cuja ficha vinculada é dele. */
export function canControlCombatant(viewer: Viewer, token: Pick<DbToken, "ownerId">, character: Pick<DbCharacter, "ownerId"> | null): boolean {
  if (viewer.role === "gm") return true;
  if (token.ownerId === viewer.participantId) return true;
  if (character && character.ownerId === viewer.participantId) return true;
  return false;
}

/**
 * Combate pronto para UM destinatário: já ordenado (sortCombatants) e filtrado pela
 * visibilidade (jogador só recebe combatentes cujo token pode ver — mesmo filtro de
 * token/névoa de sempre). Jogador vê o valor numérico (`initiative`/`bonus`) só do PRÓPRIO
 * combatente (token que possui), e mesmo assim não quando a última rolagem foi às cegas
 * (`lastRollVisibility === "gm"` — mesma regra de "rolagem às cegas" do chat: quem rolou não
 * vê o próprio resultado). Dos demais combatentes, só a ORDEM (nome, `rolled`). GM vê tudo
 * sempre. Ver docs/plano-combate.md §4 e docs/revisao-combate.md §1.
 */
export function toCombat(row: CombatRow, def: SystemDefinition, viewer: Viewer, fog: FogConfig): Combat {
  const sorted = sortCombatants(def, row.combatants);
  const visible = viewer.role === "gm" ? sorted : sorted.filter((cr) => tokenVisibleTo(toToken(cr.token), viewer, fog));
  const isGm = viewer.role === "gm";
  const combatants: Combatant[] = visible.map((cr) => {
    const mine = !isGm && cr.token.ownerId === viewer.participantId;
    const showValue = isGm || (mine && cr.lastRollVisibility !== "gm");
    return {
      id: cr.id,
      tokenId: cr.tokenId,
      characterId: cr.characterId,
      name: cr.token.name,
      color: cr.token.color,
      ownerId: cr.token.ownerId,
      initiative: showValue ? cr.initiative : null,
      rolled: cr.initiative !== null,
      bonus: showValue ? cr.bonus : null,
      delayed: cr.delayed,
      surprised: cr.surprised,
      order: cr.order,
      addedRound: cr.addedRound,
    };
  });
  return { id: row.id, sceneId: row.sceneId, round: row.round, status: row.status as CombatStatus, activeCombatantId: row.activeCombatantId, combatants };
}

/**
 * Recarrega o combate da cena ATIVA da sala e emite `combat:updated` para o GM e,
 * individualmente, para cada jogador (a visibilidade de cada um pode ser diferente:
 * é dono de um token oculto pela névoa pros outros, por exemplo). `null` quando a
 * sala não tem cena ativa, ou a cena ativa não tem combate — zera quem tinha um antes
 * (ex.: `combat:end { clear: true }`, ou trocar de cena — o cliente já refaz room:join).
 *
 * Devolve a visão de QUEM CHAMOU (`caller`), pro handler usar como resposta do ack:
 * nunca devolvemos a visão do GM pra um jogador, mesmo que ele tenha disparado o lote.
 */
export async function emitCombat(io: TypedServer, roomId: string, caller: Viewer): Promise<Combat | null> {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room?.activeSceneId) {
    io.to(rooms.all(roomId)).emit("combat:updated", null);
    return null;
  }

  const def = getSystemDefinition(room.systemId);
  const [row, sceneRow, players] = await Promise.all([
    loadCombatRow(room.activeSceneId),
    prisma.scene.findUniqueOrThrow({ where: { id: room.activeSceneId } }),
    prisma.participant.findMany({ where: { roomId, role: "player" } }),
  ]);

  if (!row) {
    io.to(rooms.all(roomId)).emit("combat:updated", null);
    return null;
  }

  const fog = toScene(sceneRow).fog;
  const gmView = toCombat(row, def, { role: "gm", participantId: "" }, fog);
  io.to(rooms.gm(roomId)).emit("combat:updated", gmView);
  for (const p of players) {
    io.to(rooms.participant(p.id)).emit("combat:updated", toCombat(row, def, { role: "player", participantId: p.id }, fog));
  }

  return caller.role === "gm" ? gmView : toCombat(row, def, caller, fog);
}

/** Fórmula + rótulo da iniciativa de um combatente: pela ficha vinculada (token atual), ou sem ficha (bônus manual). */
export async function buildCombatantInitiativeRoll(
  def: SystemDefinition,
  row: CombatantRow,
): Promise<{ formula: string; label: string; characterId?: string }> {
  const character = await linkedCharacter(row.token);
  if (character) {
    const c = toCharacter(character);
    const built = buildCharacterRoll(def, c, { type: "initiative" });
    return { formula: built.formula, label: `${c.name}: ${built.label}`, characterId: c.id };
  }
  return { formula: noSheetInitiativeFormula(def, row.bonus), label: `${row.token.name}: Iniciativa` };
}

/** Bônus de desempate ao entrar no combate: da ficha vinculada (se houver), senão 0 (GM ajusta à mão). */
export async function initialBonusFor(def: SystemDefinition, token: DbToken): Promise<number> {
  const character = await linkedCharacter(token);
  if (!character) return 0;
  try {
    return characterTiebreakBonus(def, toCharacter(character));
  } catch {
    return 0; // fórmula de desempate com placeholder que essa ficha não resolve: não trava a entrada no combate.
  }
}

/** Reordena `list` (na ordem em que já está, por `order` crescente) e persiste `order` compactado 0..n-1. */
export async function persistNormalizedOrder(list: CombatantRow[]): Promise<void> {
  const renumbered = normalizeOrder([...list].sort((a, b) => a.order - b.order));
  await Promise.all(renumbered.map((c) => prisma.combatant.update({ where: { id: c.id }, data: { order: c.order } })));
}

/**
 * Chamado ANTES de `prisma.token.delete`: se o token tem um combatente neste combate, ajusta o
 * cursor de turno (`stateAfterRemoval`) e recompacta `order` — o cascade da FK apaga a linha do
 * Combatant quando o token for de fato apagado logo em seguida, então isso não pode esperar.
 * Trata "remoção do combatente ativo" (caso de borda não coberto pelo `combat:remove` original,
 * já que apagar o token nunca passava por ali — ver docs/revisao-combate.md).
 */
export async function prepareTokenRemovalFromCombat(def: SystemDefinition, combat: CombatRow, tokenId: string): Promise<void> {
  const combatant = combat.combatants.find((c) => c.tokenId === tokenId);
  if (!combatant) return;
  const nextState = stateAfterRemoval(
    def,
    combat.combatants,
    { activeCombatantId: combat.activeCombatantId, round: combat.round },
    new Set([combatant.id]),
  );
  await prisma.combat.update({ where: { id: combat.id }, data: { activeCombatantId: nextState.activeCombatantId, round: nextState.round } });
  await persistNormalizedOrder(combat.combatants.filter((c) => c.id !== combatant.id));
}

/**
 * `token:update` reemite o combate só quando algo que a lista mostra de fato mudou: nome, cor,
 * `visible`, ou a posição cruzou a fronteira da névoa (não a cada tick de um arraste comum —
 * ver docs/plano-combate.md §4). Não faz nada se o token não é combatente de combate nenhum.
 */
export async function maybeReemitCombatForToken(io: TypedServer, roomId: string, before: Token, after: Token, fog: FogConfig): Promise<void> {
  const nameOrColorChanged = before.name !== after.name || before.color !== after.color;
  const visibleChanged = before.visible !== after.visible;
  const moved = before.x !== after.x || before.y !== after.y;
  const crossedFog = !nameOrColorChanged && !visibleChanged && moved && isPointRevealed(fog, tokenCenter(before)) !== isPointRevealed(fog, tokenCenter(after));
  if (!nameOrColorChanged && !visibleChanged && !crossedFog) return;

  const combatant = await prisma.combatant.findFirst({ where: { tokenId: after.id }, select: { id: true } });
  if (!combatant) return;
  await emitCombat(io, roomId, { role: "gm", participantId: "" });
}
