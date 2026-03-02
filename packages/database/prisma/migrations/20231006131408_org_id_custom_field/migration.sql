UPDATE public."CustomField" AS c
SET "organizationId" = (
  SELECT o.id
  FROM public."Organization" AS o
  WHERE o."userId" = c."userId" AND o.type = 'PERSONAL'
)
WHERE c."organizationId" is NULL;

--make orgId mandatory
ALTER TABLE "CustomField" DROP CONSTRAINT "CustomField_organizationId_fkey";
ALTER TABLE "CustomField" ALTER COLUMN "organizationId" SET NOT NULL;
ALTER TABLE "CustomField" ADD CONSTRAINT "CustomField_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

