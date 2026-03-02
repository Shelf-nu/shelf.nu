-- AlterTable
ALTER TABLE "BookingSettings" ADD COLUMN     "requireExplicitCheckinForAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requireExplicitCheckinForSelfService" BOOLEAN NOT NULL DEFAULT false;
