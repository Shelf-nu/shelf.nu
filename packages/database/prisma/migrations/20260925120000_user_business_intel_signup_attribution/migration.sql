-- AlterTable
ALTER TABLE "UserBusinessIntel" ADD COLUMN     "signupPlan" TEXT,
ADD COLUMN     "signupTrial" BOOLEAN,
ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "utmContent" TEXT,
ADD COLUMN     "utmMedium" TEXT,
ADD COLUMN     "utmSource" TEXT;

-- CreateIndex
CREATE INDEX "UserBusinessIntel_utmSource_idx" ON "UserBusinessIntel"("utmSource");

-- CreateIndex
CREATE INDEX "UserBusinessIntel_utmCampaign_idx" ON "UserBusinessIntel"("utmCampaign");
