-- CreateEnum
CREATE TYPE "public"."QrIdDisplayPreference" AS ENUM ('QR_ID', 'SAM_ID');

-- AlterTable
ALTER TABLE "public"."Organization" ADD COLUMN     "qrIdDisplayPreference" "public"."QrIdDisplayPreference" NOT NULL DEFAULT 'QR_ID';
