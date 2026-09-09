import { Prisma } from "@prisma/client";
import {
  CharacterDataSchema,
  TokenApplyDamageSchema,
  TokenCreateSchema,
  TokenDeleteManySchema,
  TokenDeleteSchema,
  TokenHpSchema,
  TokenLinkCharacterSchema,
  TokenPatchSchema,
  TokenUpdateManySchema,
  applyResourceDelta,
  computeCharacter,
  type AppliedDamage,
  type FogConfig,
  type SystemDefinition,
  type Token,
  type TokenHp,
  type TokenPatch,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import {
  broadcastCharacter,
  canEditCharacter,
  characterDataOf,
  requireCharacter,
  requireSystem,
  toCharacter,
  toJson,
} from "../services/characters.js";
import { checkApplyDamageTarget } from "../services/applyDamage.js";
import { emitCombat, loadCombatRow, maybeReemitCombatForToken, prepareTokenRemovalFromCombat } from "../services/combat.js";
import { emitChatMessage, messageVisibleTo } from "../services/chatVisibility.js";
import {
  describeDelete,
  describeTokenChange,
  pushEntry,
  pickTrackableTokenPatch,
  type HistoryEntry,
  type TrackableTokenField,
  type TrackableTokenPatch,
} from "../services/history.js";
import { canEditToken, restrictPatchForRole } from "../services/permissions.js";
import { toChatMessage, toScene, toToken } from "../services/serialize.js";
import { canAccessScene, emitTokenToPlayers, isActiveScene } from "../services/visibility.js";
import { guarded, HandlerError, type Ctx } from "./ack.js";
import { emitHistoryUpdated } from "./history.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

/**
 * Carrega o token e confirma que a cena dele é desta sala. Um token soft-deleted
 * (docs/plano-desfazer.md §2) conta como "não encontrado" pra todo handler normal — só o
 * desfazer (services/history.ts) busca por baixo desse filtro, pra poder restaurá-lo.
 */
async function requireToken(tokenId: string, roomId: string) {
  const row = await prisma.token.findUnique({ where: { id: tokenId }, include: { scene: true } });
  if (!row || row.scene.roomId !== roomId || row.deletedAt !== null) throw new HandlerError("Token não encontrado");
  return row;
}

/**
 * Defesa em profundidade (docs/plano-mapas.md §11): jogador só mexe em token do mapa ATIVO da
 * sala — o cliente honesto nem tem os ids de token de um mapa que não é o ativo (não carrega esse
 * mapa), mas nada impede um cliente adulterado de tentar. GM mexe em qualquer mapa que esteja
 * vendo, sem essa checagem.
 */
async function requirePlayerTokenOnActiveScene(ctx: Ctx, sceneId: string): Promise<void> {
  if (ctx.role === "gm") return;
  const active = await isActiveScene(ctx.roomId, sceneId);
  if (!canAccessScene(ctx.role, active)) throw new HandlerError("Este token não está no mapa atual");
}

/** Json? do Prisma não aceita `null` cru (precisa de Prisma.JsonNull pra gravar SQL NULL). Também
 *  usado por socket/compendium.ts pra recriar um token no redo do spawn (§4 do plano). */
export function hpJson(hp: TokenHp | null): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return hp === null ? Prisma.JsonNull : hp;
}

/**
 * Broadcast respeitando visibilidade: GM recebe sempre (pode estar preparando um mapa que a mesa
 * ainda não vê); jogadores só recebem se o mapa do token é o ATIVO da sala (docs/plano-mapas.md §5)
 * E se puderem vê-lo (`visible` + névoa da cena), senão recebem token:deleted (caso tenham ele em
 * cache). Ver services/visibility.ts. A checagem de mapa ativo é assíncrona (mais uma consulta),
 * então roda fora do fluxo síncrono desta função — não muda a assinatura nos ~10 lugares que chamam.
 */
