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

-- CreateIndex
CREATE UNIQUE INDEX "CustomFieldGroup_organizationId_name_key" ON "CustomFieldGroup"("organizationId", "name");

-- CreateIndex
CREATE INDEX "CustomField_groupId_idx" ON "CustomField"("groupId");

-- AddForeignKey
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CustomFieldGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomFieldGroup" ADD CONSTRAINT "CustomFieldGroup_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
