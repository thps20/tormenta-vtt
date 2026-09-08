-- DropForeignKey
ALTER TABLE "InitiativeEntry" DROP CONSTRAINT "InitiativeEntry_roomId_fkey";

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "tokenId" TEXT;

-- DropTable
DROP TABLE "InitiativeEntry";

-- CreateTable
CREATE TABLE "Combat" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'rolling',
    "activeCombatantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Combat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Combatant" (
    "id" TEXT NOT NULL,
    "combatId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "characterId" TEXT,
    "initiative" DOUBLE PRECISION,
    "bonus" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "delayed" BOOLEAN NOT NULL DEFAULT false,
    "surprised" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "addedRound" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Combatant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Combat_sceneId_key" ON "Combat"("sceneId");

-- CreateIndex
CREATE INDEX "Combat_roomId_idx" ON "Combat"("roomId");

-- CreateIndex
CREATE INDEX "Combatant_combatId_idx" ON "Combatant"("combatId");

-- CreateIndex
CREATE UNIQUE INDEX "Combatant_combatId_tokenId_key" ON "Combatant"("combatId", "tokenId");

-- CreateIndex
CREATE INDEX "ChatMessage_tokenId_idx" ON "ChatMessage"("tokenId");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combat" ADD CONSTRAINT "Combat_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combat" ADD CONSTRAINT "Combat_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combatant" ADD CONSTRAINT "Combatant_combatId_fkey" FOREIGN KEY ("combatId") REFERENCES "Combat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combatant" ADD CONSTRAINT "Combatant_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

