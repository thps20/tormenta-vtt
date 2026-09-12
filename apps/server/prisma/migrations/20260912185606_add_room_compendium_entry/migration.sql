-- CreateTable
CREATE TABLE "RoomCompendiumEntry" (
    "roomId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "kind" TEXT,
    "name" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT NOT NULL DEFAULT '',
    "page" INTEGER,
    "data" JSONB NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoomCompendiumEntry_pkey" PRIMARY KEY ("roomId","entryId")
);

-- AddForeignKey
ALTER TABLE "RoomCompendiumEntry" ADD CONSTRAINT "RoomCompendiumEntry_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
