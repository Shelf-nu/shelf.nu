-- AlterEnum
ALTER TYPE "AssetStatus" ADD VALUE 'BOOKED';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "custodianTeamMemberId" TEXT,
ADD COLUMN     "custodianUserId" TEXT;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_custodianUserId_fkey" FOREIGN KEY ("custodianUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_custodianTeamMemberId_fkey" FOREIGN KEY ("custodianTeamMemberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
