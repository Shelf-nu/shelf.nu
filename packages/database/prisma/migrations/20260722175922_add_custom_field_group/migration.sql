-- AlterTable
ALTER TABLE "CustomField" ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CustomFieldGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "organizationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomFieldGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomFieldGroup_organizationId_idx" ON "CustomFieldGroup"("organizationId");

-- CreateUniqueIndex for Organization scope unique constraint
CREATE UNIQUE INDEX "CustomFieldGroup_id_organizationId_key" ON "CustomFieldGroup"("id", "organizationId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "CustomFieldGroup_organizationId_name_key" ON "CustomFieldGroup"("organizationId", "name");

-- CreateIndex
-- NOTE: In production environments, run this outside of a transaction block to use CONCURRENTLY.
-- If running inside a standard transaction block where CONCURRENTLY is not allowed, remove the CONCURRENTLY keyword.
CREATE INDEX CONCURRENTLY "CustomField_groupId_organizationId_idx" ON "CustomField"("groupId", "organizationId");

-- AddForeignKey (with NOT VALID to avoid locking write operations)
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_groupId_organizationId_fkey" FOREIGN KEY ("groupId", "organizationId") REFERENCES "CustomFieldGroup"("id", "organizationId") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- Validate constraint
ALTER TABLE "CustomField" VALIDATE CONSTRAINT "CustomField_groupId_organizationId_fkey";

-- AddForeignKey
ALTER TABLE "CustomFieldGroup" ADD CONSTRAINT "CustomFieldGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
