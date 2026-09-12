-- CreateTable
CREATE TABLE "Drawing" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "strokeWidth" DOUBLE PRECISION NOT NULL,
    "filled" BOOLEAN NOT NULL DEFAULT false,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "points" DOUBLE PRECISION[],
    "x1" DOUBLE PRECISION,
    "y1" DOUBLE PRECISION,
    "x2" DOUBLE PRECISION,
    "y2" DOUBLE PRECISION,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "cx" DOUBLE PRECISION,
    "cy" DOUBLE PRECISION,
    "rx" DOUBLE PRECISION,
    "ry" DOUBLE PRECISION,
    "text" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Drawing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Drawing_sceneId_idx" ON "Drawing"("sceneId");

-- CreateIndex
CREATE INDEX "Drawing_ownerId_idx" ON "Drawing"("ownerId");

-- AddForeignKey
ALTER TABLE "Drawing" ADD CONSTRAINT "Drawing_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;
