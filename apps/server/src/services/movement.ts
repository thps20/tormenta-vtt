/**
 * Orçamento de deslocamento por turno (docs/plano-movimento.md): resolver o orçamento de um
 * combatente, iniciar o turno dele (zera gasto, ancora, reinicia caminho) e validar cada movimento
 * do combatente DA VEZ contra a âncora — tudo puro em `packages/shared/src/rules/movement.ts`, aqui
 * é só I/O (ler ficha/token/combate, persistir, reemitir).
 */
import type { Combatant as DbCombatant, Token as DbToken } from "@prisma/client";
import {
  applyStep,
  computeCharacter,
  computeMovementBudget,
  fitsInBudget,
  movementBase,
  movementRemaining,
  type MovementState,
  type SystemDefinition,
  type TokenPatch,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { HandlerError, type Ctx } from "../socket/ack.js";
import { type TypedServer } from "../socket/types.js";
import { toCharacter } from "./characters.js";
import { emitCombat, linkedCharacter } from "./combat.js";
import { isMovementLimitEnabled } from "./movementLimit.js";
import { toScene } from "./serialize.js";

/** Pontos demais deixariam a linha do caminho pesada à toa: passando disso, o ponto mais novo
 *  substitui o último em vez de empilhar — o desenho perde um pouco de detalhe, os números
 *  (gasto/orçamento) continuam exatos (não dependem do caminho). */
const MOVEMENT_PATH_MAX = 200;

type MovementPoint = { x: number; y: number };

function pathOf(combatant: Pick<DbCombatant, "movementPath">): MovementPoint[] {
  return Array.isArray(combatant.movementPath) ? (combatant.movementPath as MovementPoint[]) : [];
}

function pushPoint(path: MovementPoint[], point: MovementPoint): MovementPoint[] {
  return path.length >= MOVEMENT_PATH_MAX ? [...path.slice(0, -1), point] : [...path, point];
}

/**
 * Orçamento de um combatente: `derived[def.movement.derived]` da ficha vinculada ao TOKEN atual, ou
 * `movement.default` (token sem ficha). Só chamada quando `def.movement` existe (quem chama já
 * conferiu — ver `startTurnMovement`).
 */
export async function resolveBudget(def: SystemDefinition, token: DbToken): Promise<number> {
  const movementDef = def.movement;
  if (!movementDef) return 0;
  const character = await linkedCharacter(token);
  const derived = character ? computeCharacter(def, toCharacter(character)).derived : null;
  const base = movementBase(def, { derived }) ?? movementDef.default;
  // Lista de modificadores vazia: é o gancho para condições (Lento/Imóvel) automatizarem o efeito
  // depois — fora deste plano, ver rules/movement.ts.
  return computeMovementBudget(base, []);
}

/**
 * Chamado sempre que um combatente vira o da vez (`combat:next`/`prev`/`delay`/`resume`, e a
 * remoção do ativo, `stateAfterRemoval`): resolve o orçamento fresco, zera o gasto/diagonais do
 * turno anterior e ancora a medição na posição ATUAL do token (D2 — nunca no fim de um arraste ao
 * vivo, porque quem chama isto roda fora do fluxo de `token:update`). Sistema sem `movement`: só
 * zera o resto (o orçamento fica null — nada pra mostrar).
 */
export async function startTurnMovement(def: SystemDefinition, combatantId: string): Promise<void> {
  const combatant = await prisma.combatant.findUnique({ where: { id: combatantId }, include: { token: true } });
  if (!combatant) return;
  const budget = def.movement ? await resolveBudget(def, combatant.token) : null;
  const anchor: MovementPoint = { x: combatant.token.x, y: combatant.token.y };
  await prisma.combatant.update({
    where: { id: combatantId },
    data: { movementBudget: budget, movementUsed: 0, movementDiagonals: 0, movementAnchorX: anchor.x, movementAnchorY: anchor.y, movementPath: [anchor] },
  });
}

/** Chama `startTurnMovement` só quando o combatente ativo de fato MUDOU para outro (não null) —
 *  evita reiniciar o orçamento de quem já estava agindo (ex.: `combat:remove` que não tocou no ativo). */
export async function startTurnMovementIfChanged(def: SystemDefinition, before: string | null, after: string | null): Promise<void> {
  if (after && after !== before) await startTurnMovement(def, after);
}

export interface MovementCommit {
  /** Grava o gasto/âncora/caminho novos e reemite `combat:updated` do mapa. Chamar SÓ no patch
   *  final do gesto (sem `patch.live`) — ver docs/plano-movimento.md D2. */
  commit: () => Promise<void>;
}

/**
 * Valida um `token:update`/`update-many` contra o orçamento de deslocamento do combate ativo do
 * mapa do token. Só roda quando o patch mexe em x/y; devolve `null` quando não há nada a checar
 * (sem combate, token fora do combate, sistema/cena sem regra de deslocamento, ou a trava da sala
 * está desligada — "ignora limite": nesse caso NINGUÉM consome orçamento, GM incluso, então uma
 * sessão inteira com a trava desligada não deixa `movementUsed` residual pra travar alguém depois
 * que ela for religada). Lança `HandlerError` quando o passo não cabe no orçamento.
 */
export async function checkMovement(io: TypedServer, def: SystemDefinition, ctx: Ctx, tokenRow: DbToken, patch: TokenPatch): Promise<MovementCommit | null> {
  if (patch.x === undefined && patch.y === undefined) return null;

  const combat = await prisma.combat.findUnique({ where: { sceneId: tokenRow.sceneId }, select: { id: true, status: true, activeCombatantId: true } });
  if (!combat || combat.status !== "active") return null;

  const combatant = await prisma.combatant.findUnique({ where: { combatId_tokenId: { combatId: combat.id, tokenId: tokenRow.id } } });
  if (!combatant) return null; // D3: token fora do combate, movimento livre

  if (combat.activeCombatantId !== combatant.id) {
    // Não é o combatente da vez: jogador nem pode tentar; GM pode reposicionar livremente (não
    // consome — não é o turno de ninguém em particular, não há orçamento a debitar).
    if (ctx.role !== "gm") throw new HandlerError("Não é o seu turno");
    return null;
  }

  const sceneRow = await prisma.scene.findUniqueOrThrow({ where: { id: tokenRow.sceneId } });
  const grid = toScene(sceneRow).grid;
  if (!def.movement || !def.grid || grid.type === "none" || !isMovementLimitEnabled(ctx.roomId)) return null;

  const cellSizePx = grid.cellSize;
  const anchorX = combatant.movementAnchorX ?? tokenRow.x;
  const anchorY = combatant.movementAnchorY ?? tokenRow.y;
  const destX = patch.x ?? tokenRow.x;
  const destY = patch.y ?? tokenRow.y;
  const dxCells = (destX - anchorX) / cellSizePx;
  const dyCells = (destY - anchorY) / cellSizePx;

  const state: MovementState = { used: combatant.movementUsed, diagonals: combatant.movementDiagonals };
  const budget = combatant.movementBudget ?? 0;
  if (!fitsInBudget(def, budget, state, dxCells, dyCells)) {
    const remaining = Math.round(movementRemaining(budget, state) * 10) / 10;
    throw new HandlerError(`Deslocamento insuficiente: restam ${remaining} ${def.grid.unit}`);
  }

  return {
    commit: async () => {
      const next = applyStep(def, state, dxCells, dyCells);
      const path = pushPoint(pathOf(combatant), { x: destX, y: destY });
      await prisma.combatant.update({
        where: { id: combatant.id },
        data: { movementUsed: next.used, movementDiagonals: next.diagonals, movementAnchorX: destX, movementAnchorY: destY, movementPath: path },
      });
      await emitCombat(io, ctx.roomId, tokenRow.sceneId, { role: "gm", participantId: "" });
    },
  };
}
