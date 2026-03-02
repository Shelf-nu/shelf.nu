-- CreateEnum
CREATE TYPE "NoteType" AS ENUM ('COMMENT', 'UPDATE');

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "type" "NoteType" NOT NULL DEFAULT 'COMMENT';
