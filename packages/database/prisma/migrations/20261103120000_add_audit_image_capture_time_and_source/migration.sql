-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AuditImageCaptureSource" AS ENUM ('CAMERA', 'LIBRARY', 'WEB_UPLOAD', 'PHONE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "AuditImage" ADD COLUMN IF NOT EXISTS "capturedAt" TIMESTAMP(3);
ALTER TABLE "AuditImage" ADD COLUMN IF NOT EXISTS "captureSource" "AuditImageCaptureSource";
