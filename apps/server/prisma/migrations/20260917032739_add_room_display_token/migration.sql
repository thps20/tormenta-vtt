-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "displayToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Room_displayToken_key" ON "Room"("displayToken");
