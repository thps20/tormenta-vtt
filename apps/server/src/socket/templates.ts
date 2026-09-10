import { TemplateRemoveSchema, TemplateUpsertSchema } from "@tormenta-vtt/shared";
import { requirePlayerOnActiveScene } from "../services/combat.js";
import { isActiveScene } from "../services/visibility.js";
import { removeTemplate, templateOwner, upsertTemplate } from "../services/templates.js";
import { guarded, HandlerError } from "./ack.js";
import { rooms, type TypedServer, type TypedSocket } from "./types.js";

/**
 * Gabaritos de área de efeito (docs/plano-gabaritos.md): efêmeros por sessão — guardados em
 * memória (`services/templates.ts`), nunca no banco. Dono = sempre quem criou; GM edita/apaga
 * qualquer um, jogador só os seus, e só no mapa ATIVO da sala (mesma regra de `ruler:update`/
 * `combat:delay`). Broadcast de mapa como sempre: GM recebe qualquer mapa, jogador só o ativo.
 */
export function registerTemplateHandlers(io: TypedServer, socket: TypedSocket): void {
  socket.on(
    "template:upsert",
    // `live` (eco de arraste/rotação em andamento) não muda nada aqui — não há histórico de
    // gabarito a poupar; o campo só mantém o contrato simétrico ao de TokenPatch.
    guarded(socket, TemplateUpsertSchema, async ({ sceneId, template, live: _live }, ctx) => {
      await requirePlayerOnActiveScene(ctx.roomId, sceneId, ctx.role);

      const existingOwner = templateOwner(sceneId, template.id);
      if (existingOwner !== undefined && ctx.role !== "gm" && existingOwner !== ctx.participantId) {
        throw new HandlerError("Você só pode editar seus próprios gabaritos");
      }
      // Nunca confia no ownerId do payload (mesmo princípio de token): dono é fixo desde a criação.
      const saved = { ...template, ownerId: existingOwner ?? ctx.participantId };
      if (!upsertTemplate(sceneId, saved)) throw new HandlerError("Limite de gabaritos neste mapa atingido");

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
      const owner = templateOwner(sceneId, templateId);
      if (owner === undefined) throw new HandlerError("Gabarito não encontrado");
      if (ctx.role !== "gm" && owner !== ctx.participantId) throw new HandlerError("Você só pode apagar seus próprios gabaritos");

      removeTemplate(sceneId, templateId);
      const payload = { sceneId, templateId };
      io.to(rooms.gm(ctx.roomId)).emit("template:removed", payload);
      if (await isActiveScene(ctx.roomId, sceneId)) io.to(rooms.players(ctx.roomId)).emit("template:removed", payload);
    }),
  );
}