export function broadcastToken(io: TypedServer, roomId: string, token: Token, event: "token:created" | "token:updated", fog: FogConfig) {
  io.to(rooms.gm(roomId)).emit(event, token);
  void isActiveScene(roomId, token.sceneId).then((active) => {
    if (active) emitTokenToPlayers(io, roomId, token, event, fog);
  });
}

// --- token:update / token:update-many --------------------------------------------------------
// Compartilham a mesma lógica de aplicar UM patch (permissão, campos do jogador, validação de
// condições) — só muda quem chama e o que fazem com before/after depois (histórico, docs/plano-desfazer.md §3).

/**
 * Aplica um TokenPatch e devolve o token antes/depois (public Token, não a linha crua do Prisma).
 * `historyBefore` é o "antes" pra efeito de DIFF DE HISTÓRICO — normalmente igual a `before`, mas
 * com x/y trocados por `patch.dragFrom` quando presente: os ecos `live` do arraste já escreveram
 * no banco antes deste commit final, então `before` (lido agora) é só a posição de ~33ms atrás, não
 * a de início do gesto (docs/plano-desfazer.md §3). `before` "cru" continua sendo usado por
 * `maybeReemitCombatForToken` (que precisa do estado real anterior, não do início do gesto).
 */
async function applyTokenUpdate(io: TypedServer, ctx: Ctx, patch: TokenPatch): Promise<{ before: Token; after: Token; historyBefore: Token }> {
  const row = await requireToken(patch.id, ctx.roomId);
  if (!canEditToken(ctx, row)) throw new HandlerError("Você não controla este token");
  await requirePlayerTokenOnActiveScene(ctx, row.sceneId);

  const { id, sceneId: _ignoreScene, hp, live: _ignoreLive, dragFrom, ...fields } = restrictPatchForRole(ctx, patch);
  if (fields.ownerId) {
    const owner = await prisma.participant.findUnique({ where: { id: fields.ownerId } });
    if (!owner || owner.roomId !== ctx.roomId) throw new HandlerError("Dono inválido");
  }
  if (fields.conditions) {
    const def = await requireSystem(ctx.roomId);
    const known = new Set(def.conditions.map((c) => c.key));
    if (fields.conditions.some((c) => !known.has(c.key))) throw new HandlerError("Condição inexistente no sistema da sala");
  }
  const updatedRow = await prisma.token.update({ where: { id }, data: { ...fields, ...(hp !== undefined ? { hp: hpJson(hp) } : {}) } });
  const token = toToken(updatedRow);
  const fog = toScene(row.scene).fog;
  // A cena já veio junto com o token (requireToken): sem consulta extra a cada movimento.
  broadcastToken(io, ctx.roomId, token, "token:updated", fog);
  const before = toToken(row);
  // Nome/cor/visível mudaram, ou a posição cruzou a névoa: se este token é um combatente,
  // a lista de combate (e quem pode vê-la) pode ter mudado junto.
  await maybeReemitCombatForToken(io, ctx.roomId, before, token, fog);
  const historyBefore = dragFrom ? { ...before, x: dragFrom.x, y: dragFrom.y } : before;
  return { before, after: token, historyBefore };
}

interface TrackableDiffItem {
  tokenId: string;
  name: string;
  before: TrackableTokenPatch;
  after: TrackableTokenPatch;
}

/** Reaplica só os campos rastreados capturados (before OU after) num token — usado por revert/apply.
 *  Token sumido (limpeza definitiva, docs/plano-desfazer.md §8) invalida a entrada inteira (§7). */
async function writeTrackablePatch(io: TypedServer, roomId: string, tokenId: string, patch: TrackableTokenPatch): Promise<void> {
  const row = await prisma.token.findUnique({ where: { id: tokenId }, include: { scene: true } });
  if (!row || row.deletedAt !== null) throw new Error(`token "${tokenId}" não existe mais`);
  const fog = toScene(row.scene).fog;
  const updated = toToken(await prisma.token.update({ where: { id: tokenId }, data: patch }));
  broadcastToken(io, roomId, updated, "token:updated", fog);
  await maybeReemitCombatForToken(io, roomId, toToken(row), updated, fog);
}

