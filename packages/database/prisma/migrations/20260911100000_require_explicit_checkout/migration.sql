-- AlterTable
ALTER TABLE "BookingSettings" ADD COLUMN     "requireExplicitCheckoutForAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requireExplicitCheckoutForSelfService" BOOLEAN NOT NULL DEFAULT false;
