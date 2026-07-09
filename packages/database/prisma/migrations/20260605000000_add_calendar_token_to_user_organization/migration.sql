-- AlterTable
ALTER TABLE "UserOrganization" ADD COLUMN "calendarTokenId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "UserOrganization_calendarTokenId_key" ON "UserOrganization"("calendarTokenId");
