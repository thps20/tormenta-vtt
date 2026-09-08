-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "conditions" TEXT[] DEFAULT ARRAY[]::TEXT[];
