-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "handout" JSONB,
ADD COLUMN     "whisperTo" TEXT;

-- CreateTable
CREATE TABLE "Handout" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "imageUrl" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "text" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Handout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandoutPin" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "handoutId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "imageUrl" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "text" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoutPin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Handout_roomId_idx" ON "Handout"("roomId");

-- CreateIndex
CREATE INDEX "HandoutPin_sceneId_idx" ON "HandoutPin"("sceneId");

-- CreateIndex
CREATE INDEX "HandoutPin_handoutId_idx" ON "HandoutPin"("handoutId");

-- AddForeignKey
ALTER TABLE "Handout" ADD CONSTRAINT "Handout_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoutPin" ADD CONSTRAINT "HandoutPin_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoutPin" ADD CONSTRAINT "HandoutPin_handoutId_fkey" FOREIGN KEY ("handoutId") REFERENCES "Handout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
