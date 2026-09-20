-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "ownerKey" TEXT;

-- CreateIndex
CREATE INDEX "Room_ownerKey_idx" ON "Room"("ownerKey");
