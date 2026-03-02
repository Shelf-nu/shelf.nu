-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastSelectedOrganizationId" TEXT;

-- CreateIndex
CREATE INDEX "User_lastSelectedOrganizationId_idx" ON "User"("lastSelectedOrganizationId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_lastSelectedOrganizationId_fkey" FOREIGN KEY ("lastSelectedOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
