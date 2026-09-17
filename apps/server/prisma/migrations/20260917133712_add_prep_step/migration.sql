-- CreateTable
CREATE TABLE "PrepStep" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "items" JSONB NOT NULL DEFAULT '[]',
    "used" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrepStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrepStep_sceneId_idx" ON "PrepStep"("sceneId");

-- AddForeignKey
ALTER TABLE "PrepStep" ADD CONSTRAINT "PrepStep_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;
