-- CreateEnum
CREATE TYPE "DateFormat" AS ENUM ('AUTO', 'DD_MM_YYYY', 'MM_DD_YYYY', 'YYYY_MM_DD');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "dateFormat" "DateFormat" NOT NULL DEFAULT 'AUTO';
