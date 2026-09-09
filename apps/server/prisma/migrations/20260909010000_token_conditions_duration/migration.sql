-- Token.conditions: String[] -> Json (duração de condições em rodadas, precisa guardar
-- { key, expiresRound? } em vez de só a chave). Escrita à mão (não a gerada pelo `prisma migrate
-- dev`, que dropa e recria a coluna): to_jsonb() num text[] vira um array JSON de strings, que o
-- TokenConditionEntrySchema (z.preprocess) lê como condição permanente antiga — sem perda de dado.

ALTER TABLE "Token" ADD COLUMN "conditions_new" JSONB NOT NULL DEFAULT '[]';

UPDATE "Token" SET "conditions_new" = to_jsonb("conditions");

ALTER TABLE "Token" DROP COLUMN "conditions";
ALTER TABLE "Token" RENAME COLUMN "conditions_new" TO "conditions";
