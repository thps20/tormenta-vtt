/**
 * Limpeza definitiva de tokens soft-deleted (docs/plano-desfazer.md §8). Sem lib nova nem cron do
 * SO — um setInterval simples, chamado uma vez no boot (index.ts). Não existe "encerrar sala" no
 * MVP hoje (uma sala nunca fecha explicitamente), então fica só o gatilho por tempo.
 */
import { prisma } from "../db.js";

/** Dias que um token apagado fica na "lixeira" antes de ser removido de vez do banco. */
export const TOKEN_TRASH_RETENTION_DAYS = 30;

/** De quanto em quanto tempo a limpeza roda. */
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

function retentionCutoff(now: Date): Date {
  return new Date(now.getTime() - TOKEN_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Apaga de vez tokens marcados como deletedAt há mais de TOKEN_TRASH_RETENTION_DAYS dias. Se uma
 * entrada de histórico ainda apontar pra um desses (sala inativa há 30+ dias, ninguém deu Ctrl+Z),
 * o próximo undo/redo simplesmente falha e descarta a entrada (docs/plano-desfazer.md §7) — não
 * precisa coordenar com a pilha em memória.
 */
export async function purgeDeletedTokens(now: Date = new Date()): Promise<number> {
  const result = await prisma.token.deleteMany({ where: { deletedAt: { lt: retentionCutoff(now) } } });
  return result.count;
}

/** Roda a limpeza uma vez no boot e depois a cada CLEANUP_INTERVAL_MS. Devolve o timer, pra
 *  encerramento limpo (index.ts já para todo o resto no SIGINT/SIGTERM). */
export function scheduleTokenTrashCleanup(log: { info: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void }): NodeJS.Timeout {
  const run = () => {
    purgeDeletedTokens()
      .then((count) => {
        if (count > 0) log.info({ count }, "limpeza: tokens apagados de vez (retenção expirada)");
      })
      .catch((err) => log.error({ err }, "limpeza de tokens falhou"));
  };
  run();
  return setInterval(run, CLEANUP_INTERVAL_MS);
}
