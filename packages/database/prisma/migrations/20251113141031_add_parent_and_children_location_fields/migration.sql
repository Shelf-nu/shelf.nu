-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "Location_organizationId_parentId_idx" ON "Location"("organizationId", "parentId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
