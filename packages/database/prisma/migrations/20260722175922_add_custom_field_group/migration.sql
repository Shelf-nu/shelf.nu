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

-- AddForeignKey (with ON DELETE NO ACTION to prevent database set null error on composite key constraint)
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_groupId_organizationId_fkey" FOREIGN KEY ("groupId", "organizationId") REFERENCES "CustomFieldGroup"("id", "organizationId") ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "CustomFieldGroup" ADD CONSTRAINT "CustomFieldGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Commit the NOT VALID foreign keys first to finish current transaction
COMMIT;

-- Create index concurrently outside transaction boundary
CREATE INDEX CONCURRENTLY "CustomField_groupId_organizationId_idx" ON "CustomField"("groupId", "organizationId");

-- Validate constraint in a separate transaction block
BEGIN;
ALTER TABLE "CustomField" VALIDATE CONSTRAINT "CustomField_groupId_organizationId_fkey";
COMMIT;
