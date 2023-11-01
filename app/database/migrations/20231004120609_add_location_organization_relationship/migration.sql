-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "organizationId" TEXT;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- add organizationId to locations
UPDATE public."Location" AS l
SET "organizationId" = (
  SELECT o.id
  FROM public."Organization" AS o
  WHERE o."userId" = l."userId" AND o.type = 'PERSONAL'
)