/** Uma entrada de histórico pra 1..N tokens que tiveram campo(s) rastreado(s) mudado(s) na MESMA
 *  chamada de socket (token:update ou token:update-many, docs/plano-desfazer.md §3). */
function buildUpdateHistoryEntry(io: TypedServer, roomId: string, items: TrackableDiffItem[]): HistoryEntry {
  const subject = items.length === 1 ? (items[0] as TrackableDiffItem).name : `${items.length} tokens`;
  const fields = new Set(items.flatMap((i) => Object.keys(i.before))) as Set<TrackableTokenField>;
  return {
    summary: describeTokenChange(subject, fields),
    async revert() {
      for (const item of items) await writeTrackablePatch(io, roomId, item.tokenId, item.before);
    },
    async apply() {
      for (const item of items) await writeTrackablePatch(io, roomId, item.tokenId, item.after);
    },
  };
}

// --- token:delete / token:delete-many ---------------------------------------------------------

interface CombatRemovalSnapshot {
  combatId: string;
  round: number;
  activeCombatantId: string | null;
  /** `order` de CADA combatente do combate antes da remoção (não só do removido): a remoção
   *  renumera 0..n-1 os que ficam, então restaurar exige devolver a ordem de todo mundo. */
  orders: { combatantId: string; order: number }[];
}

/**
 * Se `tokenId` é combatente de um combate na cena, captura o estado ANTES de mexer (pro undo
 * restaurar) e então ajusta round/activeCombatantId/order exatamente como o handler já fazia
 * (`prepareTokenRemovalFromCombat`). `null` = token não é combatente de combate nenhum.
 * Exportada: socket/compendium.ts reusa (descartando o snapshot) no desfazer do spawn — um token
 * spawnado que depois entrou em combate (`combat:add`, manual) precisa do mesmo ajuste de
 * round/activeCombatantId/order antes do hard delete, senão o combate fica com um combatente
 * fantasma (docs/plano-desfazer.md §4).
 */
export async function adjustCombatForTokenRemoval(def: SystemDefinition, sceneId: string, tokenId: string): Promise<CombatRemovalSnapshot | null> {
  const combat = await loadCombatRow(sceneId);
  if (!combat) return null;
  const combatant = combat.combatants.find((c) => c.tokenId === tokenId);
  if (!combatant) return null;
  const snapshot: CombatRemovalSnapshot = {
    combatId: combat.id,
    round: combat.round,
    activeCombatantId: combat.activeCombatantId,
    orders: combat.combatants.map((c) => ({ combatantId: c.id, order: c.order })),
  };
  await prepareTokenRemovalFromCombat(def, combat, tokenId);
  return snapshot;
}

/** Reverte exatamente o snapshot capturado acima. */
async function restoreCombatSnapshot(snap: CombatRemovalSnapshot): Promise<void> {
  await prisma.combat.update({ where: { id: snap.combatId }, data: { round: snap.round, activeCombatantId: snap.activeCombatantId } });
  await Promise.all(snap.orders.map((o) => prisma.combatant.update({ where: { id: o.combatantId }, data: { order: o.order } })));
}

interface DeleteItem {
  tokenId: string;
  name: string;
  sceneId: string;
  combatSnapshot: CombatRemovalSnapshot | null;
}

/** Uma entrada de histórico pra 1..N tokens apagados na MESMA chamada de socket (token:delete ou
 *  token:delete-many, docs/plano-desfazer.md §2). `revert` faz soft-undelete + restaura o combate
 *  capturado; `apply` (redo) soft-deleta de novo e recalcula o ajuste de combate do zero — o
 *  estado já está de volta ao "antes" depois do revert, então dá o mesmo resultado sem precisar
 *  guardar um segundo snapshot "depois". */
