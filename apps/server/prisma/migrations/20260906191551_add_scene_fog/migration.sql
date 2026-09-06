-- AlterTable
ALTER TABLE "Scene" ADD COLUMN     "fog" JSONB NOT NULL DEFAULT '{"enabled":false,"base":"hidden","shapes":[]}';
