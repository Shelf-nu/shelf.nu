-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "baseUserCanSeeBookings" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "baseUserCanSeeCustody" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "selfServiceCanSeeBookings" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "selfServiceCanSeeCustody" BOOLEAN NOT NULL DEFAULT false;
