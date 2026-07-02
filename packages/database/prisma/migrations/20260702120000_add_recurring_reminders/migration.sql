-- Recurring reminders: cadence fields on AssetReminder + tier capability flags.
-- All AssetReminder columns are nullable; existing rows stay one-shot (null unit/interval).

-- CreateEnum
CREATE TYPE "ReminderRecurrenceUnit" AS ENUM ('DAY', 'WEEK', 'MONTH', 'YEAR');

-- AlterTable
ALTER TABLE "AssetReminder" ADD COLUMN     "recurrenceUnit" "ReminderRecurrenceUnit",
ADD COLUMN     "recurrenceInterval" INTEGER,
ADD COLUMN     "recurrenceTimezone" TEXT,
ADD COLUMN     "recurrenceEndsAt" TIMESTAMP(3);

-- AlterTable (mirrors the canImportNRM / canHideShelfBranding precedent pair:
-- TierLimit defaults false, CustomTierLimit defaults true)
ALTER TABLE "TierLimit" ADD COLUMN     "canUseRecurringReminders" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CustomTierLimit" ADD COLUMN     "canUseRecurringReminders" BOOLEAN NOT NULL DEFAULT true;
