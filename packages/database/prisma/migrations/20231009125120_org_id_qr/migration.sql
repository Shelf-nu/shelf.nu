-- AlterTable
ALTER TABLE "Qr" ADD COLUMN     "organizationId" TEXT;

-- AddForeignKey
ALTER TABLE "Qr" ADD CONSTRAINT "Qr_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;


UPDATE public."Qr" AS q
SET "organizationId" = (
  SELECT o.id
  FROM public."Organization" AS o
  WHERE o."userId" = q."userId" AND o.type = 'PERSONAL'
);

ALTER TABLE "Qr" DROP CONSTRAINT "Qr_organizationId_fkey";

-- AlterTable
ALTER TABLE "Qr" ALTER COLUMN "organizationId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "Qr" ADD CONSTRAINT "Qr_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
