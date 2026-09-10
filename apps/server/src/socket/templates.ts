import { GridConfigSchema, TemplateRemoveSchema, TemplateUpsertSchema, describeTemplateChange, type SystemDefinition, type Template } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { requireSystem } from "../services/characters.js";
import { requirePlayerOnActiveScene } from "../services/combat.js";
import { emitHistoryUpdated } from "./history.js";
import { pushEntry, type HistoryEntry } from "../services/history.js";
import { isActiveScene } from "../services/visibility.js";
import { getTemplate, removeTemplate, templateOwner, upsertTemplate } from "../services/templates.js";
import { guarded, HandlerError } from "./ack.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

/**
 * Gabaritos de área de efeito (docs/plano-gabaritos.md): efêmeros por sessão — guardados em
 * memória (`services/templates.ts`), nunca no banco. Dono = sempre quem criou; GM edita/apaga
 * qualquer um, jogador só os seus, e só no mapa ATIVO da sala (mesma regra de `ruler:update`/
 * `combat:delay`). Broadcast de mapa como sempre: GM recebe qualquer mapa, jogador só o ativo.
 *
 * Desfazer/refazer (docs/plano-gabaritos.md §4): só ações do GM empilham na pilha geral da sala
 * (mesma regra de token/spawn, docs/plano-desfazer.md §6) — jogador tem sua própria pilha, só no
 * cliente (apps/web/src/store/templateHistory.ts), que reemite estes mesmos eventos.
 */

/** Tamanho (raio/comprimento/lado) do gabarito, em pixels — um campo por forma. */
function templateSizePx(t: Template): number {
  return t.shape === "circle" ? t.r : t.shape === "square" ? t.side : t.length;
}

/** Pixels-por-célula da CENA (não confundir com `def.grid.cellSize`, que é metros-por-célula do
 *  SISTEMA) — mesma regra de `effectiveCellSize` (apps/web/src/lib/grid.ts): grid "none" cai no
 *  mesmo 70 que o resto do projeto já assume pra mapa sem grade. */
async function sceneCellSizePx(sceneId: string): Promise<number> {
  const row = await prisma.scene.findUnique({ where: { id: sceneId }, select: { grid: true } });
  const grid = GridConfigSchema.parse(row?.grid ?? {});
  return grid.type === "square" ? grid.cellSize : 70;
}

/** "cone 9 m" — rótulo pro resumo do desfazer/refazer (`describeTemplateChange`), convertendo o
 *  tamanho de pixels (como o Template guarda) de volta pra unidade do sistema. */
function templateAreaLabel(def: SystemDefinition, template: Template, cellSizePx: number): string {
  const shapeLabel = (def.templates?.shapeLabels[template.shape] ?? template.shape).toLowerCase();
  const unitsPerCell = def.grid?.cellSize ?? 1;
  const size = Math.round(((templateSizePx(template) / cellSizePx) * unitsPerCell) * 10) / 10;
  return def.grid?.unit ? `${shapeLabel} ${size} ${def.grid.unit}` : `${shapeLabel} ${size}`;
}

/** "colocar"/"mover"/"girar" conforme o que mudou entre o antes e o depois; `null` = nada mudou
 *  (não empilha — mesmo espírito de `pickTrackableTokenPatch` devolvendo `null` pro token). */
function templateChangeAction(before: Template | undefined, after: Template): "colocar" | "mover" | "girar" | null {
  if (!before) return "colocar";
  if (before.x !== after.x || before.y !== after.y) return "mover";
  if (before.rotation !== after.rotation) return "girar";
  return null;
}

/** Reaplica um gabarito exatamente como estava (usado por revert/apply do histórico) — grava em
 *  memória e faz o mesmo broadcast do handler (GM sempre, jogador só se `sceneId` ainda for o mapa
 *  ativo — o undo pode acontecer depois de trocar de mapa), sem passar pela validação de dono de
 *  novo (mesmo padrão de `writeTrackablePatch`, socket/token.ts). Efêmero: sem linha de banco pra
 *  invalidar — revert/apply são best-effort, como a régua. */
async function writeTemplate(io: TypedServer, roomId: string, sceneId: string, template: Template): Promise<void> {
  upsertTemplate(sceneId, template);
  const payload = { sceneId, template };
  io.to(rooms.gm(roomId)).emit("template:upserted", payload);
  if (await isActiveScene(roomId, sceneId)) io.to(rooms.players(roomId)).emit("template:upserted", payload);
}

