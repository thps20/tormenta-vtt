-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "visibility" TEXT NOT NULL DEFAULT 'all';

-- Rolagens secretas antigas (roll.secret = true) passam a ser "gm" (só o GM vê).
UPDATE "ChatMessage" SET "visibility" = 'gm' WHERE "kind" = 'roll' AND ("roll"->>'secret') = 'true';
