/*
  Warnings:

  - You are about to drop the `HandoutPin` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "HandoutPin" DROP CONSTRAINT "HandoutPin_handoutId_fkey";

-- DropForeignKey
ALTER TABLE "HandoutPin" DROP CONSTRAINT "HandoutPin_sceneId_fkey";

-- AlterTable
ALTER TABLE "Scene" ADD COLUMN     "gmNotes" TEXT;

-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "notes" TEXT;

-- DropTable
DROP TABLE "HandoutPin";

-- CreateTable
CREATE TABLE "Pin" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "handoutId" TEXT,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT,
    "imageUrl" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "text" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pin_sceneId_idx" ON "Pin"("sceneId");

-- CreateIndex
CREATE INDEX "Pin_handoutId_idx" ON "Pin"("handoutId");

-- AddForeignKey
ALTER TABLE "Pin" ADD CONSTRAINT "Pin_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pin" ADD CONSTRAINT "Pin_handoutId_fkey" FOREIGN KEY ("handoutId") REFERENCES "Handout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
