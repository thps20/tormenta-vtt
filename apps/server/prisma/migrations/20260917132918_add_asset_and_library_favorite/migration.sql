-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryFavorite" (
    "roomId" TEXT NOT NULL,
    "refKind" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryFavorite_pkey" PRIMARY KEY ("roomId","refKind","refId")
);

-- CreateIndex
CREATE INDEX "Asset_roomId_idx" ON "Asset"("roomId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryFavorite" ADD CONSTRAINT "LibraryFavorite_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill (docs/plano-preparo.md §1.1): "tudo que o Mestre subiu" já em uso vira Asset, uma linha
-- por URL distinta por sala. gen_random_uuid() é nativo do Postgres (>=13), sem extensão.
INSERT INTO "Asset" ("id", "roomId", "kind", "name", "url", "createdAt")
SELECT DISTINCT ON ("roomId", "mapUrl")
  gen_random_uuid()::text, "roomId", 'map', "name", "mapUrl", "createdAt"
FROM "Scene"
WHERE "mapUrl" IS NOT NULL AND "mapUrl" <> '';

-- Token não tem createdAt (coluna não existe no modelo); usa o momento da migration mesmo.
INSERT INTO "Asset" ("id", "roomId", "kind", "name", "url", "createdAt")
SELECT DISTINCT ON ("Scene"."roomId", "Token"."imageUrl")
  gen_random_uuid()::text, "Scene"."roomId", 'token', "Token"."name", "Token"."imageUrl", CURRENT_TIMESTAMP
FROM "Token"
JOIN "Scene" ON "Scene"."id" = "Token"."sceneId"
WHERE "Token"."imageUrl" IS NOT NULL AND "Token"."imageUrl" <> '';
