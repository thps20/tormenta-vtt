-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "compendiumEntryId" TEXT;

-- CreateTable
CREATE TABLE "SavedEncounter" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT NOT NULL DEFAULT '',
    "entries" JSONB NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedEncounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedEncounter_roomId_idx" ON "SavedEncounter"("roomId");

-- AddForeignKey
ALTER TABLE "SavedEncounter" ADD CONSTRAINT "SavedEncounter_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
