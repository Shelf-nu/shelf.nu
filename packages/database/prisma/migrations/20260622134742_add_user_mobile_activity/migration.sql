-- Mobile companion adoption tracking: record when a user last used the mobile
-- app (any workspace), so we can measure active users/accounts from our own
-- database — no external analytics dependency. Recorded at the requireMobileAuth
-- chokepoint; account-level adoption is derived by joining to UserOrganization.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastMobileActiveAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "User_lastMobileActiveAt_idx" ON "User"("lastMobileActiveAt");
