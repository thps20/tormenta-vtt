import type { ZodType, ZodTypeDef } from "zod";
import type { Ack } from "@tormenta-vtt/shared";
import type { TypedSocket } from "./types.js";

/** Erro "esperado" (permissão, não encontrado): a mensagem vai no ack, sem stack trace no log. */
export class HandlerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HandlerError";
  }
}

export interface Ctx {
  roomId: string;
  participantId: string;
  role: "gm" | "player";
}

/**
 * Envolve um handler de evento com o padrão comum:
 *   1. exige que o socket já tenha entrado numa sala;
 *   2. valida o payload com o schema Zod (fronteira);
 *   3. converte exceções em ack { ok: false, error }.
 * Assim cada handler só escreve a lógica de negócio.
 */
export function guarded<TIn, TOut>(
  socket: TypedSocket,
  // Input = unknown: TIn é o tipo de SAÍDA do schema (com os .default() já aplicados).
  schema: ZodType<TIn, ZodTypeDef, unknown>,
  fn: (data: TIn, ctx: Ctx) => Promise<TOut>,
  opts: { gmOnly?: boolean } = {},
) {
  return async (payload: unknown, ack: Ack<TOut>): Promise<void> => {
    // Cliente mal-comportado pode não mandar ack; não pode derrubar o servidor.
    const reply: Ack<TOut> = typeof ack === "function" ? ack : () => undefined;
    try {
      const { roomId, participantId, role } = socket.data;
      if (!roomId || !participantId) throw new HandlerError("Você não está em uma sala");
      if (opts.gmOnly && role !== "gm") throw new HandlerError("Apenas o GM pode fazer isso");

      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        throw new HandlerError(`Dados inválidos${first ? `: ${first.path.join(".")} ${first.message}` : ""}`);
      }

      const data = await fn(parsed.data, { roomId, participantId, role });
      reply({ ok: true, data });
    } catch (err) {
      if (err instanceof HandlerError) {
        reply({ ok: false, error: err.message });
      } else {
        console.error(err);
        reply({ ok: false, error: "Erro interno do servidor" });
      }
    }
  };
}