async function writeTemplateRemoval(io: TypedServer, roomId: string, sceneId: string, templateId: string): Promise<void> {
  removeTemplate(sceneId, templateId);
  const payload = { sceneId, templateId };
  io.to(rooms.gm(roomId)).emit("template:removed", payload);
  if (await isActiveScene(roomId, sceneId)) io.to(rooms.players(roomId)).emit("template:removed", payload);
}

export function registerTemplateHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "template:upsert",
    guarded(socket, TemplateUpsertSchema, async ({ sceneId, template, live, dragFrom }, ctx) => {
      await requirePlayerOnActiveScene(ctx.roomId, sceneId, ctx.role);

      const before = getTemplate(sceneId, template.id);
      const existingOwner = before?.ownerId;
      if (existingOwner !== undefined && ctx.role !== "gm" && existingOwner !== ctx.participantId) {
        throw new HandlerError("Você só pode editar seus próprios gabaritos");
      }
      // Nunca confia no ownerId do payload (mesmo princípio de token): dono é fixo desde a criação.
      const saved = { ...template, ownerId: existingOwner ?? ctx.participantId };
      if (!upsertTemplate(sceneId, saved)) throw new HandlerError("Limite de gabaritos neste mapa atingido");

      // "Antes" pro HISTÓRICO: `before` (lido agora) já reflete os ecos `live` do arraste, só uns
      // 33ms atrás do fim do gesto — `dragFrom` (mousedown) é o "antes" de verdade, quando presente
      // (mesmo motivo de TokenPatch.dragFrom, docs/plano-desfazer.md §3).
      const historyBefore = before && dragFrom ? { ...before, ...dragFrom } : before;

      // `live` (eco de arraste/rotação em andamento) nunca empilha — só o commit final do gesto,
      // mesmo motivo de `TokenPatch.live` (docs/plano-desfazer.md §2). Só o GM empilha na pilha
      // geral; o jogador tem a própria, no cliente.
      if (ctx.role === "gm" && !live) {
        const action = templateChangeAction(historyBefore, saved);
        if (action) {
          const def = await requireSystem(ctx.roomId);
          const cellSizePx = await sceneCellSizePx(sceneId);
          const areaLabel = templateAreaLabel(def, saved, cellSizePx);
          const entry: HistoryEntry = {
            summary: describeTemplateChange(action, areaLabel),
            revert: async () => {
              if (historyBefore) await writeTemplate(io, ctx.roomId, sceneId, historyBefore);
              else await writeTemplateRemoval(io, ctx.roomId, sceneId, saved.id);
            },
            apply: async () => writeTemplate(io, ctx.roomId, sceneId, saved),
          };
          pushEntry(ctx.roomId, entry);
          emitHistoryUpdated(io, ctx.roomId);
        }
      }

      const payload = { sceneId, template: saved };
      io.to(rooms.gm(ctx.roomId)).emit("template:upserted", payload);
      if (await isActiveScene(ctx.roomId, sceneId)) io.to(rooms.players(ctx.roomId)).emit("template:upserted", payload);
      return saved;
    }),
  );

  socket.on(
    "template:remove",
    guarded(socket, TemplateRemoveSchema, async ({ sceneId, templateId }, ctx) => {
      await requirePlayerOnActiveScene(ctx.roomId, sceneId, ctx.role);
      const removed = getTemplate(sceneId, templateId);
      const owner = removed?.ownerId ?? templateOwner(sceneId, templateId);
      if (owner === undefined) throw new HandlerError("Gabarito não encontrado");
      if (ctx.role !== "gm" && owner !== ctx.participantId) throw new HandlerError("Você só pode apagar seus próprios gabaritos");

      removeTemplate(sceneId, templateId);

      if (ctx.role === "gm" && removed) {
        const def = await requireSystem(ctx.roomId);
        const cellSizePx = await sceneCellSizePx(sceneId);
        const areaLabel = templateAreaLabel(def, removed, cellSizePx);
        const entry: HistoryEntry = {
          summary: describeTemplateChange("apagar", areaLabel),
          revert: async () => writeTemplate(io, ctx.roomId, sceneId, removed),
          apply: async () => writeTemplateRemoval(io, ctx.roomId, sceneId, templateId),
        };
        pushEntry(ctx.roomId, entry);
        emitHistoryUpdated(io, ctx.roomId);
      }

      const payload = { sceneId, templateId };
      io.to(rooms.gm(ctx.roomId)).emit("template:removed", payload);
      if (await isActiveScene(ctx.roomId, sceneId)) io.to(rooms.players(ctx.roomId)).emit("template:removed", payload);
    }),
  );
}