function buildDeleteHistoryEntry(io: TypedServer, roomId: string, def: SystemDefinition, items: DeleteItem[]): HistoryEntry {
  return {
    summary: describeDelete(items.map((i) => i.name)),
    async revert() {
      // Um lote pode cobrir tokens de mapas diferentes (Delete em multi-seleção entre cenas não é
      // possível pela UI hoje, mas o handler não assume isso): reemite o combate de cada mapa
      // afetado, não só um.
      const affectedScenes = new Set<string>();
      for (const item of items) {
        const row = await prisma.token.update({ where: { id: item.tokenId }, data: { deletedAt: null } });
        const scene = await prisma.scene.findUniqueOrThrow({ where: { id: item.sceneId } });
        broadcastToken(io, roomId, toToken(row), "token:updated", toScene(scene).fog);
        if (item.combatSnapshot) {
          await restoreCombatSnapshot(item.combatSnapshot);
          affectedScenes.add(item.sceneId);
        }
      }
      for (const sceneId of affectedScenes) await emitCombat(io, roomId, sceneId, { role: "gm", participantId: "" });
    },
    async apply() {
      const affectedScenes = new Set<string>();
      for (const item of items) {
        const row = await prisma.token.findUnique({ where: { id: item.tokenId } });
        if (!row || row.deletedAt !== null) throw new Error(`token "${item.name}" não existe mais`);
        const snap = await adjustCombatForTokenRemoval(def, item.sceneId, item.tokenId);
        await prisma.token.update({ where: { id: item.tokenId }, data: { deletedAt: new Date() } });
        io.to(rooms.all(roomId)).emit("token:deleted", { tokenId: item.tokenId });
        if (snap) affectedScenes.add(item.sceneId);
      }
      for (const sceneId of affectedScenes) await emitCombat(io, roomId, sceneId, { role: "gm", participantId: "" });
    },
  };
}

