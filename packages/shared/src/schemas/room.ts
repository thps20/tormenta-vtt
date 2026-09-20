import { z } from "zod";
import { IdSchema } from "./common.js";

export const RoleSchema = z.enum(["gm", "player"]);
export type Role = z.infer<typeof RoleSchema>;

/** Um participante conectado à sala. Sem login: identificado por nickname + id de sessão. */
export const ParticipantSchema = z.object({
  id: IdSchema,
  nickname: z.string().min(1).max(32),
  role: RoleSchema,
  connected: z.boolean(),
});
export type Participant = z.infer<typeof ParticipantSchema>;

export const RoomSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(80),
  /** Código curto usado no link de convite: /join/:inviteCode */
  inviteCode: z.string().min(6).max(32),
  /** Segredo do GM: quem entra com ele vira GM. */
  gmSecret: z.string().min(16).optional(),
  /** Qual sistema de regras (arquivo em packages/shared/systems/<id>.json) */
  systemId: z.string().min(1),
  activeSceneId: IdSchema.nullable(),
  createdAt: z.string().datetime(),
});
export type Room = z.infer<typeof RoomSchema>;

/** Sala como vista pelo cliente (sem segredos). */
export const RoomPublicSchema = RoomSchema.omit({ gmSecret: true });
export type RoomPublic = z.infer<typeof RoomPublicSchema>;

/**
 * Identidade local do Mestre (docs/SPEC.md §3.1): string opaca gerada e guardada no `localStorage`
 * do navegador (chave global, não por sala) — o servidor nunca gera nem valida o formato, só
 * compara com o que está gravado em `Room.ownerKey`. Tamanho mínimo alto o bastante pra não colidir
 * por acaso; sem limite de charset porque é um cuid/uuid de qualquer lado.
 */
export const OwnerKeySchema = z.string().min(16).max(128);
export type OwnerKey = z.infer<typeof OwnerKeySchema>;

/** Uma sala na lista "Minhas mesas" do Lobby (GET /api/rooms/mine). Só sai pra quem provou o
 *  `ownerKey` da sala — por isso inclui `gmSecret` (permite abrir direto como GM, sem repetir o
 *  link secreto) e vem sem participante nenhum (não é `RoomSnapshot`). */
export const MyRoomSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(80),
  inviteCode: z.string().min(6).max(32),
  gmSecret: z.string().min(16),
  createdAt: z.string().datetime(),
  /** Quando foi a última mensagem de chat da sala (proxy de "atividade"); sem mensagem nenhuma, cai
   *  no `createdAt` da própria sala. */
  lastActivityAt: z.string().datetime(),
  participantCount: z.number().int().nonnegative(),
  mapCount: z.number().int().nonnegative(),
  /** null = ativa. Setado = encerrada (soft delete, aba "Encerradas" do Lobby). */
  deletedAt: z.string().datetime().nullable(),
});
export type MyRoom = z.infer<typeof MyRoomSchema>;
