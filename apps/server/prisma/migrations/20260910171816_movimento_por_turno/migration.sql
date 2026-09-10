-- AlterTable
ALTER TABLE "Combatant" ADD COLUMN     "movementAnchorX" DOUBLE PRECISION,
ADD COLUMN     "movementAnchorY" DOUBLE PRECISION,
ADD COLUMN     "movementBudget" DOUBLE PRECISION,
ADD COLUMN     "movementDiagonals" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "movementPath" JSONB,
ADD COLUMN     "movementUsed" DOUBLE PRECISION NOT NULL DEFAULT 0;
