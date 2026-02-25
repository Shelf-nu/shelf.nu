-- AlterTable
ALTER TABLE "public"."CustomField" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "CustomField_organizationId_deletedAt_idx" ON "public"."CustomField"("organizationId", "deletedAt");
