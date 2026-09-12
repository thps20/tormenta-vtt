/**
 * Notas do Mestre (docs/plano-narracao.md): texto por mapa (`Scene.gmNotes`) e por token
 * (`Token.notes`), GM only. O texto NUNCA sai em `scene:updated`/`token:updated` (só
 * `hasNotes: boolean`, ver services/serialize.ts) — só por estes eventos dedicados, chamados sob
 * demanda quando o painel/Inspector/ficha rápida abre. Busca simples (contains, case-insensitive)
 * nas notas da sala inteira, no mesmo painel.
 */
import {
  NotesSearchSchema,
  SceneGetNotesSchema,
  SceneSetNotesSchema,
  TokenGetNotesSchema,
  TokenSetNotesSchema,
  type NotesSearchResultItem,
} from "@tormenta-vtt/shared";
import { prisma } from "../db.js";
import { toScene, toToken } from "../services/serialize.js";
import { guarded, HandlerError } from "./ack.js";
import { requireScene } from "./scene.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

const gmOnly = { gmOnly: true };

/**
 * Recorte do texto ao redor do primeiro match (case-insensitive), pra mostrar no resultado da
 * busca sem despejar a nota inteira. Sem match (não deveria acontecer — quem chama já filtrou por
 * `contains`), devolve o começo do texto. Pura: testável sem banco.
 */
export function buildNoteSnippet(text: string, query: string, radius = 40): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text.length > radius * 2 ? `${text.slice(0, radius * 2).trim()}…` : text.trim();
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

/** Carrega o token e confirma que é desta sala (mesma checagem de requireScene, sem soft-delete
 *  passar batido — token apagado não deveria aparecer em nenhuma nota). */
async function requireTokenForNotes(tokenId: string, roomId: string) {
  const row = await prisma.token.findUnique({ where: { id: tokenId }, include: { scene: true } });
  if (!row || row.scene.roomId !== roomId || row.deletedAt !== null) throw new HandlerError("Token não encontrado");
  return row;
}

export function registerNotesHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "scene:set-notes",
    guarded(
      socket,
      SceneSetNotesSchema,
      async ({ sceneId, notes }, ctx) => {
        await requireScene(sceneId, ctx.roomId);
        const trimmed = notes.trim();
        const scene = toScene(await prisma.scene.update({ where: { id: sceneId }, data: { gmNotes: trimmed || null } }));
        // Só o GM: o conteúdo mudou, mas mesmo `hasNotes` (a única coisa que este evento revela do
        // Scene) não precisa alcançar jogador nenhum — quem cuida da nota é só o GM.
        io.to(rooms.gm(ctx.roomId)).emit("scene:updated", scene);
        return scene;
      },
      gmOnly,
    ),
  );

  socket.on(
    "scene:get-notes",
    guarded(
      socket,
      SceneGetNotesSchema,
      async ({ sceneId }, ctx) => {
        const row = await requireScene(sceneId, ctx.roomId);
        return { notes: row.gmNotes ?? "" };
      },
      gmOnly,
    ),
  );

  socket.on(
    "token:set-notes",
    guarded(
      socket,
      TokenSetNotesSchema,
      async ({ tokenId, notes }, ctx) => {
        await requireTokenForNotes(tokenId, ctx.roomId);
        const trimmed = notes.trim();
        const token = toToken(await prisma.token.update({ where: { id: tokenId }, data: { notes: trimmed || null } }));
        // Só o GM: `hasNotes` deste token nunca vai a jogador (redactTokenForViewer, mesmo se ele
        // fosse o dono) — não há por que emitir pra `rooms.players` aqui.
        io.to(rooms.gm(ctx.roomId)).emit("token:updated", token);
        return token;
      },
      gmOnly,
    ),
  );

  socket.on(
    "token:get-notes",
    guarded(
      socket,
      TokenGetNotesSchema,
      async ({ tokenId }, ctx) => {
        const row = await requireTokenForNotes(tokenId, ctx.roomId);
        return { notes: row.notes ?? "" };
      },
      gmOnly,
    ),
  );

  socket.on(
    "notes:search",
    guarded(
      socket,
      NotesSearchSchema,
      async ({ query }, ctx) => {
        const q = query.trim();
        // `deletedAt: null` nos dois filtra mapa apagado (a nota dele não deveria aparecer numa
        // busca — soft delete, docs/plano-desfazer.md) e token apagado / de mapa apagado.
        const [scenes, tokens] = await Promise.all([
          prisma.scene.findMany({ where: { roomId: ctx.roomId, deletedAt: null, gmNotes: { contains: q, mode: "insensitive" } } }),
          prisma.token.findMany({
            where: { deletedAt: null, notes: { contains: q, mode: "insensitive" }, scene: { roomId: ctx.roomId, deletedAt: null } },
          }),
        ]);
        const items: NotesSearchResultItem[] = [
          ...scenes.map((s): NotesSearchResultItem => ({ kind: "scene", sceneId: s.id, name: s.name, snippet: buildNoteSnippet(s.gmNotes ?? "", q) })),
          ...tokens.map(
            (t): NotesSearchResultItem => ({ kind: "token", sceneId: t.sceneId, tokenId: t.id, name: t.name, snippet: buildNoteSnippet(t.notes ?? "", q) }),
          ),
        ];
        return { items };
      },
      gmOnly,
    ),
  );
}
