/**
 * Alvos marcados por participante (docs/plano-alvos.md): "quem mira quem", efêmero (memória, ver
 * services/targets.ts), sincronizado por socket. Lista COMPLETA por chamada (`target:set`), nunca
 * "adiciona/remove" — mesmo raciocínio de `fog:update`/`template:upsert`.
 */
import { FogConfigSchema, TargetSetSchema } from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { requirePlayerOnActiveScene } from "../services/combat.js";
import { clearPlayerTargets, removeTokenFromTargets, setTargets } from "../services/targets.js";
import { tokenVisibleTo } from "../services/visibility.js";
import { toToken } from "../services/serialize.js";
import { guarded } from "./ack.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

export function registerTargetHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "target:set",
    guarded(socket, TargetSetSchema, async ({ sceneId, tokenIds }, ctx) => {
      // Defesa em profundidade (mesma regra de ruler:update/template:upsert): jogador só mira no
      // mapa ATIVO da sala; GM em qualquer mapa vivo que esteja vendo.
      await requirePlayerOnActiveScene(ctx.roomId, sceneId, ctx.role);

      // Existe, não apagado, é desta cena — descarta o resto em silêncio (token sumiu um instante
      // antes, ou o cliente mandou um id de outro mapa).
      const rows = tokenIds.length > 0 ? await prisma.token.findMany({ where: { id: { in: tokenIds }, sceneId, deletedAt: null } }) : [];
      const byId = new Map(rows.map((r) => [r.id, toToken(r)]));

      // Jogador só marca token que VÊ (mesma regra de sempre: visible + névoa). GM marca qualquer um.
      let accepted: string[];
      if (ctx.role === "gm") {
        accepted = tokenIds.filter((id) => byId.has(id));
      } else {
        const scene = await prisma.scene.findUniqueOrThrow({ where: { id: sceneId } });
        const fog = FogConfigSchema.parse(scene.fog ?? {});
        const viewer = { role: "player" as const, participantId: ctx.participantId };
        accepted = tokenIds.filter((id) => {
          const token = byId.get(id);
          return token !== undefined && tokenVisibleTo(token, viewer, fog);
        });
      }
      // Preserva a ordem em que o cliente marcou (relevante pro Alt "vira o único alvo").
      const orderedAccepted = tokenIds.filter((id) => accepted.includes(id));

      setTargets(ctx.roomId, ctx.participantId, sceneId, orderedAccepted);
      await broadcastTargets(io, ctx.roomId, ctx.participantId, ctx.role, sceneId, orderedAccepted);
      return { tokenIds: orderedAccepted };
    }),
  );
}

/**
 * GM sempre recebe (alvos de jogador). Autor sempre recebe de volta (outras abas). Alvos do GM
 * NUNCA vão a jogador nenhum (marcar alvo é informação de mestre) — só quando o autor é jogador,
 * os OUTROS jogadores recebem, cada um só os ids que ELE PRÓPRIO pode ver (uma cópia por pessoa,
 * mesmo mecanismo de `initiativeBatchForViewer`/`chatVisibility.ts`, só que aqui o evento inteiro é
 * pequeno o bastante pra não precisar de uma função de filtro exportada).
 */
export async function broadcastTargets(
  io: TypedServer,
  roomId: string,
  participantId: string,
  role: "gm" | "player",
  sceneId: string,
  tokenIds: string[],
): Promise<void> {
  const payload = { participantId, sceneId, tokenIds };
  io.to(rooms.gm(roomId)).to(rooms.participant(participantId)).emit("target:updated", payload);
  // Alvos do GM nunca vão a jogador nenhum (marcar alvo é informação de mestre).
  if (role !== "player") return;

  const others = await prisma.participant.findMany({ where: { roomId, role: "player", id: { not: participantId } } });
  if (others.length === 0) return;
  const rows = tokenIds.length > 0 ? await prisma.token.findMany({ where: { id: { in: tokenIds } }, include: { scene: true } }) : [];
  const infos = rows.map((r) => ({ token: toToken(r), fog: FogConfigSchema.parse(r.scene.fog ?? {}) }));
  for (const other of others) {
    const viewer = { role: "player" as const, participantId: other.id };
    const visibleIds = infos.filter(({ token, fog }) => tokenVisibleTo(token, viewer, fog)).map(({ token }) => token.id);
    io.to(rooms.participant(other.id)).emit("target:updated", { participantId, sceneId, tokenIds: visibleIds });
  }
}

/**
 * Token apagado (token:delete/delete-many, socket/token.ts): tira o id de toda lista de alvos da
 * sala e reemite `target:updated` de quem mudou — mesma regra de visibilidade de `target:set`.
 */
export async function syncTargetsAfterTokenRemoval(io: TypedServer, roomId: string, tokenId: string): Promise<void> {
  const changed = removeTokenFromTargets(roomId, tokenId);
  if (changed.length === 0) return;
  await broadcastEachChanged(io, roomId, changed);
}

/**
 * `scene:activate` (docs/plano-alvos.md §2.2): jogador mudou de mapa ativo, os alvos dele (que
 * eram do mapa anterior) deixam de fazer sentido — limpa e avisa quem via (GM sempre; o próprio
 * jogador). O GM mantém os dele (pode estar preparando o mapa seguinte).
 */
export async function clearPlayerTargetsOnActivate(io: TypedServer, roomId: string): Promise<void> {
  const players = await prisma.participant.findMany({ where: { roomId, role: "player" } });
  const changed = clearPlayerTargets(roomId, new Set(players.map((p) => p.id)));
  if (changed.length === 0) return;
  await broadcastEachChanged(io, roomId, changed.map((c) => ({ ...c, tokenIds: [] as string[] })));
}

async function broadcastEachChanged(io: TypedServer, roomId: string, changed: { participantId: string; sceneId: string; tokenIds: string[] }[]): Promise<void> {
  const participants = await prisma.participant.findMany({ where: { id: { in: changed.map((c) => c.participantId) } } });
  const roleById = new Map(participants.map((p) => [p.id, p.role]));
  for (const c of changed) {
    const role = roleById.get(c.participantId);
    if (role !== "gm" && role !== "player") continue; // participante sumiu; não deveria acontecer
    await broadcastTargets(io, roomId, c.participantId, role, c.sceneId, c.tokenIds);
  }
}
