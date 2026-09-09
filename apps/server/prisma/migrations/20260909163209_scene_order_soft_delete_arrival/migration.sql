-- AlterTable
ALTER TABLE "Scene" ADD COLUMN     "arrival" JSONB,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "order" INTEGER NOT NULL DEFAULT 0;

-- Backfill: salas existentes nascem ordenadas como já estão hoje (por createdAt), em vez de
-- todo mundo com order = 0 (docs/plano-mapas.md §3).
UPDATE "Scene" AS s
SET "order" = ranked.rn - 1
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "roomId" ORDER BY "createdAt") AS rn
  FROM "Scene"
) AS ranked
WHERE s."id" = ranked."id";
