-- AlterTable
ALTER TABLE "Image" ADD COLUMN     "ownerOrgId" TEXT;
-- AddForeignKey
ALTER TABLE "Image" ADD CONSTRAINT "Image_ownerOrgId_fkey" FOREIGN KEY ("ownerOrgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;


UPDATE public."Image" AS q
SET "ownerOrgId" = (
  SELECT o.id
  FROM public."Organization" AS o
  WHERE o."userId" = q."userId" AND o.type = 'PERSONAL'
);

ALTER TABLE "Image" DROP CONSTRAINT "Image_ownerOrgId_fkey";

-- AlterTable
ALTER TABLE "Image" ALTER COLUMN "ownerOrgId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Image" ADD CONSTRAINT "Image_ownerOrgId_fkey" FOREIGN KEY ("ownerOrgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