export function registerTokenHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "token:create",
    guarded(socket, TokenCreateSchema, async (data, ctx) => {
      const scene = await prisma.scene.findUnique({ where: { id: data.sceneId } });
      if (!scene || scene.roomId !== ctx.roomId || scene.deletedAt !== null) throw new HandlerError("Mapa não encontrado");
      if (data.ownerId) {
        const owner = await prisma.participant.findUnique({ where: { id: data.ownerId } });
        if (!owner || owner.roomId !== ctx.roomId) throw new HandlerError("Dono inválido");
      }
      const token = toToken(await prisma.token.create({ data: { ...data, hp: hpJson(data.hp) } }));
      broadcastToken(io, ctx.roomId, token, "token:created", toScene(scene).fog);
      return token;
    }, { gmOnly: true }),
  );

  socket.on(
    "token:update",
    guarded(socket, TokenPatchSchema, async (patch, ctx) => {
      const { after, historyBefore } = await applyTokenUpdate(io, ctx, patch);
      // Ecos "ao vivo" do arraste (patch.live) nunca empilham — só o patch final do gesto.
      if (ctx.role === "gm" && !patch.live) {
        const diff = pickTrackableTokenPatch(historyBefore, after);
        if (diff) {
          pushEntry(ctx.roomId, buildUpdateHistoryEntry(io, ctx.roomId, [{ tokenId: after.id, name: after.name, ...diff }]));
          emitHistoryUpdated(io, ctx.roomId);
        }
      }
      return after;
    }),
  );

  socket.on(
    "token:update-many",
    guarded(socket, TokenUpdateManySchema, async ({ patches }, ctx) => {
      // Tudo-ou-nada: confere permissão de TODOS antes de aplicar qualquer um (mesmo padrão de
      // token:apply-damage) — o arraste em grupo não pode mover metade e travar na outra.
      const rows = await Promise.all(patches.map((p) => requireToken(p.id, ctx.roomId)));
      for (const row of rows) if (!canEditToken(ctx, row)) throw new HandlerError("Você não controla um dos tokens selecionados");

      const items: TrackableDiffItem[] = [];
      for (const patch of patches) {
        const { after, historyBefore } = await applyTokenUpdate(io, ctx, patch);
        const diff = pickTrackableTokenPatch(historyBefore, after);
        if (diff) items.push({ tokenId: after.id, name: after.name, ...diff });
      }
      if (ctx.role === "gm" && items.length > 0) {
        pushEntry(ctx.roomId, buildUpdateHistoryEntry(io, ctx.roomId, items));
        emitHistoryUpdated(io, ctx.roomId);
      }
    }),
  );

  socket.on(
    "token:delete",
    guarded(socket, TokenDeleteSchema, async ({ tokenId }, ctx) => {
      const row = await requireToken(tokenId, ctx.roomId);
      if (!canEditToken(ctx, row)) throw new HandlerError("Você não controla este token");
      await requirePlayerTokenOnActiveScene(ctx, row.sceneId);
      const def = await requireSystem(ctx.roomId);

      // Se o token é combatente de um combate, captura o estado (pro undo) e ajusta o cursor de
      // turno ANTES de marcar deletedAt: loadCombatRow só filtra combatentes com token.deletedAt
      // null, então depois disso ele já teria sumido da lista.
      const combatSnapshot = await adjustCombatForTokenRemoval(def, row.sceneId, tokenId);

      // Soft delete (docs/plano-desfazer.md §2): a linha continua no banco (PV, condições,
      // characterId, Combatant intactos) para o desfazer restaurar tudo sem precisar de snapshot.
      await prisma.token.update({ where: { id: tokenId }, data: { deletedAt: new Date() } });
      io.to(rooms.all(ctx.roomId)).emit("token:deleted", { tokenId });
      if (combatSnapshot) await emitCombat(io, ctx.roomId, row.sceneId, { role: ctx.role, participantId: ctx.participantId });

      if (ctx.role === "gm") {
        pushEntry(ctx.roomId, buildDeleteHistoryEntry(io, ctx.roomId, def, [{ tokenId, name: row.name, sceneId: row.sceneId, combatSnapshot }]));
        emitHistoryUpdated(io, ctx.roomId);
      }
    }),
  );

  socket.on(
    "token:delete-many",
    guarded(socket, TokenDeleteManySchema, async ({ tokenIds }, ctx) => {
      // Tudo-ou-nada, mesmo padrão de token:apply-damage: confere permissão de todos antes de apagar
      // qualquer um.
      const rows = await Promise.all(tokenIds.map((id) => requireToken(id, ctx.roomId)));
      for (const row of rows) if (!canEditToken(ctx, row)) throw new HandlerError("Você não controla um dos tokens selecionados");
      for (const row of rows) await requirePlayerTokenOnActiveScene(ctx, row.sceneId);
      const def = await requireSystem(ctx.roomId);

      const items: DeleteItem[] = [];
      const affectedScenes = new Set<string>();
      for (const row of rows) {
        const combatSnapshot = await adjustCombatForTokenRemoval(def, row.sceneId, row.id);
        await prisma.token.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
        io.to(rooms.all(ctx.roomId)).emit("token:deleted", { tokenId: row.id });
        if (combatSnapshot) affectedScenes.add(row.sceneId);
        items.push({ tokenId: row.id, name: row.name, sceneId: row.sceneId, combatSnapshot });
      }
      for (const sceneId of affectedScenes) await emitCombat(io, ctx.roomId, sceneId, { role: ctx.role, participantId: ctx.participantId });

      if (ctx.role === "gm") {
        pushEntry(ctx.roomId, buildDeleteHistoryEntry(io, ctx.roomId, def, items));
        emitHistoryUpdated(io, ctx.roomId);
      }
    }),
  );

  socket.on(
    "token:link-character",
    guarded(socket, TokenLinkCharacterSchema, async ({ tokenId, characterId }, ctx) => {
      const row = await requireToken(tokenId, ctx.roomId);
      if (!canEditToken(ctx, row)) throw new HandlerError("Você não controla este token");
      await requirePlayerTokenOnActiveScene(ctx, row.sceneId);
      if (characterId) {
        // Jogador só vincula uma ficha que também é dele.
        const character = toCharacter(await requireCharacter(characterId, ctx.roomId));
        if (!canEditCharacter(ctx, character)) throw new HandlerError("Você não controla esta ficha");
      }
      const token = toToken(await prisma.token.update({ where: { id: tokenId }, data: { characterId } }));
      broadcastToken(io, ctx.roomId, token, "token:updated", toScene(row.scene).fog);
      return token;
    }),
  );

  socket.on(
    "token:apply-damage",
    guarded(socket, TokenApplyDamageSchema, async ({ messageId, targets }, ctx) => {
      const row = await prisma.chatMessage.findUnique({ where: { id: messageId } });
      if (!row || row.roomId !== ctx.roomId) throw new HandlerError("Mensagem não encontrada");
      const msg = toChatMessage(row);
      // Mesma regra de quem vê a mensagem (não dá pra aplicar num card que nem devia enxergar).
      if (!messageVisibleTo(msg, { role: ctx.role, participantId: ctx.participantId })) throw new HandlerError("Mensagem não encontrada");
      if (msg.kind !== "roll" || !msg.roll?.damage?.length) throw new HandlerError("Essa rolagem não tem dano/cura pra aplicar");
      const roll = msg.roll;

      // 1. Valida TUDO antes de aplicar qualquer alvo (tudo-ou-nada): permissão (dono ou GM)
      // e se o alvo tem PV pra mexer (ficha com recurso `tokenBar`, ou hp do token solto).
      const def = await requireSystem(ctx.roomId);
      const tokenRows = await Promise.all(targets.map((t) => requireToken(t.tokenId, ctx.roomId)));
      for (const tokenRow of tokenRows) {
        const error = checkApplyDamageTarget(ctx, tokenRow, def);
        if (error) throw new HandlerError(error);
        await requirePlayerTokenOnActiveScene(ctx, tokenRow.sceneId);
      }

      // 2. Aplica: recurso `tokenBar` da ficha vinculada (dano gasta temp antes do current),
      // ou hp do próprio token quando solto. Lê fresco a cada alvo (dois alvos podem apontar
      // pra mesma ficha, ou o mesmo token repetido no lote).
      const applied: AppliedDamage[] = [];
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i]!;
        const tokenRow = tokenRows[i]!;

        if (tokenRow.characterId) {
          const resourceKey = def.tokenBar!;
          const character = toCharacter(await requireCharacter(tokenRow.characterId, ctx.roomId));
          const computed = computeCharacter(def, character);
          const bounds = computed.resources[resourceKey] ?? { max: 0, min: 0, detail: null };
          const res = character.resources[resourceKey] ?? { current: 0, temp: 0, maxOverride: null };
          const next = applyResourceDelta(res, target.amount, bounds);
          const data = CharacterDataSchema.parse({
            ...characterDataOf(character),
            resources: { ...character.resources, [resourceKey]: { ...res, ...next } },
          });
          const updated = toCharacter(await prisma.character.update({ where: { id: character.id }, data: { data: toJson(data) } }));
          broadcastCharacter(io, ctx.roomId, updated, "character:updated");
        } else {
          const fresh = await requireToken(tokenRow.id, ctx.roomId);
          const hp = TokenHpSchema.parse(fresh.hp);
          const next = applyResourceDelta({ current: hp.current, temp: 0 }, target.amount, { min: 0, max: hp.max });
          const updatedToken = toToken(
            await prisma.token.update({ where: { id: tokenRow.id }, data: { hp: hpJson({ current: next.current, max: hp.max }) } }),
          );
          broadcastToken(io, ctx.roomId, updatedToken, "token:updated", toScene(tokenRow.scene).fog);
        }

        applied.push({ tokenId: tokenRow.id, tokenName: tokenRow.name, amount: target.amount, multiplier: target.multiplier });
      }

      // 3. Acrescenta ao registro do card (nunca sobrescreve) e reemite pra quem já via a mensagem.
      const updatedRoll = { ...roll, applied: [...roll.applied, ...applied] };
      const updatedMsg = toChatMessage(await prisma.chatMessage.update({ where: { id: messageId }, data: { roll: updatedRoll } }));
      await emitChatMessage(io, ctx.roomId, updatedMsg);
      return updatedMsg;
    }),
  );
}
