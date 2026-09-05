import { PrismaClient } from "@prisma/client";

/** Uma única instância do Prisma para o processo inteiro (pool de conexões). */
export const prisma = new PrismaClient();
