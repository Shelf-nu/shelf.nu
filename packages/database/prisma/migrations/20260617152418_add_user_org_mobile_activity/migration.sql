-- Mobile companion adoption tracking: record when a user last used the mobile
-- app in a given organization, so we can measure weekly/monthly active users
-- and organizations from our own database (no external analytics dependency).

-- AlterTable
ALTER TABLE "UserOrganization" ADD COLUMN "lastMobileActiveAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "UserOrganization_lastMobileActiveAt_idx" ON "UserOrganization"("lastMobileActiveAt");
