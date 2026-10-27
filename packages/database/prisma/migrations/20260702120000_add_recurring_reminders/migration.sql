-- Recurring reminders: cadence fields on AssetReminder + tier capability flags.
-- All AssetReminder columns are nullable; existing rows stay one-shot (null unit/interval).

-- CreateEnum
CREATE TYPE "ReminderRecurrenceUnit" AS ENUM ('DAY', 'WEEK', 'MONTH', 'YEAR');

-- AlterTable
ALTER TABLE "AssetReminder" ADD COLUMN     "recurrenceUnit" "ReminderRecurrenceUnit",
ADD COLUMN     "recurrenceInterval" INTEGER,
ADD COLUMN     "recurrenceTimezone" TEXT,
ADD COLUMN     "recurrenceEndsAt" TIMESTAMP(3);

-- Cadence invariant: a reminder is either one-shot (both cadence fields null)
-- or recurring (both present, positive interval). Guards downstream recurrence
-- detection (isRecurringReminder) against partial/invalid rows written by any
-- future path that bypasses the service layer. (Prisma cannot model CHECK
-- constraints, so this lives in SQL only.)
ALTER TABLE "AssetReminder" ADD CONSTRAINT "AssetReminder_recurrence_cadence_check" CHECK (
  ("recurrenceUnit" IS NULL AND "recurrenceInterval" IS NULL)
  OR ("recurrenceUnit" IS NOT NULL AND "recurrenceInterval" IS NOT NULL AND "recurrenceInterval" > 0)
);

-- AlterTable (mirrors the canImportNRM / canHideShelfBranding precedent pair:
-- TierLimit defaults false, CustomTierLimit defaults true)
ALTER TABLE "TierLimit" ADD COLUMN     "canUseRecurringReminders" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CustomTierLimit" ADD COLUMN     "canUseRecurringReminders" BOOLEAN NOT NULL DEFAULT true;
