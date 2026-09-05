import { z } from "zod";

/**
 * Valida as variáveis de ambiente na inicialização.
 * Falhar cedo com mensagem clara é melhor que um erro obscuro no meio de uma requisição.
 */
const EnvSchema = z.object({
  SERVER_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
});

export const env = EnvSchema.parse(process.env);
