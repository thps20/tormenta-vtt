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
