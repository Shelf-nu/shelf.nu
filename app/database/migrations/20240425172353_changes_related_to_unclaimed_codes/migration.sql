-- AlterTable
ALTER TABLE "Qr" ADD COLUMN     "batch" TEXT,
ADD COLUMN     "printed" BOOLEAN NOT NULL DEFAULT false;
