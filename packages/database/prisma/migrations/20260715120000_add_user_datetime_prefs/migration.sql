-- CreateEnum
CREATE TYPE "DateFormatPreference" AS ENUM ('DD_MM_YYYY', 'MM_DD_YYYY', 'YYYY_MM_DD');

-- CreateEnum
CREATE TYPE "TimeFormatPreference" AS ENUM ('H12', 'H24');

-- CreateEnum
CREATE TYPE "WeekStartPreference" AS ENUM ('MONDAY', 'SUNDAY', 'SATURDAY');

-- AlterTable: metadata-only (all nullable, no default → no table rewrite / no lock churn)
ALTER TABLE "User"
    ADD COLUMN "dateFormat" "DateFormatPreference",
    ADD COLUMN "timeFormat" "TimeFormatPreference",
    ADD COLUMN "weekStart" "WeekStartPreference",
    ADD COLUMN "timeZone" TEXT;
